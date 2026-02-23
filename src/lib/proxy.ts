import { serve, type Server } from "bun";
import type { Config, ProjectConfig, Settings } from "./types";
import { getProjectState, updateActivity, incrementWebSockets, decrementWebSockets } from "./state";
import { startProject, checkHealth } from "./process";
import { markPortUsed } from "./port";

interface WebSocketData {
  projectName: string;
  targetPort: number;
  targetWs?: WebSocket;
  connected: boolean;
}

let server: Server<WebSocketData> | null = null;
let currentSettings: Settings | null = null;
const nameToConfig = new Map<string, ProjectConfig>();

export function setConfig(cfg: Config): void {
  nameToConfig.clear();
  currentSettings = cfg.settings;
  
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
  
  const proxyHeaders = new Headers(req.headers);
  // Keep Accept-Encoding for compression support
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
      
      console.log(`[Proxy] ${req.method} ${host} → subdomain: "${subdomain}"`);
      
      if (!subdomain || !nameToConfig.has(subdomain)) {
        console.log(`[Proxy] Project not found: "${subdomain}"`);
        return new Response("Project not found", { status: 404 });
      }
      
      const projectConfig = nameToConfig.get(subdomain)!;
      const projectName = projectConfig.name;
      
      let state = getProjectState(projectName);
      console.log(`[Proxy] Project: ${projectName} (status: ${state?.status ?? "none"}, port: ${state?.port ?? "none"})`);
      
      if (req.headers.get("upgrade") === "websocket") {
        console.log(`[Proxy] WebSocket upgrade request`);
        
        // Cold start for WebSocket connections
        if (state?.status !== "running" || !state.port) {
          if (!currentSettings) {
            return new Response("Server not configured", { status: 500 });
          }
          
          try {
            const { port } = await startProject(projectName, projectConfig, currentSettings);
            markPortUsed(port);
            state = getProjectState(projectName);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to start server";
            console.log(`[Proxy] Failed to start: ${message}`);
            return new Response(message, { status: 503 });
          }
        }
        
        if (!state?.port) {
          return new Response("Server failed to start", { status: 503 });
        }
        
        updateActivity(projectName);
        
        const upgraded = srv.upgrade(req, {
          data: { projectName, targetPort: state.port, connected: false } as WebSocketData,
        });
        
        return upgraded 
          ? new Response(null, { status: 101 }) 
          : new Response("WebSocket upgrade failed", { status: 500 });
      }
      
      // HTTP request
      if (state?.status === "running" && state.port) {
        console.log(`[Proxy] Checking health: localhost:${state.port}`);
        if (await checkHealth(state.port)) {
          console.log(`[Proxy] Proxying to running server: localhost:${state.port}`);
          updateActivity(projectName);
          return proxyRequest(req, state.port);
        }
        console.log(`[Proxy] Health check failed, restarting`);
      }
      
      // Cold start
      console.log(`[Proxy] Cold start required for: ${projectName}`);
      const { port } = await startProject(projectName, projectConfig, cfg.settings);
      
      markPortUsed(port);
      updateActivity(projectName);
      console.log(`[Proxy] Proxying to: localhost:${port}`);
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