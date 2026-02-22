import { loadConfig } from "../lib/config";
import { startProject, checkHealth } from "../lib/process";
import { getProjectState } from "../lib/state";

export async function run(name?: string) {
  if (!name) {
    console.error("Usage: lazydev up <name>");
    process.exit(1);
  }
  
  try {
    const config = loadConfig();
    const project = config.projects[name];
    
    if (!project) {
      console.error(`Project "${name}" not found in config.`);
      console.log("Add it with: lazydev add <path>");
      process.exit(1);
    }
    
    const currentState = getProjectState(name);
    
    if (currentState?.status === "running" && currentState.port) {
      const isHealthy = await checkHealth(currentState.port);
      if (isHealthy) {
        console.log(`Project "${name}" is already running on port ${currentState.port}`);
        console.log(`Access at: http://${name}.localhost`);
        return;
      }
    }
    
    console.log(`Starting ${name}...`);
    
    const port = await startProject(name, project, config.settings);
    
    console.log(`✓ Started ${name} on port ${port}`);
    console.log(`  Access at: http://${name}.localhost`);
    
  } catch (err: any) {
    console.error("Failed to start:", err.message);
    process.exit(1);
  }
}
