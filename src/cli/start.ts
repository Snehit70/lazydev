import { loadConfig, CONFIG_PATH, expandTilde } from "../lib/config";
import { startProxy, stopProxy, setConfig, watchConfig, stopConfigWatcher } from "../lib/proxy";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { startService, isSystemdAvailable, getServiceStatus } from "../lib/systemd";

const DATA_DIR = `${homedir()}/.local/share/lazydev`;
const PID_FILE = `${DATA_DIR}/proxy.pid`;

export async function run(foreground: boolean = false) {
  console.log("Starting LazyDev proxy...\n");
  
  // Try systemd first, fall back to foreground
  const useSystemd = !foreground && isSystemdAvailable();
  
  if (useSystemd) {
    const status = getServiceStatus();
    if (status.active) {
      console.log("✓ LazyDev service is already running");
      console.log("  Use 'lazydev restart' to restart");
      console.log("  Use 'lazydev stop' to stop\n");
      return;
    }
    
    const result = await startService();
    if (result.success) {
      console.log("✓ LazyDev service started");
      console.log("  Access projects at: http://<project>.localhost\n");
      return;
    }
    
    console.log("⚠ Systemd failed, starting in foreground mode...");
    console.log("");
  }
  
  // Foreground mode (original behavior)
  try {
    const config = loadConfig();
    const configPath = expandTilde(CONFIG_PATH);
    
    setConfig(config);
    await startProxy(config);
    
    // Watch config for changes
    if (existsSync(configPath)) {
      watchConfig(configPath, () => {
        try {
          const newConfig = loadConfig();
          setConfig(newConfig);
          console.log(`\n✓ Config reloaded - aliases updated\n`);
        } catch (err) {
          console.error(`\n✗ Failed to reload config: ${err}\n`);
        }
      });
    }
    
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
      stopConfigWatcher();
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
