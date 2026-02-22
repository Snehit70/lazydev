import { stopProxy } from "../lib/proxy";
import { stopIdleWatcher } from "../lib/idle";

export async function run() {
  console.log("Stopping LazyDev daemon...\n");
  
  stopIdleWatcher();
  stopProxy();
  
  console.log("✓ LazyDev stopped");
}
