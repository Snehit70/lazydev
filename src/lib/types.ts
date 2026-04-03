export interface RawConfig {
  settings?: Record<string, unknown>;
  projects?: Record<string, unknown>;
  aliases?: Record<string, string>;
}

export interface ProjectConfig {
  name: string;
  port: number;
  disabled?: boolean;
  aliases?: string[];
}

export interface RawProjectConfig {
  name?: string;
  port: number;
  disabled?: boolean;
  aliases?: string[];
}

export interface Settings {
  proxy_port: number;
  projects_dir?: string;
}

export interface Config {
  settings: Settings;
  projects: Record<string, ProjectConfig>;
  aliases?: Record<string, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  proxy_port: 80,
};
