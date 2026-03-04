import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { dirname } from "path";
import { parse, stringify } from "yaml";
import type { RawProjectConfig } from "../lib/types";

const HOME = homedir();
const CONFIG_PATH = HOME + "/.config/lazydev/config.yaml";

interface RawConfig {
  settings?: Record<string, unknown>;
  projects: Record<string, RawProjectConfig>;
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

function prompt(question: string, defaultVal: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

export interface AddOptions {
  name?: string | undefined;
  port?: number | undefined;
  nonInteractive?: boolean;
}

export async function run(options: AddOptions = {}) {
  if (!options.port) {
    console.error("Usage: lazydev add --port <port> [options]");
    console.error("");
    console.error("Options:");
    console.error("  --port <port>     Port your dev server runs on (required)");
    console.error("  --name <name>     Project name (default: derived from port)");
    console.error("  -y, --yes         Skip interactive prompts");
    console.error("");
    console.error("Examples:");
    console.error("  lazydev add --port 3000");
    console.error("  lazydev add --port 5173 --name myapp");
    process.exit(1);
  }
  
  const port = options.port;
  
  if (port < 1 || port > 65535) {
    console.error(`Invalid port: ${port}`);
    process.exit(1);
  }
  
  let name = options.name ?? `project${port}`;
  name = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  
  if (!options.nonInteractive) {
    console.log(`\n  Port: ${port}`);
    console.log("");
    
    name = await prompt(`? Project name (${name}): `, name);
    name = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
    
    const nameError = validateName(name);
    if (nameError) {
      console.error(`Invalid name: ${nameError}`);
      process.exit(1);
    }
    
    console.log("\n  ─────────────────────────────────────────");
    console.log(`  Name:    ${name}`);
    console.log(`  Port:    ${port}`);
    console.log(`  URL:     http://${name}.localhost`);
    console.log("  ─────────────────────────────────────────\n");
    
    const confirm = await prompt("? Add this project? [Y/n]: ", "y");
    if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
      console.log("Cancelled.");
      process.exit(0);
    }
  }
  
  const nameError = validateName(name);
  if (nameError) {
    console.error(`Invalid name "${name}": ${nameError}`);
    process.exit(1);
  }
  
  const configContent = existsSync(CONFIG_PATH) 
    ? readFileSync(CONFIG_PATH, "utf-8") 
    : "settings:\n  proxy_port: 80\nprojects:\n";
  
  const config = parse(configContent) as RawConfig;
  
  if (!config.projects) {
    config.projects = {};
  }
  
  if (config.projects[name]) {
    console.error(`Project "${name}" already exists. Use 'lazydev remove ${name}' first.`);
    process.exit(1);
  }
  
  for (const [existingName, existingProject] of Object.entries(config.projects)) {
    if (existingProject.port === port) {
      console.error(`Port ${port} is already used by project "${existingName}".`);
      process.exit(1);
    }
  }
  
  config.projects[name] = {
    port,
  };
  
  const configDir = dirname(CONFIG_PATH);
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  
  writeFileSync(CONFIG_PATH, stringify(config));
  
  console.log(`\n✓ Added project: ${name}`);
  console.log(`  URL: http://${name}.localhost\n`);
  console.log("Note: Make sure your dev server is running on port " + port + "\n");
}
