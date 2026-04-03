import { existsSync, readFileSync, writeFileSync } from "fs";
import { stringify, parse } from "yaml";
import { CONFIG_PATH, expandTilde } from "../lib/config";
import type { RawConfig } from "../lib/types";

export async function run(alias?: string) {
  if (!alias) {
    console.error("Usage: lazydev unalias <alias>");
    process.exit(1);
  }

  const aliasName = alias.toLowerCase();
  const configPath = expandTilde(CONFIG_PATH);
  if (!existsSync(configPath)) {
    console.error("Config not found. Run 'lazydev init' first.");
    process.exit(1);
  }

  const config = parse(readFileSync(configPath, "utf-8")) as RawConfig | null;
  const nextConfig: RawConfig = config ?? {};

  if (!nextConfig.aliases?.[aliasName]) {
    console.error(`Alias "${aliasName}" not found.`);
    process.exit(1);
  }

  delete nextConfig.aliases[aliasName];
  if (Object.keys(nextConfig.aliases).length === 0) {
    delete nextConfig.aliases;
  }

  writeFileSync(configPath, stringify(nextConfig));

  console.log(`✓ Removed alias: ${aliasName}`);
}
