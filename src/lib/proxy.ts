import { serve, type Server } from "bun";
import { readFileSync, watch } from "fs";
import { dirname } from "path";
import { resolveProjectsDirs } from "./config";
import { findPortListener, getListeners, hostPort, invalidateListeners, pickListener, type Listener, type Target } from "./discovery";
import { suggestDevCommand } from "./hints";
import { info, error } from "./logger";
import { findProjectDir, parseHost, resolveRoute, type Route } from "./routing";
import type { Config } from "./types";

const UPSTREAM_WS_TIMEOUT_MS = 5000;

// Headers that describe a single connection and must not be forwarded.
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

// Request headers forwarded on the upstream WebSocket handshake.
const WS_FORWARD_HEADERS = ["cookie", "origin", "authorization", "user-agent", "accept-language"];

let configWatcher: ReturnType<typeof watch> | null = null;

// Shown on "not running" pages when some dev servers can't be discovered.
let discoveryWarning: string | null = null;

export function setDiscoveryWarning(warning: string | null): void {
  discoveryWarning = warning;
}

function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, ms);
  };
}

export function watchConfig(configPath: string, onReload: () => void): void {
  if (configWatcher) {
    configWatcher.close();
  }

  const readConfigText = () => {
    try {
      return readFileSync(configPath, "utf-8");
    } catch {
      return null;
    }
  };
  let lastText = readConfigText();

  const debouncedReload = debounce(() => {
    const text = readConfigText();
    if (text === null || text === lastText) return;
    lastText = text;
    info(`Config file changed, reloading...`);
    onReload();
  }, 300);

  try {
    const configDir = dirname(configPath);
    // Atomic saves (lazydev alias, most editors) rename a temp file over the
    // config, and Bun only reports the temp file's name. React to any event in
    // the directory and compare contents instead.
    configWatcher = watch(configDir, () => debouncedReload());
    info(`Watching config directory for changes: ${configDir}`);
  } catch (err) {
    error(`Failed to watch config: ${err}`);
  }
}

export function stopConfigWatcher(): void {
  if (configWatcher) {
    configWatcher.close();
    configWatcher = null;
    info(`Stopped watching config`);
  }
}

interface WebSocketData {
  upstream: WebSocket;
  /** Messages the upstream sent before the client socket finished opening. */
  pending: Array<string | ArrayBuffer>;
  client: { send(data: string | ArrayBuffer): unknown; close(code?: number, reason?: string): void } | null;
  upstreamClosed: { code: number; reason: string } | null;
}

/** The first server is the primary; others share its port on other addresses. */
let servers: Server<WebSocketData>[] = [];
let config: Config = { settings: { proxy_port: 80 }, aliases: {} };
let projectsDirs = resolveProjectsDirs(config);

export function setConfig(cfg: Config): void {
  if (servers.length > 0 && cfg.settings.proxy_port !== config.settings.proxy_port) {
    info(`proxy_port changed to ${cfg.settings.proxy_port}; restart the proxy to apply it`);
  }
  config = cfg;
  projectsDirs = resolveProjectsDirs(cfg);
  invalidateListeners();
}

export function getProjectsDirs(): string[] {
  return projectsDirs;
}

/** Addresses the proxy is listening on, e.g. ["127.0.0.1:80", "[::1]:80"]. */
export function getAddresses(): string[] {
  return servers.map((s) => hostPort({ host: s.hostname ?? "", port: s.port ?? 0 }));
}

function ownPort(): number | undefined {
  return servers[0]?.port;
}

