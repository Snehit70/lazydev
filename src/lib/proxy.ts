import { serve, type Server } from "bun";
import { readlink } from "fs/promises";
import { execSync } from "child_process";
import { existsSync, watch } from "fs";
import { dirname, basename } from "path";
import { expandTilde } from "./config";
import { info, error } from "./logger";
import type { Config } from "./types";

const PROJECTS_DIR = expandTilde("~/projects");
const PORT_CACHE_TTL_MS = 2000;

interface PortCacheEntry {
  port: number | null;
  expiresAt: number;
}

const portCache = new Map<string, PortCacheEntry>();

export async function findPortForProject(projectPath: string, includeSubdirs = false): Promise<number | null> {
  const cacheKey = `${projectPath}:${includeSubdirs ? "subdirs" : "exact"}`;
  const cached = portCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.port;
  }

  try {
    const ssOutput = execSync("ss -tlnp", { encoding: "utf-8", timeout: 5000 });
    const lines = ssOutput.split("\n").slice(1);

    for (const line of lines) {
      const portMatch = line.match(/:(\d+)\s/);
      const pidMatch = line.match(/pid=(\d+)/);

      if (!portMatch?.[1] || !pidMatch?.[1]) continue;

      const port = parseInt(portMatch[1], 10);
      const pid = parseInt(pidMatch[1], 10);

      if (port < 1024) continue;

      try {
        const cwd = await readlink(`/proc/${pid}/cwd`);
        // Exact match
        if (cwd === projectPath) {
          portCache.set(cacheKey, { port, expiresAt: Date.now() + PORT_CACHE_TTL_MS });
          return port;
        }
        // Subdirectory match (for monorepos)
        if (includeSubdirs && cwd.startsWith(projectPath + "/")) {
          portCache.set(cacheKey, { port, expiresAt: Date.now() + PORT_CACHE_TTL_MS });
          return port;
        }
      } catch {
        // Process may have exited
      }
    }
  } catch (err) {
    console.error("[findPortForProject] Error:", err);
  }

  portCache.set(cacheKey, { port: null, expiresAt: Date.now() + PORT_CACHE_TTL_MS });
  return null;
}

export function clearPortCache(): void {
  portCache.clear();
}

export function projectExists(projectName: string): boolean {
  const projectPath = `${projectsDir}/${projectName}`;
  return existsSync(projectPath);
}

export function getProjectPath(projectName: string): string {
  return `${projectsDir}/${projectName}`;
}

let configWatcher: ReturnType<typeof watch> | null = null;

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
  
  const debouncedReload = debounce(() => {
    info(`Config file changed, reloading...`);
    onReload();
  }, 500);
  
  try {
    const configDir = dirname(configPath);
    const configFile = basename(configPath);
    configWatcher = watch(configDir, (eventType, filename) => {
      if (filename === configFile && (eventType === "change" || eventType === "rename")) {
        debouncedReload();
      }
    });
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
  projectName: string;
  targetPort: number;
  targetPath: string;
  targetWs?: WebSocket;
  connected: boolean;
}

let server: Server<WebSocketData> | null = null;
let projectsDir = PROJECTS_DIR;
const aliasToProject = new Map<string, string>();

export function setConfig(cfg: Config): void {
  clearPortCache();
  projectsDir = cfg.settings.projects_dir 
    ? expandTilde(cfg.settings.projects_dir) 
    : PROJECTS_DIR;
  
  aliasToProject.clear();
  
  for (const [alias, target] of Object.entries(cfg.aliases ?? {})) {
    aliasToProject.set(alias.toLowerCase(), target);
  }
}

