import { loadConfig } from "../lib/config";
import { startProxy, stopProxy } from "../lib/proxy";
import { startIdleWatcher, setConfigGetter, stopIdleWatcher } from "../lib/idle";
import { saveDaemonPid, removeDaemonPid } from "../lib/state";
import { stopAllProjects } from "../lib/process";

export async function run(port?: number) {
  console.log("Starting LazyDev daemon...\n");
  
  try {
    const config = loadConfig();
    
    if (port) {
      config.settings.proxy_port = port;
    }
    
    saveDaemonPid(process.pid);
    
    await startProxy(config);
    
    console.log(`✓ Proxy listening on port ${config.settings.proxy_port}`);
    console.log(`  Access projects at: http://<project>.localhost`);
    
    setConfigGetter(() => config.projects);
    startIdleWatcher(config.settings);
    console.log(`✓ Idle watcher started (timeout: ${config.settings.idle_timeout / 60000}m)`);
    
    console.log("\nPress Ctrl+C to stop");
    
    const shutdown = async () => {
      console.log("\nStopping...");
      stopIdleWatcher();
      stopProxy();
      await stopAllProjects();
      removeDaemonPid();
      process.exit(0);
    };
    
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    
    await new Promise(() => {});
    
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to start:", message);
    removeDaemonPid();
    process.exit(1);
  }
}