/** Find the listener serving `projectPath`, excluding the proxy's own port. */
export async function findListenerForProject(projectPath: string): Promise<Listener | null> {
  return pickListener(await getListeners(projectsDirs), projectPath, ownPort());
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function prefersHtml(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

// Polls the current URL and reloads once LazyDev stops answering for it, i.e.
// once the dev server is up. Gives up after ten minutes.
const WAIT_SCRIPT = `<script>
(function poll(tries) {
  if (tries > 600) return;
  setTimeout(function () {
    fetch(location.href, { method: "HEAD", cache: "no-store" })
      .then(function (res) {
        if (res.headers.has("x-lazydev-error")) poll(tries + 1);
        else location.reload();
      })
      .catch(function () { poll(tries + 1); });
  }, 1000);
})(0);
</script>`;

function page(title: string, badge: string, body: string, options: { waiting?: boolean } = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f172a;
      --panel: rgba(15, 23, 42, 0.78);
      --border: rgba(148, 163, 184, 0.24);
      --text: #e2e8f0;
      --muted: #94a3b8;
      --accent: #38bdf8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background:
        radial-gradient(circle at top, rgba(56, 189, 248, 0.18), transparent 34%),
        linear-gradient(180deg, #020617 0%, #0f172a 100%);
      color: var(--text);
      font-family: "JetBrains Mono", "Fira Code", monospace;
    }
    .card {
      width: min(720px, 100%);
      padding: 28px;
      border: 1px solid var(--border);
      border-radius: 20px;
      background: var(--panel);
      backdrop-filter: blur(10px);
      box-shadow: 0 24px 80px rgba(2, 6, 23, 0.45);
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      color: var(--accent);
      font-size: 13px;
    }
    .waiting::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      animation: pulse 1.2s ease-in-out infinite;
    }
    @keyframes pulse { 50% { opacity: 0.25; } }
    @media (prefers-reduced-motion: reduce) { .waiting::before { animation: none; } }
    h1 {
      margin: 0 0 10px;
      font-size: clamp(28px, 5vw, 44px);
      line-height: 1.05;
    }
    h2 {
      margin: 24px 0 8px;
      font-size: 15px;
      color: var(--muted);
      font-weight: normal;
    }
    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.6;
      font-size: 15px;
    }
    ul {
      margin: 18px 0 0;
      padding-left: 18px;
      color: var(--text);
    }
    li { margin: 8px 0; overflow-wrap: anywhere; }
    a { color: var(--accent); }
    .port { color: var(--muted); }
    code {
      padding: 2px 6px;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.72);
      border: 1px solid rgba(148, 163, 184, 0.16);
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="status${options.waiting ? " waiting" : ""}">${escapeHtml(badge)}</div>
    ${body}
  </main>
  ${options.waiting ? WAIT_SCRIPT : ""}
</body>
</html>`;
}

interface ErrorInfo {
  status: number;
  title: string;
  description: string;
  details?: string[];
  /** Keep the page open and reload it when the dev server comes up. */
  waiting?: boolean;
}

function errorResponse(req: Request, info: ErrorInfo): Response {
  const headers = { "cache-control": "no-store", "x-lazydev-error": String(info.status) };

  if (prefersHtml(req)) {
    const detailList = (info.details ?? []).map((detail) => `<li>${escapeHtml(detail)}</li>`).join("");
    const html = page(
      `${info.status} ${info.title}`,
      info.waiting ? `${info.status} · waiting for the dev server` : String(info.status),
      `<h1>${escapeHtml(info.title)}</h1>
    <p>${escapeHtml(info.description)}</p>
    ${detailList ? `<ul>${detailList}</ul>` : ""}`,
      { waiting: info.waiting ?? false },
    );
    return new Response(html, { status: info.status, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
  }

  const body = [info.description, ...(info.details ?? [])].join("\n\n") + "\n";
  return new Response(body, { status: info.status, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });
}

/**
 * Running projects by top-level directory name, in routing order: when two
 * projects directories contain the same name, only the one that wins routing
 * is listed.
 */
export function runningProjects(listeners: Listener[], dirs: string[], excludePort?: number): Map<string, Listener> {
  const projects = new Map<string, Listener>();
  for (const listener of listeners) {
    const root = dirs.find((dir) => listener.cwd.startsWith(dir + "/"));
    if (!root) continue;
    const name = listener.cwd.slice(root.length + 1).split("/")[0];
    if (!name || name.startsWith(".") || projects.has(name)) continue;
    const projectPath = `${root}/${name}`;
    if (findProjectDir(dirs, name) !== projectPath) continue;
    const picked = pickListener(listeners, projectPath, excludePort);
    if (picked) projects.set(name, picked);
  }
  return new Map([...projects].sort(([a], [b]) => a.localeCompare(b)));
}

function describeDirs(dirs: string[]): string {
  return dirs.join(", ");
}

async function dashboardResponse(req: Request): Promise<Response> {
  const running = runningProjects(await getListeners(projectsDirs), projectsDirs, ownPort());
  const port = ownPort() !== 80 ? `:${ownPort()}` : "";
  const link = (name: string) => `http://${name.toLowerCase()}.localhost${port}`;

  const aliases = await Promise.all(Object.entries(config.aliases).map(async ([alias, target]) => {
    const route = resolveRoute(projectsDirs, config.aliases, alias);
    const up = route.kind === "port"
      ? (await findPortListener(route.port)) !== null
      : route.kind === "project" && (await findListenerForProject(route.path)) !== null;
    return { alias, target: typeof target === "number" ? `port ${target}` : target, up };
  }));

  if (!prefersHtml(req)) {
    const lines = [...running].map(([name, l]) => `${name}\t${link(name)}\t${hostPort(l)}`);
    return new Response((lines.length ? lines.join("\n") : "No dev servers running.") + "\n", {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const projectItems = [...running]
    .map(([name, l]) => `<li><a href="${escapeHtml(link(name))}">${escapeHtml(name.toLowerCase())}.localhost</a> <span class="port">→ ${escapeHtml(hostPort(l))}</span></li>`)
    .join("");
  const aliasItems = aliases
    .map(({ alias, target, up }) => `<li><a href="${escapeHtml(link(alias))}">${escapeHtml(alias)}.localhost</a> <span class="port">→ ${escapeHtml(target)}${up ? "" : " (not running)"}</span></li>`)
    .join("");
  const firstDir = projectsDirs[0] ?? "~/projects";

  const body = `<h1>LazyDev</h1>
    <p>Dev servers running under <code>${escapeHtml(describeDirs(projectsDirs))}</code>.</p>
    ${projectItems ? `<ul>${projectItems}</ul>` : `<p style="margin-top:18px">None right now. Start one with <code>cd ${escapeHtml(firstDir)}/&lt;name&gt; &amp;&amp; bun dev</code>.</p>`}
    ${aliasItems ? `<h2>Aliases</h2><ul>${aliasItems}</ul>` : ""}`;

  return new Response(page("LazyDev", `${running.size} running`, body), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function stripHopByHop(headers: Headers): void {
  for (const name of headers.get("connection")?.split(",") ?? []) {
    headers.delete(name.trim());
  }
  for (const name of HOP_BY_HOP_HEADERS) {
    headers.delete(name);
  }
}

/** Rewrite redirects that point at the upstream's own origin back to the public host. */
function rewriteLocation(location: string, target: Target, publicHost: string): string {
  for (const host of ["localhost", "127.0.0.1", "[::1]", target.host.includes(":") ? `[${target.host}]` : target.host]) {
    for (const scheme of ["http", "https"]) {
      const origin = `${scheme}://${host}:${target.port}`;
      if (location === origin || location.startsWith(origin + "/") || location.startsWith(origin + "?")) {
        return `http://${publicHost}${location.slice(origin.length)}`;
      }
    }
  }
  return location;
}

function isConnectionError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "ConnectionRefused" || code === "ECONNREFUSED" || code === "ECONNRESET" || code === "FailedToOpenSocket";
}

async function forwardRequest(req: Request, target: Target, publicHost: string, clientIp: string | undefined): Promise<Response> {
  const url = new URL(req.url);
  const upstreamUrl = `http://${hostPort(target)}${url.pathname}${url.search}`;

  const headers = new Headers(req.headers);
  stripHopByHop(headers);
  headers.set("host", `localhost:${target.port}`);
  headers.set("x-forwarded-host", publicHost);
  headers.set("x-forwarded-proto", "http");
  if (clientIp) {
    const prior = req.headers.get("x-forwarded-for");
    headers.set("x-forwarded-for", prior ? `${prior}, ${clientIp}` : clientIp);
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const response = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    body: hasBody ? req.body : null,
    redirect: "manual",
    // Pass compressed bodies through untouched; otherwise Bun inflates them
    // but keeps the Content-Encoding header and the browser fails to decode.
    decompress: false,
    signal: req.signal,
  });

  const responseHeaders = new Headers(response.headers);
  stripHopByHop(responseHeaders);
  const location = responseHeaders.get("location");
  if (location) {
    responseHeaders.set("location", rewriteLocation(location, target, publicHost));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

function openUpstreamSocket(url: string, protocols: string[], headers: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    // Bun's WebSocket client accepts extra handshake headers.
    const ws = new WebSocket(url, { protocols, headers } as unknown as string[]);
    ws.binaryType = "arraybuffer";
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("timed out"));
    }, UPSTREAM_WS_TIMEOUT_MS);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(ws);
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("connection failed"));
    }, { once: true });
  });
}