export function getProjectsDir(): string {
  return projectsDir;
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

function errorPage(status: number, title: string, description: string, details?: string[]): string {
  const detailList = (details ?? [])
    .map((detail) => `<li>${escapeHtml(detail)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${status} ${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light dark;
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
      margin-bottom: 16px;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      color: var(--accent);
      font-size: 13px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: clamp(28px, 5vw, 44px);
      line-height: 1.05;
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
    li { margin: 8px 0; }
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
    <div class="status">${status}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    ${detailList ? `<ul>${detailList}</ul>` : ""}
  </main>
</body>
</html>`;
}

function errorResponse(req: Request, status: number, title: string, description: string, details?: string[]): Response {
  if (prefersHtml(req)) {
    return new Response(errorPage(status, title, description, details), {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const body = [description, ...(details ?? [])].join("\n\n");
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function proxyRequest(req: Request, targetPort: number): Promise<Response> {
  const url = new URL(req.url);
  url.hostname = "localhost";
  url.port = String(targetPort);
  
  const proxyHeaders = new Headers(req.headers);
  proxyHeaders.set("Host", `localhost:${targetPort}`);
  
  const proxyReq = new Request(url.toString(), {
    method: req.method,
    headers: proxyHeaders,
    body: req.body,
    redirect: "manual",
  });
  
  const response = await fetch(proxyReq);
  
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("X-Forwarded-Host", req.headers.get("host") ?? "localhost");
  responseHeaders.set("X-Forwarded-Proto", "http");
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export async function startProxy(cfg: Config): Promise<Server<WebSocketData>> {
  setConfig(cfg);
  
  server = serve({
    port: cfg.settings.proxy_port,
    hostname: "127.0.0.1",
    idleTimeout: 255,
    
    async fetch(req, srv) {
      const host = req.headers.get("host") ?? "";
      const subdomainRaw = host.split(".localhost")[0];
      const subdomain = subdomainRaw?.toLowerCase() ?? "";
      
      info(`${req.method} ${host} → "${subdomain}"`);
      
      if (!subdomain) {
        return errorResponse(req, 400, "No project specified", "The request did not include a project subdomain.");
      }
      
      // Resolve alias to project name
      const projectName = aliasToProject.get(subdomain) ?? subdomain;
      const projectPath = `${projectsDir}/${projectName}`;
      
      // Check if project directory exists
      if (!existsSync(projectPath)) {
        return errorResponse(
          req,
          404,
          "Project not found",
          `LazyDev could not find a local project directory for \"${projectName}\".`,
          [`Expected directory: ${projectPath}`, "Check the project name or create an alias with `lazydev alias <short> <project>`."],
        );
      }
      
      // Find running dev server
      const port = await findPortForProject(projectPath, true);
      if (!port) {
        return errorResponse(
          req,
          503,
          "Dev server not running",
          `LazyDev found the project, but nothing is listening for \"${projectName}\" right now.`,
          [`Start it with: cd ${projectPath} && bun dev`, `Then refresh http://${subdomain}.localhost`],
        );
      }
      
      info(`→ localhost:${port}`);
      
      if (req.headers.get("upgrade") === "websocket") {
        info(`WebSocket upgrade`);
        
        const url = new URL(req.url);
        const targetPath = url.pathname + url.search;
        
        const upgraded = srv.upgrade(req, {
          data: { 
            projectName, 
            targetPort: port,
            targetPath,
            connected: false 
          } as WebSocketData,
        });
        
        return upgraded 
          ? new Response(null, { status: 101 }) 
          : new Response("WebSocket upgrade failed", { status: 500 });
      }
      
      return proxyRequest(req, port);
    },
    
    websocket: {
      open(ws) {
        const { targetPort, targetPath } = ws.data;
        
        try {
          const url = `ws://localhost:${targetPort}${targetPath}`;
          const targetWs = new WebSocket(url);
          
          targetWs.onopen = () => {
            ws.data.targetWs = targetWs;
            ws.data.connected = true;
          };
          
          targetWs.onmessage = (e) => ws.send(e.data);
          targetWs.onclose = () => ws.close();
          targetWs.onerror = (e) => {
            info(`WebSocket error to localhost:${targetPort}: ${e}`);
            ws.close();
          };
        } catch (err) {
          error(`WebSocket connection failed to localhost:${targetPort}: ${err}`);
          ws.close();
        }
      },
      
      message(ws, message) {
        ws.data.targetWs?.send(message);
      },
      
      close(ws) {
        ws.data.targetWs?.close();
      },
    },
  });
  
  return server;
}

export function stopProxy(): void {
  if (server) {
    server.stop();
    server = null;
  }
}

export function getServer(): Server<WebSocketData> | null {
  return server;
}
