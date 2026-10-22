import { readdirSync, statSync } from "fs";
import { join, resolve, sep } from "path";
import type { AliasTarget } from "./types";

export type HostRoute =
  | { kind: "dashboard" }
  | { kind: "project"; name: string }
  | { kind: "invalid"; reason: string };

const LABEL_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const DASHBOARD_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Strip the port (and IPv6 brackets) from a Host header value. */
function hostname(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(1, end);
  }
  const colon = host.lastIndexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

/**
 * Map a Host header to a route. `app.localhost` routes to project `app`; extra
 * subdomains are passed through, so `api.app.localhost` also routes to `app`.
 */
export function parseHost(host: string | null): HostRoute {
  if (!host) {
    return { kind: "invalid", reason: "Missing Host header" };
  }

  const name = hostname(host.trim().toLowerCase()).replace(/\.$/, "");
  if (DASHBOARD_HOSTS.has(name)) {
    return { kind: "dashboard" };
  }
  if (!name.endsWith(".localhost")) {
    return { kind: "invalid", reason: `Host "${name}" is not a .localhost name` };
  }

  const labels = name.slice(0, -".localhost".length).split(".");
  const project = labels[labels.length - 1] ?? "";
  if (!LABEL_PATTERN.test(project)) {
    return { kind: "invalid", reason: `"${project}" is not a valid project name` };
  }
  return { kind: "project", name: project };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve a project name (or alias target path) to a directory inside
 * `projectsDir`. Hostnames are lowercase, so a directory like `MyApp` is
 * matched case-insensitively. Returns null if nothing matches or the path
 * would escape `projectsDir`.
 */
export function resolveProjectDir(projectsDir: string, name: string): string | null {
  const root = resolve(projectsDir);
  const exact = resolve(root, name);
  if (!exact.startsWith(root + sep)) {
    return null;
  }
  if (isDirectory(exact)) {
    return exact;
  }
  if (name.includes("/")) {
    return null;
  }

  try {
    const lower = name.toLowerCase();
    const match = readdirSync(root).find((entry) => entry.toLowerCase() === lower);
    if (match && isDirectory(join(root, match))) {
      return join(root, match);
    }
  } catch {
    // projectsDir missing or unreadable
  }
  return null;
}

/** Find `name` in the first projects directory that has it. */
export function findProjectDir(projectsDirs: string[], name: string): string | null {
  for (const dir of projectsDirs) {
    const found = resolveProjectDir(dir, name);
    if (found) return found;
  }
  return null;
}

export type Route =
  /** An alias pinned to a port: proxy there regardless of which process owns it. */
  | { kind: "port"; label: string; port: number }
  | { kind: "project"; label: string; target: string; path: string }
  | { kind: "missing"; label: string; target: string };

/** Resolve a hostname label through aliases to a port or a project directory. */
export function resolveRoute(
  projectsDirs: string[],
  aliases: Record<string, AliasTarget>,
  label: string,
): Route {
  const target = aliases[label] ?? label;
  if (typeof target === "number") {
    return { kind: "port", label, port: target };
  }
  const path = findProjectDir(projectsDirs, target);
  return path ? { kind: "project", label, target, path } : { kind: "missing", label, target };
}

function contains(dir: string, path: string): boolean {
  return path === dir || path.startsWith(dir + "/");
}

/**
 * The hostname label for a working directory: the deepest alias whose target
 * contains it, otherwise the top-level project directory it is in.
 */
export function labelForPath(
  projectsDirs: string[],
  aliases: Record<string, AliasTarget>,
  cwd: string,
): string | null {
  let best: { label: string; depth: number } | null = null;
  for (const [label, target] of Object.entries(aliases)) {
    if (typeof target === "number") continue;
    const path = findProjectDir(projectsDirs, target);
    if (path && contains(path, cwd) && (!best || path.length > best.depth)) {
      best = { label, depth: path.length };
    }
  }

  for (const dir of projectsDirs) {
    if (!contains(dir, cwd) || cwd === dir) continue;
    const project = cwd.slice(dir.length + 1).split("/")[0] ?? "";
    // An alias deeper than the project root (e.g. monorepo/apps/web) wins.
    if (best && best.depth > dir.length + 1 + project.length) return best.label;
    const label = project.toLowerCase();
    return LABEL_PATTERN.test(label) ? label : best?.label ?? null;
  }
  return best?.label ?? null;
}
