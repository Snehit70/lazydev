import { serve, type Server } from "bun";
import type { Config, ProjectConfig, Settings } from "./types";
import { getProjectState, updateActivity, incrementWebSockets, decrementWebSockets } from "./state";
import { startProject, checkHealth } from "./process";
import { markPortUsed } from "./port";

/**
 * Retry health check with exponential backoff.
 * Used when a project is marked "running" but fails initial health check
 * (e.g., Nuxt/Vite still warming up internal routes after responding to /).
 */
async function waitForHealthyWithBackoff(port: number, maxWaitMs: number): Promise<boolean> {
  const start = Date.now();
  let delay = 100;
  
  while (Date.now() - start < maxWaitMs) {
    if (await checkHealth(port)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 1000); // Cap at 1s
  }
  
  return false;
}

interface WebSocketData {
  projectName: string;
  targetPort: number;
  targetWs?: WebSocket;
  connected: boolean;
}

let server: Server<WebSocketData> | null = null;
let currentSettings: Settings | null = null;
const nameToConfig = new Map<string, ProjectConfig>();

// Cache health check results to avoid hammering the server with checks on every request
// Key: port number, Value: { healthy: boolean, timestamp: number }
const healthCheckCache = new Map<number, { healthy: boolean; timestamp: number }>();
const HEALTH_CHECK_CACHE_TTL = 2000; // 2 seconds

async function checkHealthCached(port: number): Promise<boolean> {
  const cached = healthCheckCache.get(port);
  const now = Date.now();
  
  // Return cached result if fresh
  if (cached && (now - cached.timestamp) < HEALTH_CHECK_CACHE_TTL) {
    return cached.healthy;
  }
  
  // Perform actual health check
  const healthy = await checkHealth(port);
  healthCheckCache.set(port, { healthy, timestamp: now });
  return healthy;
}

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
  // Change hostname to localhost and port to target (server listens on localhost:port, not subdomain.localhost:port)
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
      
      if (!subdomain || !nameToConfig.has(subdomain)) {
        return new Response("Project not found", { status: 404 });
      }
      
      const projectConfig = nameToConfig.get(subdomain)!;
      const projectName = projectConfig.name;
      
      let state = getProjectState(projectName);
      
      if (req.headers.get("upgrade") === "websocket") {
        console.log(`[Proxy] WebSocket upgrade for: ${projectName}`);
        
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
        // Use cached health check to avoid connection churn
        // (too many health checks cause Nuxt to restart due to ECONNRESET errors)
        if (await checkHealthCached(state.port)) {
          updateActivity(projectName);
          return proxyRequest(req, state.port);
        }
        
        // Health check failed but process state is "running" - likely still warming up
        // (e.g., Nuxt/Vite responds to / but internal routes not ready yet)
        // Retry with backoff before triggering a restart
        const warmedUp = await waitForHealthyWithBackoff(state.port, 5000);
        if (warmedUp) {
          updateActivity(projectName);
          return proxyRequest(req, state.port);
        }
        
        console.log(`[Proxy] ${projectName} unresponsive, restarting`);
      }
      
      // Cold start
      console.log(`[Proxy] Cold start: ${projectName}`);
      const { port } = await startProject(projectName, projectConfig, cfg.settings);
      
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