import { loadConfig } from "../lib/config";
import { startProxy, stopProxy, setConfig } from "../lib/proxy";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";

const DATA_DIR = `${homedir()}/.local/share/lazydev`;
const PID_FILE = `${DATA_DIR}/proxy.pid`;

export async function run(_foreground: boolean = false) {
  console.log("Starting LazyDev proxy...\n");
  
  try {
    const config = loadConfig();
    
    setConfig(config);
    await startProxy(config);
    
    // Save PID only after successful start
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    writeFileSync(PID_FILE, String(process.pid));
    
    console.log(`✓ Proxy listening on port ${config.settings.proxy_port}`);
    console.log(`  Access projects at: http://<project>.localhost`);
    console.log("\nNote: Start your dev servers manually (e.g., bun dev, npm run dev)");
    console.log("      LazyDev will route requests to the configured ports.\n");
    
    const shutdown = () => {
      console.log("\nStopping...");
      stopProxy();
      if (existsSync(PID_FILE)) {
        require("fs").unlinkSync(PID_FILE);
      }
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
