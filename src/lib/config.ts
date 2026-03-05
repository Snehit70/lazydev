import { parse } from "yaml";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import type { Config, Settings, ProjectConfig } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const CONFIG_PATH = "~/.config/lazydev/config.yaml";

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
  const parsed = parse(raw) as Partial<Config> | null;
  
  if (!parsed) {
    throw new Error(`Invalid config file: ${configPath}`);
  }
  
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...(parsed.settings ?? {}),
  };
  
  const projects: Record<string, ProjectConfig> = {};
  
  for (const [name, project] of Object.entries(parsed.projects ?? {})) {
    if (!project.port) {
      throw new Error(`Project "${name}" missing port field`);
    }
    
    const port = Number(project.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Project "${name}" invalid port: ${project.port}`);
    }
    
    projects[name] = {
      name,
      port,
      ...(project.disabled !== undefined && { disabled: project.disabled }),
      ...(project.aliases !== undefined && { aliases: project.aliases }),
    };
  }
  
  return { settings, projects };
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
