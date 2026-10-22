import { loadConfig, parseAliasTarget, resolveProjectsDirs, updateConfigFile, validateAliasName, validateAliasTarget } from "../lib/config";
import { findProjectDir } from "../lib/routing";

export async function run(alias?: string, target?: string) {
  if (!alias || !target) {
    console.error("Usage: lazydev alias <name> <project-path | port>");
    process.exit(1);
  }

  const aliasName = alias.toLowerCase();
  const aliasError = validateAliasName(aliasName);
  if (aliasError) {
    console.error(`Invalid alias: ${aliasError}`);
    process.exit(1);
  }

  const aliasTarget = parseAliasTarget(target);
  const targetError = validateAliasTarget(aliasTarget);
  if (targetError) {
    console.error(`Invalid target: ${targetError}`);
    process.exit(1);
  }

  const config = loadConfig();
  if (aliasTarget === config.settings.proxy_port) {
    console.error(`Port ${aliasTarget} is LazyDev's own port.`);
    process.exit(1);
  }

  updateConfigFile((doc) => {
    doc.setIn(["aliases", aliasName], aliasTarget);
  });

  const port = config.settings.proxy_port === 80 ? "" : `:${config.settings.proxy_port}`;
  console.log(`✓ Added alias: ${aliasName} → ${typeof aliasTarget === "number" ? `port ${aliasTarget}` : aliasTarget}`);
  console.log(`  URL: http://${aliasName}.localhost${port}`);

  if (typeof aliasTarget === "string") {
    const dirs = resolveProjectsDirs(config);
    if (!findProjectDir(dirs, aliasTarget)) {
      console.log(`  Note: ${aliasTarget} does not exist yet in ${dirs.join(", ")}`);
    }
  }
}
