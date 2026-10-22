import { readdirSync, statSync } from "fs";
import { loadConfig, resolveProjectsDirs } from "../lib/config";
import { capableBunBinaries } from "../lib/caps";
import { findPortListener, getListeners, hostPort, pickListener, projectListeners, type Listener } from "../lib/discovery";
import { suggestDevCommand } from "../lib/hints";
import { getForegroundPid } from "../lib/pidfile";
import { findProjectDir, resolveRoute } from "../lib/routing";
import { getServiceStatus, isSystemdAvailable } from "../lib/systemd";

function getProxyStatusLine(): string {
  if (isSystemdAvailable() && getServiceStatus().active) {
    return "🟢 running (systemd)";
  }
  const pid = getForegroundPid();
  if (pid) {
    return `🟢 running (foreground, PID ${pid})`;
  }
  return "🔴 not running (start with 'lazydev start')";
}

/** Project directories across all roots; a name shadowed by an earlier root is skipped. */
export function listProjects(projectsDirs: string[]): Array<{ name: string; path: string }> {
  const projects: Array<{ name: string; path: string }> = [];
  for (const dir of projectsDirs) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      console.error(`Cannot read projects directory: ${dir}`);
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const path = `${dir}/${entry}`;
      try {
        if (!statSync(path).isDirectory()) continue;
      } catch {
        continue;
      }
      if (findProjectDir(projectsDirs, entry) === path) {
        projects.push({ name: entry, path });
      }
    }
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

async function showOne(name: string, urlFor: (label: string) => string, listeners: Listener[], proxyPort: number) {
  const config = loadConfig();
  const label = name.toLowerCase();
  const route = resolveRoute(resolveProjectsDirs(config), config.aliases, label);

  console.log(`Project: ${label}`);

  if (route.kind === "port") {
    const target = await findPortListener(route.port);
    console.log(`  Alias:  ${label} → port ${route.port}`);
    console.log(`  Status: ${target ? "🟢 running" : "🔴 nothing listening"}`);
    if (target) console.log(`  Target: ${hostPort(target)}`);
    console.log(`  URL:    ${urlFor(label)}`);
    if (!target) process.exitCode = 1;
    return;
  }

  if (route.target !== label) {
    console.log(`  Alias:  ${label} → ${route.target}`);
  }
  if (route.kind === "missing") {
    console.log(`  Status: ❌ not found (no ${route.target} in ${resolveProjectsDirs(config).join(", ")})`);
    process.exitCode = 1;
    return;
  }

  const listener = pickListener(listeners, route.path, proxyPort);
  console.log(`  Path:   ${route.path}`);
  if (!listener) {
    console.log(`  Status: 🔴 not running`);
    console.log(`\nStart with: cd ${route.path} && ${suggestDevCommand(route.path)}`);
    if (capableBunBinaries().length > 0) {
      console.log("Already running with bun? bun has file capabilities, which hides it. See 'lazydev doctor'.");
    }
    return;
  }

  console.log(`  Status: 🟢 running`);
  console.log(`  Target: ${hostPort(listener)} (PID ${listener.pid})`);
  console.log(`  URL:    ${urlFor(label)}`);

  const others = [...new Set(
    projectListeners(listeners, route.path, proxyPort)
      .filter((l) => l.port !== listener.port)
      .map((l) => l.port),
  )].sort((a, b) => a - b);
  if (others.length > 0) {
    console.log(`  Also listening: ${others.join(", ")}`);
    console.log(`  To route to one of those instead: lazydev alias ${label} <port>`);
  }
}

export async function run(name?: string) {
  const config = loadConfig();
  const projectsDirs = resolveProjectsDirs(config);
  const listeners = await getListeners(projectsDirs);
  const proxyPort = config.settings.proxy_port;
  const urlFor = (label: string) => `http://${label}.localhost${proxyPort === 80 ? "" : `:${proxyPort}`}`;

  if (name) {
    await showOne(name, urlFor, listeners, proxyPort);
    return;
  }

  const projects = listProjects(projectsDirs).map((p) => ({
    ...p,
    listener: pickListener(listeners, p.path, proxyPort),
  }));
  const running = projects.filter((p) => p.listener);
  const stopped = projects.filter((p) => !p.listener);

  console.log(`\nProxy:        ${getProxyStatusLine()}`);
  console.log(`Projects dir: ${projectsDirs.join(", ")}\n`);

  if (running.length > 0) {
    console.log("Running dev servers:");
    console.log("  Name              Target            URL");
    console.log("  ─────────────────────────────────────────────────────────");

    for (const p of running) {
      console.log(`  ${p.name.padEnd(17)} ${hostPort(p.listener!).padEnd(17)} ${urlFor(p.name.toLowerCase())}`);
    }
    console.log("");
  }

  const aliases = Object.entries(config.aliases);
  if (aliases.length > 0) {
    console.log("Aliases:");
    for (const [alias, target] of aliases) {
      const route = resolveRoute(projectsDirs, config.aliases, alias);
      let state: string;
      if (route.kind === "port") {
        const found = await findPortListener(route.port);
        state = found ? hostPort(found) : "nothing listening";
      } else if (route.kind === "missing") {
        state = "project not found";
      } else {
        const listener = pickListener(listeners, route.path, proxyPort);
        state = listener ? hostPort(listener) : "not running";
      }
      const shown = typeof target === "number" ? `port ${target}` : target;
      console.log(`  ${alias} → ${shown}`.padEnd(30) + `${urlFor(alias)} (${state})`);
    }
    console.log("");
  }

  if (stopped.length > 0) {
    console.log("Not running:");
    for (const p of stopped.slice(0, 5)) {
      console.log(`  ${p.name}`);
    }
    if (stopped.length > 5) {
      console.log(`  ... and ${stopped.length - 5} more`);
    }
    console.log("");
  }

  const capable = capableBunBinaries();
  if (capable.length > 0) {
    console.log(`⚠ ${capable.map((b) => b.path).join(", ")} has file capabilities (setcap).`);
    console.log("  Dev servers run with bun are invisible to LazyDev. Run 'lazydev doctor' for the fix.\n");
  }

  if (running.length === 0) {
    console.log("No dev servers running.\n");
    console.log("Start one with:");
    console.log(`  cd ${projectsDirs[0]}/<name>`);
    console.log("  bun dev\n");
  } else {
    console.log(`Summary: ${running.length} running, ${stopped.length} stopped\n`);
  }
}
