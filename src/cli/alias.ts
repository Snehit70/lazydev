import { existsSync, readFileSync, writeFileSync } from "fs";
import { stringify, parse } from "yaml";
import { CONFIG_PATH, expandTilde } from "../lib/config";

interface RawConfig {
  settings?: Record<string, unknown>;
  projects?: Record<string, unknown>;
  aliases?: Record<string, string>;
}

function validateName(name: string): string | null {
  if (!/^[a-z][a-z0-9-]*$/i.test(name)) {
    return "Alias must start with a letter and contain only letters, numbers, and hyphens";
  }
  if (name.length > 63) {
    return "Alias must be 63 characters or less";
  }
  return null;
}

export async function run(alias?: string, target?: string) {
  if (!alias || !target) {
    console.error("Usage: lazydev alias <alias> <project>");
    process.exit(1);
  }

  const aliasName = alias.toLowerCase();
  const targetName = target.toLowerCase();
  const aliasError = validateName(aliasName);
  if (aliasError) {
    console.error(`Invalid alias: ${aliasError}`);
    process.exit(1);
  }

  const configPath = expandTilde(CONFIG_PATH);
  if (!existsSync(configPath)) {
    console.error("Config not found. Run 'lazydev init' first.");
    process.exit(1);
  }

  const config = parse(readFileSync(configPath, "utf-8")) as RawConfig | null;
  const nextConfig: RawConfig = config ?? {};
  nextConfig.aliases ??= {};
  nextConfig.aliases[aliasName] = targetName;

  writeFileSync(configPath, stringify(nextConfig));

  console.log(`✓ Added alias: ${aliasName} → ${targetName}`);
  console.log(`  URL: http://${aliasName}.localhost`);
}
