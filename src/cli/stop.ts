import { existsSync, readFileSync } from "fs";
import { homedir } from "os";

const PID_FILE = `${homedir()}/.local/share/lazydev/proxy.pid`;

export async function run() {
  const pidStr = existsSync(PID_FILE) ? readFileSync(PID_FILE, "utf-8").trim() : null;
  
  if (pidStr) {
    const pid = parseInt(pidStr);
    try {
      process.kill(pid, "SIGTERM");
      console.log(`✓ Sent SIGTERM to proxy process (PID: ${pid})`);
      return;
    } catch {
      // Process not found
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
