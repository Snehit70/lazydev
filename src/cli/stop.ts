import { stopService, getServiceStatus } from "../lib/systemd";

export async function run() {
  const status = await getServiceStatus();
  
  if (!status.active) {
    console.log("LazyDev is not running.");
    return;
  }
  
  console.log("Stopping LazyDev service...\n");
  const result = await stopService();
  
  if (result.success) {
    console.log("✓ LazyDev service stopped");
  } else {
    console.error("Failed to stop service:", result.message);
    process.exit(1);
  }
}
