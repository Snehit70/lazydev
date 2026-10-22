import { stopService, isSystemdAvailable, getServiceStatus } from "../lib/systemd";
import { getForegroundPid } from "../lib/pidfile";

export async function run() {
  // Try systemd first
  if (isSystemdAvailable()) {
    const status = getServiceStatus();

    if (status.active) {
      const result = await stopService();
      console.log(result.success ? `✓ ${result.message}` : result.message);
      if (!result.success) process.exit(1);
      return;
    }
  }

  // Fall back to a foreground proxy started with `lazydev run`
  const pid = getForegroundPid();
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`✓ Stopped proxy process (PID: ${pid})`);
      return;
    } catch (err) {
      console.error(`Failed to stop proxy process ${pid}: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  }

  console.log("No proxy process found. Is LazyDev running?");
  process.exit(1);
}
