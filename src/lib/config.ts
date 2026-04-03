import { parse } from "yaml";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import type { Config, Settings, ProjectConfig } from "./types";
import { DEFAULT_SETTINGS } from "./types";

export const CONFIG_PATH = "~/.config/lazydev/config.yaml";

export function expandTilde(path: string): string {
  if (path.startsWith("~")) {
    const home = homedir();
    if (!home) throw new Error("Cannot determine home directory");
    return path.replace("~", home);
  }
  return path;
}

export function loadConfig(path: string = CONFIG_PATH): Config {
  const configPath = expandTilde(path);
  
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}. Run 'lazydev init' first.`);
  }
  
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parse(raw) as Record<string, unknown> | null;
  
  if (!parsed) {
    throw new Error(`Invalid config file: ${configPath}`);
  }
  
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...((parsed["settings"] as Record<string, unknown>) ?? {}),
  };
  
  // Handle legacy projects (optional for backward compat)
  const projects: Record<string, ProjectConfig> = {};
  const rawProjects = parsed["projects"] as Record<string, unknown> | undefined;
  
  if (rawProjects) {
    for (const [name, project] of Object.entries(rawProjects)) {
      const p = project as Record<string, unknown>;
      if (!p["port"]) {
        throw new Error(`Project "${name}" missing port field`);
      }
      
      const port = Number(p["port"]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Project "${name}" invalid port: ${p["port"]}`);
      }
      
      projects[name] = {
        name,
        port,
        ...(p["disabled"] !== undefined && { disabled: Boolean(p["disabled"]) }),
        ...(p["aliases"] !== undefined && {
        aliases: Array.isArray(p["aliases"])
          ? (p["aliases"] as unknown[]).filter((a): a is string => typeof a === "string")
          : [],
      }),
      };
    }
  }
  
  // Handle aliases (new format)
  const rawAliases = parsed["aliases"];
  const aliases: Record<string, string> = {};
  if (rawAliases && typeof rawAliases === "object" && !Array.isArray(rawAliases)) {
    for (const [key, value] of Object.entries(rawAliases)) {
      if (typeof value === "string") {
        aliases[key] = value;
      }
    }
  }
  
  return { settings, projects, aliases };
}

export function validateConfig(config: Config): string[] {
  const errors: string[] = [];
  
  for (const [name, project] of Object.entries(config.projects)) {
    if (!/^[a-z][a-z0-9-]*$/i.test(name)) {
      errors.push(`Project name "${name}" must be alphanumeric with hyphens, start with letter`);
    }
    
    if (!project.port || project.port < 1 || project.port > 65535) {
      errors.push(`Project "${name}" invalid port: ${project.port}`);
    }
  }
  
  return errors;
}
