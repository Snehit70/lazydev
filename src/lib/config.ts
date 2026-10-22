import { parse, parseDocument, type Document } from "yaml";
import { readFileSync, existsSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import { isAbsolute, normalize } from "path";
import type { AliasTarget, Config, Settings } from "./types";
import { DEFAULT_PROJECTS_DIR, DEFAULT_SETTINGS } from "./types";

const DEFAULT_CONFIG_PATH = "~/.config/lazydev/config.yaml";

/** Config location; LAZYDEV_CONFIG overrides the default. */
export function getConfigPath(): string {
  return expandTilde(process.env["LAZYDEV_CONFIG"] || DEFAULT_CONFIG_PATH);
}

export function expandTilde(path: string): string {
  if (path === "~" || path.startsWith("~/")) {
    const home = homedir();
    if (!home) throw new Error("Cannot determine home directory");
    return home + path.slice(1);
  }
  return path;
}

/** Absolute projects directories in priority order, without duplicates. */
export function resolveProjectsDirs(config: Config): string[] {
  const raw = config.settings.projects_dir ?? DEFAULT_PROJECTS_DIR;
  const dirs = (Array.isArray(raw) ? raw : [raw]).map((dir) => normalize(expandTilde(dir)).replace(/(.)\/+$/, "$1"));
  return [...new Set(dirs)];
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** Validate a hostname label used as an alias. Returns an error message or null. */
export function validateAliasName(name: string): string | null {
  if (!NAME_PATTERN.test(name)) {
    return "must be 1-63 characters of lowercase letters, numbers, hyphens or underscores, starting with a letter or number";
  }
  return null;
}

/** Interpret a CLI argument as an alias target: digits mean a port. */
export function parseAliasTarget(value: string): AliasTarget {
  return /^\d+$/.test(value) ? Number(value) : value.replace(/\/+$/, "");
}

/**
 * Validate an alias target: a port, a directory name, or a relative path
 * inside a projects directory (e.g. "monorepo/apps/web"). Returns an error
 * message or null.
 */
export function validateAliasTarget(target: AliasTarget): string | null {
  if (typeof target === "number") {
    return Number.isInteger(target) && target >= 1 && target <= 65535 ? null : "port must be between 1 and 65535";
  }
  if (!target || isAbsolute(target)) {
    return "must be a project directory name or a path relative to the projects directory";
  }
  if (target.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return "must not contain empty, '.' or '..' path segments";
  }
  return null;
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseConfig(raw: string, source = "config"): Config {
  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (err) {
    throw new Error(`Invalid YAML in ${source}: ${err instanceof Error ? err.message : err}`);
  }

  // An empty file is a valid config with all defaults.
  if (parsed === null || parsed === undefined) {
    return { settings: { ...DEFAULT_SETTINGS }, aliases: {} };
  }
  if (!isMapping(parsed)) {
    throw new Error(`Invalid ${source}: expected a mapping at the top level, got ${typeName(parsed)}`);
  }

  const settings: Settings = { ...DEFAULT_SETTINGS };
  const rawSettings = parsed["settings"];
  if (rawSettings !== undefined && rawSettings !== null) {
    if (!isMapping(rawSettings)) {
      throw new Error(`Invalid ${source}: "settings" must be a mapping, got ${typeName(rawSettings)}`);
    }

    const port = rawSettings["proxy_port"];
    if (port !== undefined) {
      if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid ${source}: settings.proxy_port must be an integer between 1 and 65535, got ${JSON.stringify(port)}`);
      }
      settings.proxy_port = port;
    }

    const projectsDir = rawSettings["projects_dir"];
    if (projectsDir !== undefined && projectsDir !== null) {
      const isPath = (value: unknown) => typeof value === "string" && value.trim() !== "";
      const valid = Array.isArray(projectsDir)
        ? projectsDir.length > 0 && projectsDir.every(isPath)
        : isPath(projectsDir);
      if (!valid) {
        throw new Error(`Invalid ${source}: settings.projects_dir must be a path or a non-empty list of paths`);
      }
      settings.projects_dir = projectsDir as string | string[];
    }
  }

  const aliases: Record<string, AliasTarget> = {};
  const rawAliases = parsed["aliases"];
  if (rawAliases !== undefined && rawAliases !== null) {
    if (!isMapping(rawAliases)) {
      throw new Error(`Invalid ${source}: "aliases" must be a mapping, got ${typeName(rawAliases)}`);
    }
    for (const [key, value] of Object.entries(rawAliases)) {
      const alias = key.toLowerCase();
      const aliasError = validateAliasName(alias);
      if (aliasError) {
        throw new Error(`Invalid ${source}: alias "${key}" ${aliasError}`);
      }
      if (typeof value !== "string" && typeof value !== "number") {
        throw new Error(`Invalid ${source}: alias "${key}" must map to a project path or a port, got ${typeName(value)}`);
      }
      const targetError = validateAliasTarget(value);
      if (targetError) {
        throw new Error(`Invalid ${source}: alias "${key}" target "${value}" ${targetError}`);
      }
      aliases[alias] = value;
    }
  }

  // The legacy v1 "projects" section is ignored; ports are discovered now.
  return { settings, aliases };
}

export function loadConfig(path: string = getConfigPath()): Config {
  const configPath = expandTilde(path);

  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}. Run 'lazydev init' first.`);
  }

  return parseConfig(readFileSync(configPath, "utf-8"), configPath);
}

/**
 * Edit the config file in place, preserving comments and formatting.
 * The write is atomic so a running proxy never reads a half-written file.
 */
export function updateConfigFile(edit: (doc: Document) => void, path: string = getConfigPath()): void {
  const configPath = expandTilde(path);
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}. Run 'lazydev init' first.`);
  }

  const doc = parseDocument(readFileSync(configPath, "utf-8"));
  if (doc.errors.length > 0) {
    throw new Error(`Invalid YAML in ${configPath}: ${doc.errors[0]?.message}`);
  }
  edit(doc);

  const output = doc.toString();
  // Refuse to write something the proxy would reject on reload.
  parseConfig(output, configPath);

  const tmpPath = `${configPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, output);
  renameSync(tmpPath, configPath);
}