/** Close codes an endpoint may send; reserved ones (1005, 1006, ...) are mapped to 1000. */
function sendableCloseCode(code: number): number {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;
}

async function upgradeWebSocket(req: Request, srv: Server<WebSocketData>, target: Target, label: string): Promise<Response | undefined> {
  const url = new URL(req.url);
  const protocols = (req.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const headers: Record<string, string> = {};
  for (const name of WS_FORWARD_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers[name] = value;
  }

  // Connect upstream first so a refused connection becomes a 502 instead of
  // a socket that opens and immediately closes.
  let upstream: WebSocket;
  try {
    upstream = await openUpstreamSocket(`ws://${hostPort(target)}${url.pathname}${url.search}`, protocols, headers);
  } catch (err) {
    error(`WebSocket ${label}${url.pathname} → ${hostPort(target)} failed: ${err instanceof Error ? err.message : err}`);
    return errorResponse(req, {
      status: 502,
      title: "WebSocket upstream unavailable",
      description: `Could not open a WebSocket to ${hostPort(target)}.`,
    });
  }

  const data: WebSocketData = { upstream, pending: [], client: null, upstreamClosed: null };
  upstream.onmessage = (event) => {
    const message = event.data as string | ArrayBuffer;
    if (data.client) data.client.send(message);
    else data.pending.push(message);
  };
  upstream.onclose = (event) => {
    const code = sendableCloseCode(event.code);
    if (data.client) data.client.close(code, event.reason);
    else data.upstreamClosed = { code, reason: event.reason };
  };

  // Bun echoes the first requested subprotocol in the handshake response.
  if (srv.upgrade(req, { data })) {
    info(`WS ${label}${url.pathname} → ${hostPort(target)}`);
    return undefined;
  }

  upstream.close();
  return errorResponse(req, {
    status: 400,
    title: "WebSocket upgrade failed",
    description: "The request could not be upgraded to a WebSocket.",
  });
}

function notRunningError(route: Route & { kind: "port" | "project" }, publicHost: string): ErrorInfo {
  if (route.kind === "port") {
    return {
      status: 503,
      title: "Nothing on that port",
      description: `"${route.label}" points to port ${route.port}, but nothing is listening there right now.`,
      details: [`Start the service on port ${route.port}. This page reloads when it is up.`],
      waiting: true,
    };
  }
  return {
    status: 503,
    title: "Dev server not running",
    description: `LazyDev found ${route.path}, but nothing is listening for "${route.label}" right now.`,
    details: [
      `Start it with: cd ${route.path} && ${suggestDevCommand(route.path)}`,
      `This page reloads when http://${publicHost} is up.`,
      ...(discoveryWarning ? [discoveryWarning] : []),
    ],
    waiting: true,
  };
}

async function handleRequest(req: Request, srv: Server<WebSocketData>): Promise<Response | undefined> {
  const host = req.headers.get("host");
  const parsed = parseHost(host);

  if (parsed.kind === "dashboard") {
    return dashboardResponse(req);
  }
  if (parsed.kind === "invalid") {
    return errorResponse(req, {
      status: 400,
      title: "Unknown host",
      description: parsed.reason,
      details: ["Use http://<project>.localhost"],
    });
  }

  const publicHost = host ?? `${parsed.name}.localhost`;
  const route = resolveRoute(projectsDirs, config.aliases, parsed.name);

  if (route.kind === "missing") {
    return errorResponse(req, {
      status: 404,
      title: "Project not found",
      description: `LazyDev could not find a local project directory for "${route.target}".`,
      details: [
        ...projectsDirs.map((dir) => `Expected directory: ${dir}/${route.target}`),
        "Check the project name, or map it with `lazydev alias <name> <project-or-port>`.",
      ],
    });
  }
  if (route.kind === "port" && route.port === ownPort()) {
    return errorResponse(req, {
      status: 508,
      title: "Alias loops back to LazyDev",
      description: `"${route.label}" points to port ${route.port}, which is LazyDev itself.`,
    });
  }

  const lookup = (): Promise<Target | null> =>
    route.kind === "port" ? findPortListener(route.port) : findListenerForProject(route.path);

  let target = await lookup();
  if (!target) {
    // The cached scan may predate a server that just started.
    invalidateListeners();
    target = await lookup();
  }
  if (!target) {
    return errorResponse(req, notRunningError(route, publicHost));
  }

  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return upgradeWebSocket(req, srv, target, publicHost);
  }

  const started = performance.now();
  const clientIp = srv.requestIP(req)?.address;
  const url = new URL(req.url);
  const log = (status: number | string, to: Target) =>
    info(`${req.method} ${publicHost}${url.pathname} → ${hostPort(to)} ${status} ${Math.round(performance.now() - started)}ms`);

  try {
    const response = await forwardRequest(req, target, publicHost, clientIp);
    log(response.status, target);
    return response;
  } catch (err) {
    if (req.signal.aborted) {
      return new Response(null, { status: 499 });
    }

    // The dev server may have restarted on another port. Retry once with a
    // fresh scan if the request body has not been consumed.
    if (isConnectionError(err) && !req.bodyUsed) {
      invalidateListeners();
      const fresh = await lookup();
      if (fresh && (fresh.port !== target.port || fresh.host !== target.host)) {
        try {
          const response = await forwardRequest(req, fresh, publicHost, clientIp);
          log(response.status, fresh);
          return response;
        } catch (retryErr) {
          err = retryErr;
        }
      }
    }

    const message = err instanceof Error ? err.message : String(err);
    log(`failed: ${message}`, target);
    return errorResponse(req, {
      status: 502,
      title: "Dev server not responding",
      description: `LazyDev could not reach the dev server for "${route.label}" at ${hostPort(target)}.`,
      details: [message, "If the server is restarting, this page reloads when it is back."],
      waiting: req.method === "GET",
    });
  }
}

