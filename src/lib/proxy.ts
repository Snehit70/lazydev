import { serve, type Server } from "bun";
import { readlink } from "fs/promises";
import { execSync } from "child_process";
import { existsSync, watch } from "fs";
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
  const projectPath = `${PROJECTS_DIR}/${projectName}`;
  return existsSync(projectPath);
}

export function getProjectPath(projectName: string): string {
  return `${PROJECTS_DIR}/${projectName}`;
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
    configWatcher = watch(configPath, (eventType) => {
      if (eventType === "change") {
        debouncedReload();
      }
    });
    info(`Watching config for changes: ${configPath}`);
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
        return new Response("No project specified", { status: 400 });
      }
      
      // Resolve alias to project name
      const projectName = aliasToProject.get(subdomain) ?? subdomain;
      const projectPath = `${projectsDir}/${projectName}`;
      
      // Check if project directory exists
      if (!existsSync(projectPath)) {
        return new Response(`Project "${projectName}" not found\n\nNo directory: ${projectPath}`, { status: 404 });
      }
      
      // Find running dev server
      const port = await findPortForProject(projectPath);
      if (!port) {
        return new Response(
          `No dev server running for "${projectName}"\n\n` +
          `Start one with:\n  cd ${projectPath}\n  bun dev`,
          { status: 503 }
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
