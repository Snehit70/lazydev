import { loadConfig } from "../lib/config";
import { startProxy } from "../lib/proxy";
import { startIdleWatcher } from "../lib/idle";

export async function run(port?: number) {
  console.log("Starting LazyDev daemon...\n");
  
  try {
    const config = loadConfig();
    
    if (port) {
      config.settings.proxy_port = port;
    }
    
    const server = await startProxy(config);
    
    console.log(`✓ Proxy listening on port ${config.settings.proxy_port}`);
    console.log(`  Access projects at: http://<project>.localhost`);
    
    startIdleWatcher(config.settings);
    console.log(`✓ Idle watcher started (timeout: ${config.settings.idle_timeout / 60000}m)`);
    
    console.log("\nPress Ctrl+C to stop");
    
    process.on("SIGINT", () => {
      console.log("\nStopping...");
      process.exit(0);
    });
    
    process.on("SIGTERM", () => {
      console.log("\nStopping...");
      process.exit(0);
    });
    
    await new Promise(() => {});
    
  } catch (err: any) {
    console.error("Failed to start:", err.message);
    process.exit(1);
  }
}
