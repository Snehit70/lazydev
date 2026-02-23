import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, basename } from "path";
import { parse, stringify } from "yaml";
import type { RawProjectConfig } from "../lib/types";

interface RawConfig {
  settings?: Record<string, unknown>;
  projects: Record<string, RawProjectConfig>;
}
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
  
  // Check for other common project types
  if (existsSync(join(cwd, "Cargo.toml"))) {
    return "cargo run";
  }
  
  if (existsSync(join(cwd, "go.mod"))) {
    return "go run .";
  }
  
  if (existsSync(join(cwd, "requirements.txt")) || existsSync(join(cwd, "pyproject.toml"))) {
    // Generic Python - user should override with --cmd if needed
    return "python main.py";
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

export interface AddOptions {
  name?: string | undefined;
  cmd?: string | undefined;
  timeout?: string | undefined;
}

export async function run(path?: string, options: AddOptions = {}) {
  if (!path) {
    console.error("Usage: lazydev add <path> [options]");
    console.error("");
    console.error("Options:");
    console.error("  --name <name>      Project name (default: directory name)");
    console.error("  --cmd <command>    Start command (default: auto-detected)");
    console.error("  --timeout <time>   Idle timeout (default: 10m)");
    console.error("");
    console.error("Examples:");
    console.error("  lazydev add ~/projects/myapp");
    console.error("  lazydev add ~/projects/api --name=backend --cmd='npm run dev'");
    console.error("  lazydev add . --timeout=30m");
    process.exit(1);
  }
  
  const cwd = expandTilde(path);
  
  if (!existsSync(cwd)) {
    console.error(`Directory not found: ${cwd}`);
    process.exit(1);
  }
  
  // Use provided name or derive from directory
  const derivedName = basename(cwd).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  const defaultName = derivedName || "project"; // Fallback if directory name is all non-alphanumeric
  const name = options.name ?? defaultName;
  
  const validationError = validateName(name);
  if (validationError) {
    console.error(`Invalid name "${name}": ${validationError}`);
    process.exit(1);
  }
  
  // Use provided command or auto-detect
  const startCmd = options.cmd ?? detectStartCmd(cwd);
  
  // Use provided timeout or default; treat empty string as "not provided"
  const idleTimeout = options.timeout || "10m";
  
  // Validate timeout format (unit required to avoid confusion)
  if (!/^\d+(ms|s|m|h)$/.test(idleTimeout)) {
    console.error(`Invalid timeout format: "${idleTimeout}". Use format like "10m", "30s", "1h"`);
    process.exit(1);
  }
  
  const configContent = existsSync(CONFIG_PATH) 
    ? readFileSync(CONFIG_PATH, "utf-8") 
    : "settings:\n  proxy_port: 80\n  idle_timeout: 10m\nprojects:\n";
  
  const config = parse(configContent) as RawConfig;
  
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
    idle_timeout: idleTimeout, // String like "10m", parsed by loadConfig()
  };
  
  writeFileSync(CONFIG_PATH, stringify(config));
  
  console.log(`✓ Added project: ${name}`);
  console.log(`  Directory: ${cwd}`);
  console.log(`  Command:   ${startCmd}`);
  console.log(`  Timeout:   ${idleTimeout}`);
  console.log(`  URL:       http://${name}.localhost`);
}
