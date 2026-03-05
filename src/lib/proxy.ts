import { serve, type Server } from "bun";
import { readlink } from "fs/promises";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { expandTilde } from "./config";
import type { Config, ProjectConfig } from "./types";

const PROJECTS_DIR = expandTilde("~/projects");

export async function findPortForProject(projectPath: string): Promise<number | null> {
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
        if (cwd === projectPath) {
          return port;
        }
      } catch {
        // Process may have exited
      }
    }
  } catch (err) {
    console.error("[findPortForProject] Error:", err);
  }

  return null;
}

export function projectExists(projectName: string): boolean {
  const projectPath = `${PROJECTS_DIR}/${projectName}`;
  return existsSync(projectPath);
}

export function getProjectPath(projectName: string): string {
  return `${PROJECTS_DIR}/${projectName}`;
}

interface WebSocketData {
  projectName: string;
  targetPort: number;
  targetPath: string;
  targetWs?: WebSocket;
  connected: boolean;
}

let server: Server<WebSocketData> | null = null;
const nameToConfig = new Map<string, ProjectConfig>();

export function setConfig(cfg: Config): void {
  nameToConfig.clear();
  
  for (const [name, project] of Object.entries(cfg.projects)) {
    if (project.disabled) continue;
    
    nameToConfig.set(name.toLowerCase(), project);
    for (const alias of project.aliases ?? []) {
      nameToConfig.set(alias.toLowerCase(), project);
    }
  }
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
      
      console.log(`[Proxy] ${req.method} ${host} → "${subdomain}"`);
      
      if (!subdomain || !nameToConfig.has(subdomain)) {
        return new Response("Project not found", { status: 404 });
      }
      
      const projectConfig = nameToConfig.get(subdomain)!;
      console.log(`[Proxy] → localhost:${projectConfig.port}`);
      
      if (req.headers.get("upgrade") === "websocket") {
        console.log(`[Proxy] WebSocket upgrade`);
        
        const url = new URL(req.url);
        const targetPath = url.pathname + url.search;
        
        const upgraded = srv.upgrade(req, {
          data: { 
            projectName: projectConfig.name, 
            targetPort: projectConfig.port,
            targetPath,
            connected: false 
          } as WebSocketData,
        });
        
        return upgraded 
          ? new Response(null, { status: 101 }) 
          : new Response("WebSocket upgrade failed", { status: 500 });
      }
      
      return proxyRequest(req, projectConfig.port);
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
            console.log(`[Proxy] WebSocket error to localhost:${targetPort}:`, e);
            ws.close();
          };
        } catch (err) {
          console.log(`[Proxy] WebSocket connection failed to localhost:${targetPort}:`, err);
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
