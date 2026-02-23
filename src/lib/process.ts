import { spawn, type Subprocess } from "bun";
import type { ProjectConfig, Settings } from "./types";
import { setProjectState, getProjectState, setColdStartTime, getAllStates, addLogEntry } from "./state";
import { findAvailablePort, releasePort, markPortUsed } from "./port";

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
      
      // Flush remaining buffer
      if (buffer.trim()) {
        addLogEntry(name, streamName, buffer);
      }
    } catch {
      // Stream closed or error
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
  const currentState = getProjectState(name);
  
  // Check if already running (either managed or orphan)
  if (currentState?.status === "running" && currentState.pid && currentState.port) {
    // Verify the process is actually alive
    const isAlive = await isProcessRunning(currentState.pid);
    if (isAlive) {
      return { port: currentState.port, coldStartTime: 0 };
    }
    // Process died - clean up and continue to start fresh
    if (currentState.port) {
      releasePort(currentState.port);
    }
    clearOrphanPid(name);
  }
  
  // Clear any orphan tracking since we're starting fresh
  clearOrphanPid(name);
  
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
  
  const startTime = Date.now();
  
  const proc = spawn({
    cmd: ["sh", "-c", config.start_cmd],
    cwd: config.cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  
  processes.set(name, proc);
  
  // Start piping output to logs database
  pipeOutputToLogs(name, proc);
  
  const healthy = await waitForHealthy(port, settings);
  
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
  } else {
    proc.kill();
    processes.delete(name);
    releasePort(port);
    setProjectState(name, {
      status: "stopped",
      pid: null,
      port: null,
    });
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
    return;
  }
  
  const proc = processes.get(name);
  const orphanPid = orphanPids.get(name);
  const pid = proc?.pid ?? orphanPid ?? state.pid;
  
  // Send SIGTERM first for graceful shutdown
  if (proc) {
    proc.kill("SIGTERM");
  } else if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already dead
    }
  }
  
  // Wait for graceful shutdown, escalate to SIGKILL if needed
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
  
  // Clean up tracking
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
        // Try to kill any lingering process
        try {
          process.kill(state.pid, "SIGTERM");
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
