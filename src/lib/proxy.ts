import { serve, type Server } from "bun";
import type { Config, ProjectConfig } from "./types";
import { getProjectState, updateActivity, incrementWebSockets, decrementWebSockets } from "./state";
import { startProject, stopProject, waitForHealthy, checkHealth } from "./process";
import { markPortUsed } from "./port";

interface WebSocketData {
  projectName: string;
  targetPort: number;
  targetWs?: WebSocket;
  connected: boolean;
}

let server: Server<WebSocketData> | null = null;
const nameToConfig = new Map<string, ProjectConfig>();

export function setConfig(cfg: Config): void {
  nameToConfig.clear();
  
  for (const [name, project] of Object.entries(cfg.projects)) {
    nameToConfig.set(name.toLowerCase(), project);
    for (const alias of project.aliases ?? []) {
      nameToConfig.set(alias.toLowerCase(), project);
    }
  }
}

async function proxyRequest(
  req: Request,
  targetPort: number
): Promise<Response> {
  const url = new URL(req.url);
  url.port = String(targetPort);
  
  const proxyReq = new Request(url.toString(), {
    method: req.method,
    headers: req.headers,
    body: req.body,
    redirect: "manual",
  });
  
  return fetch(proxyReq);
}

export async function startProxy(cfg: Config): Promise<Server<WebSocketData>> {
  setConfig(cfg);
  
  server = serve({
    port: cfg.settings.proxy_port,
    hostname: "127.0.0.1",
    
    async fetch(req, srv) {
      const host = req.headers.get("host") ?? "";
      const subdomainRaw = host.split(".localhost")[0];
      const subdomain = subdomainRaw?.toLowerCase() ?? "";
      
      if (!subdomain || !nameToConfig.has(subdomain)) {
        return new Response("Project not found", { status: 404 });
      }
      
      const projectConfig = nameToConfig.get(subdomain)!;
      const projectName = projectConfig.name;
      
      if (req.headers.get("upgrade") === "websocket") {
        const state = getProjectState(projectName);
        
        if (state?.status !== "running" || !state.port) {
          return new Response("Server not running", { status: 503 });
        }
        
        const upgraded = srv.upgrade(req, {
          data: { projectName, targetPort: state.port } as WebSocketData,
        });
        
        return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 500 });
      }
      
      const state = getProjectState(projectName);
      
      if (state?.status === "running" && state.port) {
        if (await checkHealth(state.port)) {
          updateActivity(projectName);
          return proxyRequest(req, state.port);
        }
      }
      
      const { port } = await startProject(projectName, projectConfig, cfg.settings);
      
      const healthy = await waitForHealthy(port, cfg.settings);
      
      if (!healthy) {
        await stopProject(projectName);
        return new Response("Server failed to start", { status: 503 });
      }
      
      markPortUsed(port);
      updateActivity(projectName);
      return proxyRequest(req, port);
    },
    
    websocket: {
      data: { projectName: "", targetPort: 0, connected: false } as WebSocketData,
      
      open(ws) {
        const { targetPort, projectName } = ws.data;
        
        try {
          const url = `ws://localhost:${targetPort}`;
          const targetWs = new WebSocket(url);
          
          targetWs.onopen = () => {
            ws.data.targetWs = targetWs;
            ws.data.connected = true;
            incrementWebSockets(projectName);
          };
          
          targetWs.onmessage = (e) => {
            ws.send(e.data);
          };
          
          targetWs.onclose = () => {
            ws.close();
          };
          
          targetWs.onerror = () => {
            ws.close();
          };
        } catch {
          ws.close();
        }
      },
      
      message(ws, message) {
        ws.data.targetWs?.send(message);
      },
      
      close(ws) {
        const { projectName, targetWs, connected } = ws.data;
        if (connected) {
          decrementWebSockets(projectName);
        }
        targetWs?.close();
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