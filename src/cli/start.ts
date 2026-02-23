import { loadConfig, watchConfig, stopWatchingConfig } from "../lib/config";
import { startProxy, stopProxy, setConfig } from "../lib/proxy";
import { startIdleWatcher, setConfigGetter, stopIdleWatcher } from "../lib/idle";
import { saveDaemonPid, removeDaemonPid } from "../lib/state";
import { stopAllProjects, reconcileOrphanProcesses } from "../lib/process";
import { initializePortsFromState } from "../lib/port";
import { startService, getServiceStatus, isSystemdAvailable } from "../lib/systemd";
import type { Config } from "../lib/types";

export async function run(port?: number, foreground: boolean = false) {
  if (!foreground) {
    if (!isSystemdAvailable()) {
      console.error("Error: systemd is not available on this system.");
      console.error("Run 'lazydev start --foreground' to start the daemon directly.");
      process.exit(1);
    }
    
    if (port) {
      console.warn("Warning: --port flag is ignored when using systemd mode.");
      console.warn("         Modify ~/.config/lazydev/config.yaml to change the port.");
    }
    
    const status = await getServiceStatus();
    
    if (status.active) {
      console.log("LazyDev is already running.");
      console.log("\nCommands:");
      console.log("  lazydev status    - Check project status");
      console.log("  lazydev logs      - View daemon logs");
      console.log("  lazydev stop      - Stop the daemon");
      return;
    }
    
    console.log("Starting LazyDev service...\n");
    const result = await startService();
    
    if (result.success) {
      console.log("✓ LazyDev service started");
      console.log("  Access projects at: http://<project>.localhost");
      console.log("\nCommands:");
      console.log("  lazydev status    - Check project status");
      console.log("  lazydev logs      - View daemon logs");
      console.log("  lazydev stop      - Stop the daemon");
    } else {
      console.error("Failed to start service:", result.message);
      process.exit(1);
    }
    return;
  }
  
  // Foreground mode (used by systemd)
  console.log("Starting LazyDev daemon...\n");
  
  try {
    let config = loadConfig();
    
    if (port) {
      config.settings.proxy_port = port;
    }
    
    initializePortsFromState();
    
    const { adopted, cleaned } = await reconcileOrphanProcesses();
    if (adopted > 0 || cleaned > 0) {
      console.log(`✓ Reconciled state: ${adopted} adopted, ${cleaned} cleaned`);
    }
    
    saveDaemonPid(process.pid);
    
    await startProxy(config);
    
    console.log(`✓ Proxy listening on port ${config.settings.proxy_port}`);
    console.log(`  Access projects at: http://<project>.localhost`);
    
    setConfigGetter(() => config.projects);
    startIdleWatcher(config.settings);
    console.log(`✓ Idle watcher started (timeout: ${config.settings.idle_timeout / 60000}m)`);
    
    watchConfig(undefined, (newConfig: Config) => {
      if (port) {
        newConfig.settings.proxy_port = port;
      }
      
      config = newConfig;
      setConfig(newConfig);
      setConfigGetter(() => newConfig.projects);
      stopIdleWatcher();
      startIdleWatcher(newConfig.settings);
      
      console.log(`✓ Hot reloaded: ${Object.keys(newConfig.projects).length} projects`);
    });
    
    console.log("✓ Config hot reload enabled");
    
    const shutdownPromise = new Promise<void>((resolve) => {
      const shutdown = async () => {
        console.log("\nStopping...");
        stopWatchingConfig();
        stopIdleWatcher();
        stopProxy();
        await stopAllProjects();
        removeDaemonPid();
        resolve();
        process.exit(0);
      };
      
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
    
    await shutdownPromise;
    
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to start:", message);
    removeDaemonPid();
    process.exit(1);
  }
}
