import { loadConfig, watchConfig, stopWatchingConfig } from "../lib/config";
import { startProxy, stopProxy, setConfig } from "../lib/proxy";
import { startIdleWatcher, setConfigGetter, stopIdleWatcher } from "../lib/idle";
import { saveDaemonPid, removeDaemonPid } from "../lib/state";
import { stopAllProjects, reconcileOrphanProcesses } from "../lib/process";
import { initializePortsFromState } from "../lib/port";
import type { Config } from "../lib/types";

export async function run(port?: number) {
  console.log("Starting LazyDev daemon...\n");
  
  try {
    let config = loadConfig();
    
    if (port) {
      config.settings.proxy_port = port;
    }
    
    // Initialize port tracking from DB state
    initializePortsFromState();
    
    // Reconcile orphan processes from previous daemon run
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
    
    // Watch for config changes and hot reload
    watchConfig(undefined, (newConfig: Config) => {
      // Preserve port override if it was set
      if (port) {
        newConfig.settings.proxy_port = port;
      }
      
      config = newConfig;
      
      // Update proxy config (project mappings)
      setConfig(newConfig);
      
      // Update idle watcher with new config getter AND settings
      setConfigGetter(() => newConfig.projects);
      
      // Restart idle watcher with new settings (scan_interval, timeouts, etc.)
      stopIdleWatcher();
      startIdleWatcher(newConfig.settings);
      
      console.log(`✓ Hot reloaded: ${Object.keys(newConfig.projects).length} projects`);
    });
    
    console.log("✓ Config hot reload enabled");
    console.log("\nPress Ctrl+C to stop");
    
    // Keep process alive until signal
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
