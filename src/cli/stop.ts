import { readDaemonPid, removeDaemonPid } from "../lib/state";

export async function run() {
  const pid = readDaemonPid();
  
  if (!pid) {
    console.log("LazyDev daemon is not running (no PID file found).");
    return;
  }
  
  try {
    process.kill(pid, "SIGTERM");
    removeDaemonPid();
    console.log(`✓ Stopped LazyDev daemon (PID: ${pid})`);
  } catch {
    removeDaemonPid();
    console.log("LazyDev daemon was not running (stale PID file removed).");
  }
}
