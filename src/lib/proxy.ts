import { serve, Server } from "bun";
import type { Config, ProjectConfig } from "./types";
import { loadState, setProjectState, getProjectState, updateActivity, incrementWebSockets, decrementWebSockets } from "./state";
import { startProject, stopProject, waitForHealthy, checkHealth } from "./process";
import { markPortUsed } from "./port";
import { readFileSync } from "fs";
import { join } from "path";

const LOADING_PAGE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="2">
  <title>Starting {{project}}...</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0f0f1a; color: #eee; }
    .spinner { width: 40px; height: 40px; border: 3px solid #333; border-top-color: #7c3aed; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .container { text-align: center; }
    p { color: #888; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h2>Starting {{project}}...</h2>
    <p>Usually takes 5-15 seconds</p>
  </div>
</body>
</html>`;

interface WebSocketData {
  projectName: string;
  targetPort: number;
  targetWs?: WebSocket;
}

let server: Server | null = null;
let config: Config | null = null;
const nameToConfig = new Map<string, ProjectConfig>();

export function setConfig(cfg: Config): void {
  config = cfg;
  nameToConfig.clear();
  
  for (const [name, project] of Object.entries(cfg.projects)) {
    nameToConfig.set(name.toLowerCase(), project);
    for (const alias of project.aliases ?? []) {
      nameToConfig.set(alias.toLowerCase(), project);
    }
  }
}

function getLoadingPage(projectName: string): string {
  return LOADING_PAGE.replace(/\{\{project\}\}/g, projectName);
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

export async function startProxy(cfg: Config): Promise<Server> {
  setConfig(cfg);
  
  server = serve({
    port: cfg.settings.proxy_port,
    hostname: "127.0.0.1",
    
    async fetch(req, srv) {
      const host = req.headers.get("host") || "";
      const subdomain = host.split(".localhost")[0].toLowerCase();
      
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
      
      const port = await startProject(projectName, projectConfig, cfg.settings);
      
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
      data: {} as WebSocketData,
      
      open(ws) {
        const { targetPort, projectName } = ws.data;
        incrementWebSockets(projectName);
        
        try {
          const url = `ws://localhost:${targetPort}`;
          const targetWs = new WebSocket(url);
          
          targetWs.onopen = () => {
            ws.data.targetWs = targetWs;
          };
          
          targetWs.onmessage = (e) => {
            ws.send(e.data as string);
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
        ws.data.targetWs?.send(message as string);
      },
      
      close(ws) {
        const { projectName, targetWs } = ws.data;
        decrementWebSockets(projectName);
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

export function getServer(): Server | null {
  return server;
}