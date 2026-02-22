import { spawn, Subprocess } from "bun";
import { $ } from "bun";
import type { ProjectConfig } from "./types";
import { setProjectState, getProjectState } from "./state";
import { findAvailablePort, releasePort } from "./port";
import type { Settings } from "./types";

const processes = new Map<string, Subprocess>();

export async function startProject(
  name: string,
  config: ProjectConfig,
  settings: Settings
): Promise<number> {
  const currentState = getProjectState(name);
  
  if (currentState?.status === "running" && currentState.pid) {
    return currentState.port!;
  }
  
  const port = await findAvailablePort(settings);
  
  setProjectState(name, {
    status: "starting",
    port,
    started_at: Date.now(),
  });
  
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: "localhost",
  };
  
  const proc = spawn({
    cmd: ["sh", "-c", config.start_cmd],
    cwd: config.cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  
  processes.set(name, proc);
  
  setProjectState(name, {
    status: "running",
    pid: proc.pid,
    port,
    last_activity: Date.now(),
    started_at: Date.now(),
  });
  
  return port;
}

export async function stopProject(name: string): Promise<void> {
  const state = getProjectState(name);
  
  if (!state || state.status !== "running") {
    return;
  }
  
  const proc = processes.get(name);
  
  if (proc) {
    proc.kill();
    processes.delete(name);
  } else if (state.pid) {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch {
      
    }
  }
  
  if (state.port) {
    releasePort(state.port);
  }
  
  setProjectState(name, {
    status: "stopped",
    pid: null,
    port: null,
    last_activity: null,
  });
}

export async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function checkHealth(port: number, timeout: number = 1000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const res = await fetch(`http://localhost:${port}/`, {
      signal: controller.signal,
      redirect: "manual",
    });
    
    clearTimeout(timeoutId);
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function waitForHealthy(
  port: number,
  settings: Settings
): Promise<boolean> {
  const start = Date.now();
  const interval = 500;
  
  while (Date.now() - start < settings.startup_timeout) {
    if (await checkHealth(port)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  
  return false;
}

export function getProcess(name: string): Subprocess | undefined {
  return processes.get(name);
}

export function getProcessOutput(name: string): { stdout: ReadableStream; stderr: ReadableStream } | null {
  const proc = processes.get(name);
  if (!proc) return null;
  return {
    stdout: proc.stdout as ReadableStream,
    stderr: proc.stderr as ReadableStream,
  };
}