import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { parse, stringify } from "yaml";
import type { Config } from "../lib/types";

const CONFIG_PATH = join(process.env["HOME"]!, ".config/lazydev/config.yaml");

export async function run(name?: string) {
  if (!name) {
    console.error("Usage: lazydev remove <name>");
    process.exit(1);
  }
  
  if (!existsSync(CONFIG_PATH)) {
    console.error("Config not found. Run 'lazydev init' first.");
    process.exit(1);
  }
  
  const config = parse(readFileSync(CONFIG_PATH, "utf-8")) as Config;
  
  if (!config.projects[name]) {
    console.error(`Project "${name}" not found.`);
    process.exit(1);
  }
  
  delete config.projects[name];
  
  writeFileSync(CONFIG_PATH, stringify(config));
  
  console.log(`✓ Removed project: ${name}`);
}
