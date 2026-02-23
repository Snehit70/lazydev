export interface ProjectConfig {
  name: string;
  cwd: string;
  start_cmd: string;
  idle_timeout?: number;
  disabled?: boolean;
  aliases?: string[];
}

/**
 * Raw project config as parsed from YAML (before duration conversion).
 * idle_timeout can be a string like "10m" or a number in milliseconds.
 */
export interface RawProjectConfig {
  name?: string;
  cwd: string;
  start_cmd: string;
  idle_timeout?: number | string;
  disabled?: boolean;
  aliases?: string[];
}

export interface Settings {
  proxy_port: number;
  idle_timeout: number;
  startup_timeout: number;
  port_range: [number, number];
  scan_interval: number;
  dynamic_timeout: boolean;
  min_timeout: number;
  max_timeout: number;
}

export interface Config {
  settings: Settings;
  projects: Record<string, ProjectConfig>;
}

export interface ProjectState {
  name: string;
  port: number | null;
  pid: number | null;
  status: "stopped" | "starting" | "running";
  last_activity: number | null;
  started_at: number | null;
  websocket_connections: number;
}

export interface ProjectMetrics {
  name: string;
  cold_start_time: number | null;
  request_history: number[];
}

export interface DaemonState {
  started_at: number;
  projects: Record<string, ProjectState>;
}

export const DEFAULT_SETTINGS: Settings = {
  proxy_port: 80,
  idle_timeout: 600000,
  startup_timeout: 30000,
  port_range: [4000, 4999],
  scan_interval: 30000,
  dynamic_timeout: true,
  min_timeout: 120000,
  max_timeout: 1800000,
};
