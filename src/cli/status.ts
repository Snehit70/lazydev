import { loadConfig } from "../lib/config";

async function checkHealth(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  
  try {
    const response = await fetch(`http://localhost:${port}`, {
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    return response.ok || response.status === 304;
  } catch {
    clearTimeout(timeout);
    return false;
  }
}

export async function run(name?: string) {
  try {
    const config = loadConfig();
    
    if (name) {
      const project = config.projects[name];
      
      if (!project) {
        console.error(`Project "${name}" not found in config.`);
        process.exit(1);
      }
      
      const isHealthy = await checkHealth(project.port);
      const status = isHealthy ? "🟢 running" : "🔴 not responding";
      
      console.log(`Project: ${name}`);
      console.log(`  Status: ${status}`);
      console.log(`  Port:   ${project.port}`);
      console.log(`  URL:    http://${name}.localhost`);
      return;
    }
    
    const projectNames = Object.keys(config.projects);
    
    if (projectNames.length === 0) {
      console.log("No projects configured.");
      console.log("Add one with: lazydev add --port <port>");
      return;
    }
    
    console.log("\nProject Status:\n");
    console.log("  Name              Status      Port");
    console.log("  ─────────────────────────────────────");
    
    for (const name of projectNames) {
      const project = config.projects[name];
      if (!project) continue;
      
      const isHealthy = await checkHealth(project.port);
      const status = isHealthy ? "🟢 running" : "🔴 not responding";
      
      console.log(`  ${name.padEnd(17)} ${status.padEnd(10)} ${project.port}`);
    }
    
    console.log("\nAccess at: http://<project>.localhost");
    console.log("Note: Start your dev servers manually first\n");
    
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error:", message);
    process.exit(1);
  }
}
