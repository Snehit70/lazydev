import { loadConfig } from "../lib/config";
import { startProxy, stopProxy, setConfig } from "../lib/proxy";

export async function run(_foreground: boolean = false) {
  console.log("Starting LazyDev proxy...\n");
  
  try {
    const config = loadConfig();
    
    setConfig(config);
    await startProxy(config);
    
    console.log(`✓ Proxy listening on port ${config.settings.proxy_port}`);
    console.log(`  Access projects at: http://<project>.localhost`);
    console.log("\nNote: Start your dev servers manually (e.g., bun dev, npm run dev)");
    console.log("      LazyDev will route requests to the configured ports.\n");
    
    const shutdown = () => {
      console.log("\nStopping...");
      stopProxy();
      process.exit(0);
    };
    
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    
    await new Promise(() => {});
    
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to start:", message);
    process.exit(1);
  }
}
