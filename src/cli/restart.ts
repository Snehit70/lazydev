import { restartService, isSystemdAvailable } from "../lib/systemd";

export async function run() {
  if (!isSystemdAvailable()) {
    console.error("Error: systemd is not available on this system.");
    console.error("Run 'lazydev start --foreground' to start the daemon directly.");
    process.exit(1);
  }
  
  console.log("Restarting LazyDev service...\n");
  const result = await restartService();
  
  if (result.success) {
    console.log("✓ LazyDev service restarted");
  } else {
    console.error("Failed to restart service:", result.message);
    process.exit(1);
  }
}
