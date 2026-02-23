import { loadConfig } from "../lib/config";
import { getProjectState, getProjectLogs, getProjectLogsSince, type LogEntry } from "../lib/state";
import { getServiceLogs, followServiceLogs } from "../lib/systemd";

export async function run(name?: string, follow: boolean = false, lines: number = 100) {
  try {
    // If no project name, show daemon logs
    if (!name) {
      if (follow) {
        console.log("Following LazyDev daemon logs (Ctrl+C to stop)...\n");
        await followServiceLogs();
      } else {
        const logs = await getServiceLogs(lines);
        if (logs.trim()) {
          console.log(logs);
        } else {
          console.log("No daemon logs available.");
        }
      }
      return;
    }
    
    // Show logs for specific project
    const config = loadConfig();
    
    if (!config.projects[name]) {
      console.error(`Project "${name}" not found.`);
      process.exit(1);
    }
    
    await showProjectLogs(name, follow, lines);
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

async function showProjectLogs(name: string, follow: boolean, lines: number): Promise<void> {
  const recentLogs = getProjectLogs(name, lines);
  
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
      
      const currentState = getProjectState(name);
      if (currentState?.status !== "running") {
        console.log(`\nProject "${name}" stopped.`);
        process.exit(0);
      }
    };
    
    const intervalId = setInterval(pollLogs, pollInterval);
    
    process.on("SIGINT", () => {
      clearInterval(intervalId);
      console.log("\nStopped following logs.");
      process.exit(0);
    });
    
    await new Promise(() => {});
  }
}
