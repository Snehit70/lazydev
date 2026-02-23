import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, basename } from "path";
import { parse, stringify } from "yaml";
import type { Config } from "../lib/types";
import { expandTilde } from "../lib/config";

const HOME = homedir();
const CONFIG_PATH = join(HOME, ".config/lazydev/config.yaml");

function detectStartCmd(cwd: string): string {
  const pkgPath = join(cwd, "package.json");
  
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.scripts?.dev) return "bun dev";
      if (pkg.scripts?.start) return "bun start";
    } catch {}
  }
  
  if (existsSync(join(cwd, "bunfig.toml"))) {
    return "bun dev";
  }
  
  return "bun dev";
}

function validateName(name: string): string | null {
  if (!/^[a-z][a-z0-9-]*$/i.test(name)) {
    return "Name must start with a letter and contain only letters, numbers, and hyphens";
  }
  if (name.length > 63) {
    return "Name must be 63 characters or less";
  }
  return null;
}

export async function run(path?: string) {
  if (!path) {
    console.error("Usage: lazydev add <path>");
    console.error("Example: lazydev add ~/projects/myproject");
    process.exit(1);
  }
  
  const cwd = expandTilde(path);
  
  if (!existsSync(cwd)) {
    console.error(`Directory not found: ${cwd}`);
    process.exit(1);
  }
  
  const defaultName = basename(cwd).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  
  console.log(`Adding project: ${cwd}\n`);
  
  console.log(`? Project name [${defaultName}]: `);
  let name = defaultName;
  
  const validationError = validateName(name);
  if (validationError) {
    console.error(`Invalid name: ${validationError}`);
    process.exit(1);
  }
  
  const detectedCmd = detectStartCmd(cwd);
  console.log(`? Start command [${detectedCmd}]: `);
  const startCmd = detectedCmd;
  
  console.log(`? Idle timeout [10m]: `);
  const idleTimeout = "10m";
  
  const configContent = existsSync(CONFIG_PATH) 
    ? readFileSync(CONFIG_PATH, "utf-8") 
    : "settings:\n  proxy_port: 80\n  idle_timeout: 10m\nprojects:\n";
  
  const config = parse(configContent) as Config;
  
  if (!config.projects) {
    config.projects = {};
  }
  
  if (config.projects[name]) {
    console.error(`Project "${name}" already exists. Use 'lazydev remove ${name}' first.`);
    process.exit(1);
  }
  
  config.projects[name] = {
    name,
    cwd,
    start_cmd: startCmd,
    idle_timeout: idleTimeout as any,
  };
  
  writeFileSync(CONFIG_PATH, stringify(config));
  
  console.log(`\n✓ Added project: ${name}`);
  console.log(`  Access at: http://${name}.localhost`);
  console.log(`  Config: ${CONFIG_PATH}`);
}
