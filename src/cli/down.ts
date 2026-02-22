import { loadConfig } from "../lib/config";
import { stopProject } from "../lib/process";
import { getAllStates } from "../lib/state";

export async function run(name?: string, all: boolean = false) {
  try {
    const config = loadConfig();
    
    if (all) {
      const states = getAllStates();
      const running = Object.entries(states).filter(([, s]) => s.status === "running");
      
      if (running.length === 0) {
        console.log("No running projects to stop.");
        return;
      }
      
      console.log(`Stopping ${running.length} projects...\n`);
      
      for (const [name] of running) {
        await stopProject(name);
        console.log(`✓ Stopped ${name}`);
      }
      
      return;
    }
    
    if (!name) {
      console.error("Usage: lazydev down <name>");
      console.error("       lazydev down --all");
      process.exit(1);
    }
    
    if (!config.projects[name]) {
      console.error(`Project "${name}" not found in config.`);
      process.exit(1);
    }
    
    console.log(`Stopping ${name}...`);
    await stopProject(name);
    console.log(`✓ Stopped ${name}`);
    
  } catch (err: any) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}
