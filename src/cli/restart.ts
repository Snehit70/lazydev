import { restartService, getServiceStatus } from "../lib/systemd";

export async function run() {
  const status = await getServiceStatus();
  
  if (!status.active) {
    console.log("LazyDev is not running. Use 'lazydev start' to start it.");
    return;
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