function listen(hostname: string, port: number): Server<WebSocketData> {
  return serve<WebSocketData>({
    port,
    hostname,
    idleTimeout: 255,

    fetch: handleRequest,

    error(err) {
      error(`Unhandled proxy error: ${err.stack ?? err.message}`);
      return new Response("LazyDev internal error\n", { status: 500 });
    },

    websocket: {
      open(ws) {
        const data = ws.data;
        data.client = ws;
        for (const message of data.pending) {
          ws.send(message);
        }
        data.pending = [];
        if (data.upstreamClosed) {
          ws.close(data.upstreamClosed.code, data.upstreamClosed.reason);
        }
      },

      message(ws, message) {
        const upstream = ws.data.upstream;
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(message);
        }
      },

      close(ws, code, reason) {
        const upstream = ws.data.upstream;
        if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
          upstream.close(sendableCloseCode(code), reason);
        }
      },
    },
  });
}

/**
 * Listen on IPv4 and IPv6 loopback. *.localhost often resolves to ::1 first,
 * and not every client falls back to 127.0.0.1. Only the first address is
 * required; the others are skipped if they cannot be bound.
 */
export async function startProxy(cfg: Config, hostnames: string[] = ["127.0.0.1", "::1"]): Promise<Server<WebSocketData>> {
  setConfig(cfg);

  const [first = "127.0.0.1", ...rest] = hostnames;
  const primary = listen(first, cfg.settings.proxy_port);
  servers = [primary];

  for (const hostname of rest) {
    try {
      servers.push(listen(hostname, primary.port ?? cfg.settings.proxy_port));
    } catch (err) {
      info(`Not listening on ${hostname}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return primary;
}

export function stopProxy(): void {
  for (const server of servers) {
    server.stop(true);
  }
  servers = [];
}
