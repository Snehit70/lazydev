import { loadConfig } from "../lib/config";

export async function run(name?: string) {
  try {
    const config = loadConfig();
    
    if (name && !config.projects[name]) {
      console.error(`Project "${name}" not found.`);
      process.exit(1);
    }
    
    console.log("Logs not yet implemented.");
    console.log("For now, check the process output directly or run with --foreground flag.");
    
  } catch (err: any) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}
