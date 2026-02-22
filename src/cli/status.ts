import { loadConfig } from "../lib/config";
import { getAllStates } from "../lib/state";
import { checkHealth } from "../lib/process";

export async function run(name?: string) {
  try {
    const config = loadConfig();
    const states = getAllStates();
    
    if (name) {
      const state = states[name];
      const project = config.projects[name];
      
      if (!project) {
        console.error(`Project "${name}" not found in config.`);
        process.exit(1);
      }
      
      const isHealthy = state?.port ? await checkHealth(state.port) : false;
      const status = isHealthy ? "🟢 running" : (state?.status === "starting" ? "🟡 starting" : "🔴 stopped");
      const port = state?.port ?? "-";
      const lastActivity = state?.last_activity 
        ? new Date(state.last_activity).toLocaleTimeString() 
        : "-";
      
      console.log(`Project: ${name}`);
      console.log(`  Status: ${status}`);
      console.log(`  Port: ${port}`);
      console.log(`  Last activity: ${lastActivity}`);
      console.log(`  URL: http://${name}.localhost`);
      return;
    }
    
    const projectNames = Object.keys(config.projects);
    
    if (projectNames.length === 0) {
      console.log("No projects configured.");
      console.log("Add one with: lazydev add <path>");
      return;
    }
    
    console.log("\nProject Status:\n");
    console.log("  Name              Status      Port    Last Activity");
    console.log("  ─────────────────────────────────────────────────────");
    
    for (const name of projectNames) {
      const state = states[name];
      const isHealthy = state?.port ? await checkHealth(state.port) : false;
      const status = isHealthy ? "🟢 running" : (state?.status === "starting" ? "🟡 starting" : "🔴 stopped");
      const port = state?.port?.toString().padEnd(6) ?? "-     ";
      const lastActivity = state?.last_activity 
        ? new Date(state.last_activity).toLocaleTimeString().padEnd(12)
        : "-           ";
      
      console.log(`  ${name.padEnd(17)} ${status.padEnd(10)} ${port}  ${lastActivity}`);
    }
    
    console.log("\nAccess at: http://<project>.localhost");
    
  } catch (err: any) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}
