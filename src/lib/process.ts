import { spawn, type Subprocess } from "bun";
import type { ProjectConfig, Settings } from "./types";
import { setProjectState, getProjectState, setColdStartTime, getAllStates, addLogEntry } from "./state";
import { findAvailablePort, releasePort, markPortUsed } from "./port";
import { detectFramework } from "./framework";

const processes = new Map<string, Subprocess>();
const orphanPids = new Map<string, number>(); // Track PIDs of adopted orphan processes

/**
 * Start piping process output to the log database.
 */
function pipeOutputToLogs(name: string, proc: Subprocess): void {
  const pipeStream = async (stream: ReadableStream<Uint8Array> | null, streamName: "stdout" | "stderr") => {
    if (!stream) return;
    
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    
    // Cancel reader if process exits while read() is pending (prevents hang)
    const exitHandler = () => {
      reader.cancel().catch(() => {});
    };
    proc.exited.then(exitHandler).catch(() => {});
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        // Process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (line.trim()) {
            addLogEntry(name, streamName, line);
          }
        }
      }
      
      // Flush any bytes buffered inside TextDecoder (incomplete multi-byte sequences)
      buffer += decoder.decode();
      
      // Flush remaining buffer
      if (buffer.trim()) {
        addLogEntry(name, streamName, buffer);
      }
    } catch {
      // Stream closed or error
    } finally {
      reader.releaseLock();
    }
  };
  
  // Start piping both streams (don't await - run in background)
  pipeStream(proc.stdout as ReadableStream<Uint8Array> | null, "stdout");
  pipeStream(proc.stderr as ReadableStream<Uint8Array> | null, "stderr");
}

