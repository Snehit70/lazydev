import { parse } from "yaml";
import { readFileSync, existsSync } from "fs";
import type { Config, Settings, ProjectConfig } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const CONFIG_PATH = "~/.config/lazydev/config.yaml";

export function expandTilde(path: string): string {
  if (path.startsWith("~")) {
    return path.replace("~", process.env["HOME"] ?? "/home");
  }
  return path;
}

export function parseDuration(duration: string | number): number {
  if (typeof duration === "number") return duration;
  
  const match = duration.match(/^(\d+)(ms|s|m|h)?$/);
  if (!match) throw new Error(`Invalid duration: ${duration}`);
  
  const value = parseInt(match[1]!);
  const unit = match[2] || "ms";
  
  switch (unit) {
    case "ms": return value;
    case "s": return value * 1000;
    case "m": return value * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    default: return value;
  }
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
  
  if (parsed.settings?.idle_timeout !== undefined) {
    settings.idle_timeout = parseDuration(parsed.settings.idle_timeout);
  }
  if (parsed.settings?.startup_timeout !== undefined) {
    settings.startup_timeout = parseDuration(parsed.settings.startup_timeout);
  }
  if (parsed.settings?.scan_interval !== undefined) {
    settings.scan_interval = parseDuration(parsed.settings.scan_interval);
  }
  if (parsed.settings?.min_timeout !== undefined) {
    settings.min_timeout = parseDuration(parsed.settings.min_timeout);
  }
  if (parsed.settings?.max_timeout !== undefined) {
    settings.max_timeout = parseDuration(parsed.settings.max_timeout);
  }
  
  const projects: Record<string, ProjectConfig> = {};
  
  for (const [name, project] of Object.entries(parsed.projects ?? {})) {
    projects[name] = {
      name,
      cwd: expandTilde(project.cwd ?? ""),
      start_cmd: project.start_cmd ?? "",
      idle_timeout: project.idle_timeout ? parseDuration(project.idle_timeout) : settings.idle_timeout,
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
    
    if (!project.cwd) {
      errors.push(`Project "${name}" missing cwd`);
    }
    
    if (!project.start_cmd) {
      errors.push(`Project "${name}" missing start_cmd`);
    }
  }
  
  return errors;
}
