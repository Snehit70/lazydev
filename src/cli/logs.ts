import { loadConfig } from "../lib/config";
import { getProjectState, getProjectLogs, getProjectLogsSince, type LogEntry } from "../lib/state";

export async function run(name?: string, follow: boolean = false) {
  try {
    const config = loadConfig();
    
    if (name && !config.projects[name]) {
      console.error(`Project "${name}" not found.`);
      process.exit(1);
    }
    
    if (name) {
      await showProjectLogs(name, follow);
    } else {
      // Show logs for all projects
      const projects = Object.keys(config.projects);
      if (projects.length === 0) {
        console.log("No projects configured.");
        return;
      }
      
      for (const project of projects) {
        const logs = getProjectLogs(project, 50);
        if (logs.length > 0) {
          console.log(`\n=== ${project} ===`);
          printLogs(logs);
        }
      }
      
      if (projects.every(p => getProjectLogs(p, 1).length === 0)) {
        console.log("No logs available. Start some projects first.");
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error:", message);
    process.exit(1);
  }
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function printLogs(logs: LogEntry[]): void {
  for (const log of logs) {
    const time = formatTimestamp(log.timestamp);
    const prefix = log.stream === "stderr" ? "err" : "out";
    console.log(`[${time}] [${prefix}] ${log.message}`);
  }
}

async function showProjectLogs(name: string, follow: boolean): Promise<void> {
  // Show recent logs first
  const recentLogs = getProjectLogs(name, 100);
  
  if (recentLogs.length === 0) {
    const state = getProjectState(name);
    if (state?.status !== "running") {
      console.log(`Project "${name}" is not running and has no logs.`);
    } else {
      console.log(`No logs yet for "${name}".`);
    }
    
    if (!follow) {
      return;
    }
  } else {
    printLogs(recentLogs);
  }
  
  if (follow) {
    const state = getProjectState(name);
    if (state?.status !== "running") {
      console.log(`\nProject "${name}" is not running. Cannot follow logs.`);
      return;
    }
    
    console.log(`\nFollowing logs for ${name} (Ctrl+C to stop)...\n`);
    
    // Poll for new logs
    let lastTimestamp = recentLogs.length > 0 
      ? recentLogs[recentLogs.length - 1]!.timestamp 
      : Date.now();
    
    const pollInterval = 500;
    
    const pollLogs = () => {
      const newLogs = getProjectLogsSince(name, lastTimestamp);
      
      if (newLogs.length > 0) {
        printLogs(newLogs);
        lastTimestamp = newLogs[newLogs.length - 1]!.timestamp;
      }
      
      // Check if project is still running
      const currentState = getProjectState(name);
      if (currentState?.status !== "running") {
        console.log(`\nProject "${name}" stopped.`);
        process.exit(0);
      }
    };
    
    // Set up polling
    const intervalId = setInterval(pollLogs, pollInterval);
    
    // Handle Ctrl+C
    process.on("SIGINT", () => {
      clearInterval(intervalId);
      console.log("\nStopped following logs.");
      process.exit(0);
    });
    
    // Keep running
    await new Promise(() => {});
  }
}
