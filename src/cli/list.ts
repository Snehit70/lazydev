import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { parse } from "yaml";
import type { Config } from "../lib/types";

const HOME = homedir();
const CONFIG_PATH = join(HOME, ".config/lazydev/config.yaml");

export async function run(json: boolean = false) {
  if (!existsSync(CONFIG_PATH)) {
    console.error("Config not found. Run 'lazydev init' first.");
    process.exit(1);
  }
  
  const config = parse(readFileSync(CONFIG_PATH, "utf-8")) as Config;
  const projects = Object.entries(config.projects);
  
  if (json) {
    console.log(JSON.stringify(projects, null, 2));
    return;
  }
  
  if (projects.length === 0) {
    console.log("No projects configured.");
    console.log("Add one with: lazydev add <path>");
    return;
  }
  
  console.log("Configured Projects:\n");
  console.log("  Name              Directory                    Command");
  console.log("  ─────────────────────────────────────────────────────────");
  
  for (const [name, project] of projects) {
    const dir = project.cwd.replace(HOME, "~");
    console.log(`  ${name.padEnd(17)} ${dir.padEnd(28)} ${project.start_cmd}`);
  }
  
  console.log("\nAccess at: http://<name>.localhost");
}
