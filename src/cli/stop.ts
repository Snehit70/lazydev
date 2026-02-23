import { stopService, isSystemdAvailable } from "../lib/systemd";

export async function run() {
  if (!isSystemdAvailable()) {
    console.error("Error: systemd is not available on this system.");
    process.exit(1);
  }
  
  console.log("Stopping LazyDev service...\n");
  const result = await stopService();
  
  if (result.success) {
    console.log("✓", result.message);
  } else {
    console.error("Failed to stop service:", result.message);
    process.exit(1);
  }
}
