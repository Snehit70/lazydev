import { loadConfig, getConfigPath } from "../lib/config";
import { startProxy, stopProxy, setConfig, watchConfig, stopConfigWatcher, getProjectsDirs, getAddresses, setDiscoveryWarning } from "../lib/proxy";
import { existsSync } from "fs";
import { startService, isSystemdAvailable, getServiceStatus } from "../lib/systemd";
import { getForegroundPid, removePidFile, writePidFile } from "../lib/pidfile";
import { error, info, warn } from "../lib/logger";
import { capableBunBinaries, capabilityAdvice } from "../lib/caps";

function bindErrorHint(err: unknown, port: number): string | null {
  const code = (err as { code?: string } | null)?.code;
  if (code === "EADDRINUSE") {
    return `Port ${port} is already in use. Check 'lazydev status', or find the owner with: ss -tlnp 'sport = :${port}'`;
  }
  if (code === "EACCES") {
    return [
      `Permission denied binding port ${port}. Allow unprivileged binding to it:`,
      `  echo 'net.ipv4.ip_unprivileged_port_start=${port}' | sudo tee /etc/sysctl.d/50-lazydev.conf`,
      "  sudo sysctl --system",
      "Or set settings.proxy_port to a port >= 1024.",
      "Don't use setcap on bun: it hides bun-run dev servers from LazyDev.",
    ].join("\n");
  }
  return null;
}

export async function run(foreground: boolean = false) {
  // Try systemd first, fall back to foreground
  const useSystemd = !foreground && isSystemdAvailable();

  if (useSystemd) {
    console.log("Starting LazyDev proxy...\n");
    const status = getServiceStatus();
    if (status.active) {
      console.log("✓ LazyDev service is already running");
      console.log("  Use 'lazydev restart' to restart");
      console.log("  Use 'lazydev stop' to stop\n");
      return;
    }

    const result = await startService();
    if (result.success) {
      console.log("✓ LazyDev service started");
      console.log("  Access projects at: http://<project>.localhost\n");
      return;
    }

    console.log(`⚠ Could not start the systemd service: ${result.message}`);
    console.log("  Check 'journalctl --user -u lazydev' for details.");
    console.log("  Starting in foreground mode instead...\n");
  }

  const existing = getForegroundPid();
  if (existing && existing !== process.pid) {
    console.error(`LazyDev is already running in the foreground (PID: ${existing}).`);
    process.exit(1);
  }

  let config;
  try {
    config = loadConfig();
  } catch (err: unknown) {
    console.error("Failed to start:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  try {
    await startProxy(config);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    error(`Failed to start proxy on port ${config.settings.proxy_port}: ${message}`);
    const hint = bindErrorHint(err, config.settings.proxy_port);
    if (hint) console.error(`\n${hint}`);
    process.exit(1);
  }

  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    watchConfig(configPath, () => {
      try {
        setConfig(loadConfig());
        info("Config reloaded");
      } catch (err: unknown) {
        error(`Failed to reload config, keeping the previous one: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }

  writePidFile();

  info(`Proxy listening on ${getAddresses().join(", ")}, projects in ${getProjectsDirs().join(", ")}`);

  const capable = capableBunBinaries();
  if (capable.length > 0) {
    for (const line of capabilityAdvice(capable, config.settings.proxy_port)) warn(line);
    setDiscoveryWarning(
      `Started it already? ${capable.map((b) => b.path).join(", ")} has file capabilities (setcap), ` +
      "which hides bun processes from LazyDev. Run 'lazydev doctor' for the fix.",
    );
  }

  const shutdown = () => {
    info("Stopping...");
    stopConfigWatcher();
    stopProxy();
    removePidFile();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise(() => {});
}