export async function startProject(
  name: string,
  config: ProjectConfig,
  settings: Settings
): Promise<{ port: number; coldStartTime: number }> {
  console.log(`[Process] Starting project: ${name}`);
  
  const currentState = getProjectState(name);
  console.log(`[Process] Current state: ${currentState?.status ?? "none"} (port: ${currentState?.port ?? "none"}, pid: ${currentState?.pid ?? "none"})`);
  
  if (currentState?.status === "running" && currentState.pid && currentState.port) {
    const isAlive = await isProcessRunning(currentState.pid);
    if (isAlive) {
      console.log(`[Process] Project ${name} already running (PID: ${currentState.pid}, port: ${currentState.port})`);
      return { port: currentState.port, coldStartTime: 0 };
    }
    console.log(`[Process] Process died, cleaning up`);
    if (currentState.port) {
      releasePort(currentState.port);
    }
    clearOrphanPid(name);
  }
  
  clearOrphanPid(name);
  
  const port = await findAvailablePort(settings);
  
  setProjectState(name, {
    status: "starting",
    port,
    started_at: Date.now(),
  });
  console.log(`[Process] State changed: ${name} → starting (port: ${port})`);
  
  // Detect framework for proper env vars
  const framework = detectFramework(config.cwd);
  console.log(`[Process] Detected framework: ${framework.name} (Vite-based: ${framework.isViteBased})`);
  
  // Expand bun/node to full path (systemd doesn't have user PATH)
  let startCmd = config.start_cmd;
  if (startCmd.startsWith("bun ")) {
    startCmd = `${process.execPath} ${startCmd.slice(4)}`;
    console.log(`[Process] Expanded 'bun' → '${process.execPath}'`);
  }
  
  const publicOrigin = `http://${name}.localhost`;
  
  // Environment variables for frameworks
  const env: Record<string, string | undefined> = {
    ...process.env,
    PORT: String(port),
    HOST: "0.0.0.0",
    // General
    SERVER_PORT: String(port),
  };
  
  // Vite-based frameworks: inject VITE_SERVER_ORIGIN to generate correct URLs
  // This tells Vite to use the proxy URL (no port) instead of internal port
  if (framework.isViteBased) {
    env["VITE_SERVER_ORIGIN"] = publicOrigin;
    console.log(`[Process] Injecting VITE_SERVER_ORIGIN=${publicOrigin}`);
  }
  
  // Framework-specific env vars
  switch (framework.type) {
    case "nuxt":
      env["NUXT_HOST"] = "0.0.0.0";
      env["NUXT_PORT"] = String(port);
      break;
    case "next":
      env["NEXT_PUBLIC_PORT"] = String(port);
      break;
    case "sveltekit":
      // SvelteKit uses Vite, so VITE_SERVER_ORIGIN handles it
      break;
    case "astro":
      // Astro uses Vite, so VITE_SERVER_ORIGIN handles it
      break;
  }
  
  console.log(`[Process] Spawning process:`);
  console.log(`[Process]   cwd: ${config.cwd}`);
  console.log(`[Process]   cmd: ${startCmd}`);
  console.log(`[Process]   env: PORT=${port}, HOST=0.0.0.0`);
  
  const startTime = Date.now();
  
  const proc = spawn({
    cmd: ["sh", "-c", startCmd],
    cwd: config.cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  
  processes.set(name, proc);
  console.log(`[Process] Spawned PID: ${proc.pid}`);
  
  pipeOutputToLogs(name, proc);
  
  console.log(`[Process] Waiting for healthy (timeout: ${settings.startup_timeout}ms)`);
  const healthy = await waitForHealthy(port, settings, name);
  
  const coldStartTime = Date.now() - startTime;
  
  if (healthy) {
    setColdStartTime(name, coldStartTime);
    
    setProjectState(name, {
      status: "running",
      pid: proc.pid,
      port,
      last_activity: Date.now(),
      started_at: Date.now(),
    });
    console.log(`[Process] State changed: ${name} → running (PID: ${proc.pid}, port: ${port}, cold start: ${coldStartTime}ms)`);
  } else {
    console.log(`[Process] Health check failed, killing process (PID: ${proc.pid})`);
    proc.kill();
    processes.delete(name);
    releasePort(port);
    setProjectState(name, {
      status: "stopped",
      pid: null,
      port: null,
    });
    console.log(`[Process] State changed: ${name} → stopped (timeout after ${settings.startup_timeout}ms)`);
    throw new Error(`Server failed to start within ${settings.startup_timeout}ms`);
  }
  
  return { port, coldStartTime };
}

const GRACEFUL_SHUTDOWN_TIMEOUT = 5000; // 5 seconds

/**
 * Wait for a process to exit, with timeout.
 * Returns true if process exited, false if timeout.
 */
async function waitForProcessExit(pid: number, timeout: number): Promise<boolean> {
  const start = Date.now();
  const interval = 100;
  
  while (Date.now() - start < timeout) {
    const running = await isProcessRunning(pid);
    if (!running) {
      return true;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  
  return false;
}

export async function stopProject(name: string): Promise<void> {
  const state = getProjectState(name);
  
  if (!state || state.status !== "running") {
    console.log(`[Process] stopProject: ${name} not running`);
    return;
  }
  
  console.log(`[Process] Stopping: ${name} (PID: ${state.pid})`);
  
  const proc = processes.get(name);
  const orphanPid = orphanPids.get(name);
  const pid = proc?.pid ?? orphanPid ?? state.pid;
  
  if (proc) {
    proc.kill("SIGTERM");
  } else if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already dead
    }
  }
  
  if (pid) {
    const exited = await waitForProcessExit(pid, GRACEFUL_SHUTDOWN_TIMEOUT);
    
    if (!exited) {
      console.log(`[Process] ${name} didn't exit gracefully, sending SIGKILL`);
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Process already dead
      }
      await waitForProcessExit(pid, 1000);
    }
  }
  
  if (proc) {
    processes.delete(name);
  }
  if (orphanPid) {
    orphanPids.delete(name);
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
  console.log(`[Process] State changed: ${name} → stopped`);
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
  settings: Settings,
  name?: string
): Promise<boolean> {
  const start = Date.now();
  const interval = 500;
  let attempt = 0;
  const maxAttempts = Math.ceil(settings.startup_timeout / interval);
  
  while (Date.now() - start < settings.startup_timeout) {
    attempt++;
    const healthy = await checkHealth(port);
    if (healthy) {
      console.log(`[Health] ${name ?? "server"}:${port} → healthy (attempt ${attempt}/${maxAttempts})`);
      return true;
    }
    console.log(`[Health] ${name ?? "server"}:${port} → not ready (attempt ${attempt}/${maxAttempts})`);
    await new Promise((r) => setTimeout(r, interval));
  }
  
  console.log(`[Health] ${name ?? "server"}:${port} → TIMEOUT after ${attempt} attempts`);
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

export async function stopAllProjects(): Promise<void> {
  const names = Array.from(processes.keys());
  await Promise.all(names.map((name) => stopProject(name)));
  
  // Also stop any orphan processes we adopted (with graceful shutdown)
  for (const [name, pid] of orphanPids) {
    const state = getProjectState(name);
    
    try {
      process.kill(pid, "SIGTERM");
      console.log(`[Process] Stopping orphan process ${name} (PID: ${pid})`);
      
      const exited = await waitForProcessExit(pid, GRACEFUL_SHUTDOWN_TIMEOUT);
      if (!exited) {
        console.log(`[Process] Orphan ${name} didn't exit gracefully, sending SIGKILL`);
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already dead
        }
        await waitForProcessExit(pid, 1000);
      }
    } catch {
      // Process already dead
    }
    
    // Update DB state for this orphan
    if (state?.port) {
      releasePort(state.port);
    }
    setProjectState(name, {
      status: "stopped",
      pid: null,
      port: null,
      last_activity: null,
    });
  }
  orphanPids.clear();
}

/**
 * Reconcile in-memory state with DB on daemon startup.
 * - Checks if "running" processes are actually alive
 * - Cleans up dead processes
 * - Adopts orphan processes (tracks PID for later cleanup)
 * - Marks ports as used for live processes
 */
export async function reconcileOrphanProcesses(): Promise<{ adopted: number; cleaned: number }> {
  const states = getAllStates();
  let adopted = 0;
  let cleaned = 0;
  
  for (const [name, state] of Object.entries(states)) {
    // Handle stale "starting" state (daemon crashed during startup)
    if (state.status === "starting") {
      if (state.pid) {
        // Kill any lingering process with graceful escalation
        try {
          process.kill(state.pid, "SIGTERM");
          const exited = await waitForProcessExit(state.pid, GRACEFUL_SHUTDOWN_TIMEOUT);
          
          if (!exited) {
            try {
              process.kill(state.pid, "SIGKILL");
            } catch {
              // Already dead
            }
            await waitForProcessExit(state.pid, 1000);
          }
        } catch {
          // Process already dead
        }
      }
      setProjectState(name, {
        status: "stopped",
        pid: null,
        port: null,
        websocket_connections: 0,
      });
      if (state.port) {
        releasePort(state.port);
      }
      console.log(`[Process] Cleaned stale 'starting' state: ${name}`);
      cleaned++;
      continue;
    }
    
    if (state.status !== "running" || !state.pid) {
      continue;
    }
    
    const isAlive = await isProcessRunning(state.pid);
    
    if (isAlive && state.port) {
      // Process is still running with valid port - adopt it
      orphanPids.set(name, state.pid);
      markPortUsed(state.port);
      console.log(`[Process] Adopted orphan: ${name} (PID: ${state.pid}, port: ${state.port})`);
      adopted++;
    } else if (isAlive && !state.port) {
      // Process is alive but has no port - can't proxy to it, kill it
      try {
        process.kill(state.pid, "SIGTERM");
        const exited = await waitForProcessExit(state.pid, GRACEFUL_SHUTDOWN_TIMEOUT);
        
        if (!exited) {
          // Escalate to SIGKILL
          try {
            process.kill(state.pid, "SIGKILL");
          } catch {
            // Already dead
          }
          await waitForProcessExit(state.pid, 1000);
        }
      } catch {
        // Process already dead or can't be killed
      }
      setProjectState(name, {
        status: "stopped",
        pid: null,
        port: null,
        websocket_connections: 0,
      });
      console.log(`[Process] Killed portless orphan: ${name} (PID: ${state.pid})`);
      cleaned++;
    } else {
      // Process is dead - clean up state
      setProjectState(name, {
        status: "stopped",
        pid: null,
        port: null,
        websocket_connections: 0,
      });
      if (state.port) {
        releasePort(state.port);
      }
      console.log(`[Process] Cleaned stale state: ${name} (was PID: ${state.pid})`);
      cleaned++;
    }
  }
  
  return { adopted, cleaned };
}

/**
 * Check if we have an orphan PID for a project (adopted from previous daemon run)
 */
export function getOrphanPid(name: string): number | undefined {
  return orphanPids.get(name);
}

/**
 * Remove orphan tracking when we start a fresh process
 */
export function clearOrphanPid(name: string): void {
  orphanPids.delete(name);
}
