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
}

export interface Config {
  settings: Settings;
  projects: Record<string, ProjectConfig>;
}

export const DEFAULT_SETTINGS: Settings = {
  proxy_port: 80,
};
