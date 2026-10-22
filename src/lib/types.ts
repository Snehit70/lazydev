export interface Settings {
  proxy_port: number;
  /** One directory or a list; on a name clash the earlier directory wins. */
  projects_dir?: string | string[];
}

/** A project path relative to a projects directory, or a fixed local port. */
export type AliasTarget = string | number;

export interface Config {
  settings: Settings;
  aliases: Record<string, AliasTarget>;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  proxy_port: 80,
};

export const DEFAULT_PROJECTS_DIR = "~/projects";
