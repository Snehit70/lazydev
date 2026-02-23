import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, basename } from "path";
import { parse, stringify } from "yaml";
import type { RawProjectConfig } from "../lib/types";
import * as readline from "readline";

interface RawConfig {
  settings?: Record<string, unknown>;
  projects: Record<string, RawProjectConfig>;
}
import { expandTilde } from "../lib/config";

const HOME = homedir();
const CONFIG_PATH = join(HOME, ".config/lazydev/config.yaml");

interface DetectedFramework {
  name: string;
  detected: boolean;
  warnings: string[];
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

function detectFramework(pkg: PackageJson | null): DetectedFramework {
  const result: DetectedFramework = { name: "unknown", detected: false, warnings: [] };
  
  if (!pkg?.dependencies && !pkg?.devDependencies) {
    return result;
  }
  
  const deps: Record<string, string> = {};
  if (pkg?.dependencies) Object.assign(deps, pkg.dependencies);
  if (pkg?.devDependencies) Object.assign(deps, pkg.devDependencies);
  
  if ("nuxt" in deps || "nuxt-edge" in deps) {
    result.name = "nuxt";
    result.detected = true;
    result.warnings.push("LazyDev sets NUXT_HOST=0.0.0.0 and NUXT_PORT automatically");
  } else if ("next" in deps) {
    result.name = "next";
    result.detected = true;
    result.warnings.push("LazyDev sets HOST=0.0.0.0 and PORT automatically");
  } else if ("vite" in deps || "@vitejs/plugin-vue" in deps || "@vitejs/plugin-react" in deps) {
    result.name = "vite";
    result.detected = true;
    result.warnings.push("LazyDev sets HOST=0.0.0.0 and PORT automatically");
  } else if ("@angular/core" in deps) {
    result.name = "angular";
    result.detected = true;
    result.warnings.push("LazyDev sets HOST=0.0.0.0 and PORT automatically");
  } else if ("svelte" in deps || "@sveltejs/kit" in deps) {
    result.name = "svelte";
    result.detected = true;
    result.warnings.push("LazyDev sets HOST=0.0.0.0 and PORT automatically");
  }
  
  return result;
}

function detectStartCmd(pkg: PackageJson | null): string {
  if (pkg?.scripts) {
    if ("dev" in pkg.scripts) return "bun dev";
    if ("start" in pkg.scripts) return "bun start";
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

function prompt(rl: readline.ReadLine, question: string, defaultVal: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

function promptYesNo(rl: readline.ReadLine, question: string, defaultYes: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const hint = defaultYes ? "[Y/n]" : "[y/N]";
    rl.question(`${question} ${hint}: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (a === "") resolve(defaultYes);
      else if (a === "y" || a === "yes") resolve(true);
      else resolve(false);
    });
  });
}

export interface AddOptions {
  name?: string | undefined;
  cmd?: string | undefined;
  timeout?: string | undefined;
  nonInteractive?: boolean;
}

export async function run(path?: string, options: AddOptions = {}) {
  if (!path) {
    console.error("Usage: lazydev add <path> [options]");
    console.error("");
    console.error("Options:");
    console.error("  --name <name>      Project name (default: directory name)");
    console.error("  --cmd <command>    Start command (default: auto-detected)");
    console.error("  --timeout <time>   Idle timeout (default: 10m)");
    console.error("  -y, --yes          Skip interactive prompts");
    console.error("");
    console.error("Examples:");
    console.error("  lazydev add ~/projects/myapp");
    console.error("  lazydev add ~/projects/api --name=backend --cmd='npm run dev'");
    console.error("  lazydev add . --timeout=30m -y");
    process.exit(1);
  }
  
  const cwd = expandTilde(path);
  
  if (!existsSync(cwd)) {
    console.error(`Directory not found: ${cwd}`);
    process.exit(1);
  }
  
  // Detect framework and package.json
  const pkgPath = join(cwd, "package.json");
  let pkg: PackageJson | null = null;
  if (existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as PackageJson;
    } catch {}
  }
  
  const framework = detectFramework(pkg);
  
  // Default values
  const derivedName = basename(cwd).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  const defaultName = derivedName || "project";
  const defaultCmd = detectStartCmd(pkg);
  const defaultTimeout = "10m";
  
  let name = options.name ?? defaultName;
  let startCmd = options.cmd ?? defaultCmd;
  let idleTimeout = options.timeout || defaultTimeout;
  
  // Interactive mode
  if (!options.nonInteractive && !options.name && !options.cmd) {
    console.log(`\n  Directory: ${cwd}`);
    if (framework.detected) {
      console.log(`  Framework: ${framework.name}`);
    }
    console.log("");
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    try {
      // Project name
      name = await prompt(rl, `? Project name (${defaultName}): `, defaultName);
      while (validateName(name)) {
        console.log(`  ${validateName(name)}`);
        name = await prompt(rl, `? Project name (${defaultName}): `, defaultName);
      }
      
      // Start command
      startCmd = await prompt(rl, `? Start command (${defaultCmd}): `, defaultCmd);
      
      // Timeout
      idleTimeout = await prompt(rl, `? Idle timeout (${defaultTimeout}): `, defaultTimeout);
      while (!/^\d+(ms|s|m|h)$/.test(idleTimeout)) {
        console.log(`  Invalid format. Use: 10m, 30s, 1h`);
        idleTimeout = await prompt(rl, `? Idle timeout (${defaultTimeout}): `, defaultTimeout);
      }
      
      // Summary
      console.log("\n  ─────────────────────────────────────────");
      console.log(`  Name:      ${name}`);
      console.log(`  Directory: ${cwd}`);
      console.log(`  Command:   ${startCmd}`);
      console.log(`  Timeout:   ${idleTimeout}`);
      console.log(`  URL:       http://${name}.localhost`);
      if (framework.detected) {
        console.log(`  Framework: ${framework.name}`);
        for (const w of framework.warnings) {
          console.log(`    ℹ ${w}`);
        }
      }
      console.log("  ─────────────────────────────────────────\n");
      
      const confirm = await promptYesNo(rl, "? Add this project?", true);
      if (!confirm) {
        console.log("Cancelled.");
        rl.close();
        process.exit(0);
      }
    } finally {
      rl.close();
    }
  }
  
  // Validate
  const validationError = validateName(name);
  if (validationError) {
    console.error(`Invalid name "${name}": ${validationError}`);
    process.exit(1);
  }
  
  if (!/^\d+(ms|s|m|h)$/.test(idleTimeout)) {
    console.error(`Invalid timeout format: "${idleTimeout}". Use format like "10m", "30s", "1h"`);
    process.exit(1);
  }
  
  // Load config
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
    idle_timeout: idleTimeout,
  };
  
  writeFileSync(CONFIG_PATH, stringify(config));
  
  console.log(`\n✓ Added project: ${name}`);
  console.log(`  URL: http://${name}.localhost\n`);
}
