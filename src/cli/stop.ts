import { existsSync, readFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { stopService, isSystemdAvailable, getServiceStatus } from "../lib/systemd";

const PID_FILE = `${homedir()}/.local/share/lazydev/proxy.pid`;

export async function run() {
  // Try systemd first
  if (isSystemdAvailable()) {
    const status = getServiceStatus();
    
    if (status.active) {
      const result = await stopService();
      console.log(result.message);
      return;
    }
  }
  
  // Fall back to PID file
  const pidStr = existsSync(PID_FILE) ? readFileSync(PID_FILE, "utf-8").trim() : null;
  
  if (pidStr) {
    const pid = parseInt(pidStr);
    try {
      process.kill(pid, "SIGTERM");
      console.log(`✓ Sent SIGTERM to proxy process (PID: ${pid})`);
      unlinkSync(PID_FILE);
      return;
    } catch {
      // Process not found, remove stale PID file
      try { unlinkSync(PID_FILE); } catch { /* ignore */ }
    }
  }
  
  // Fallback: try to find process on port 80
  try {
    const { execSync } = require("child_process");
    const output = execSync("lsof -ti:80 -t 2>/dev/null || true", { encoding: "utf-8" }).trim();
    if (output) {
      const pids = output.split("\n").filter(Boolean);
      for (const p of pids) {
        try {
          process.kill(parseInt(p), "SIGTERM");
          console.log(`✓ Stopped process on port 80 (PID: ${p})`);
        } catch {
          // Ignore
        }
      }
      if (pids.length > 0) return;
    }
  } catch {
    // lsof not available
  }
  
  console.log("No proxy process found. Is LazyDev running?");
  process.exit(1);
}
