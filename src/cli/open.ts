import { loadConfig, resolveProjectsDirs } from "../lib/config";
import { labelForPath, parseHost } from "../lib/routing";

function resolveLabel(name: string | undefined): string {
  const config = loadConfig();
  if (name) {
    const parsed = parseHost(`${name.toLowerCase()}.localhost`);
    if (parsed.kind !== "project") {
      console.error(`Invalid project name: ${name}`);
      process.exit(1);
    }
    return parsed.name;
  }

  const label = labelForPath(resolveProjectsDirs(config), config.aliases, process.cwd());
  if (!label) {
    console.error("Not inside a project directory. Pass a name: lazydev open <name>");
    process.exit(1);
  }
  return label;
}

export function urlFor(name: string | undefined): string {
  const label = resolveLabel(name);
  const port = loadConfig().settings.proxy_port;
  return `http://${label}.localhost${port === 80 ? "" : `:${port}`}`;
}

/** Print the URL for a project (default: the one containing the current directory). */
export async function printUrl(name?: string) {
  console.log(urlFor(name));
}

/** Open the project's URL in the default browser. */
export async function run(name?: string) {
  const url = urlFor(name);
  console.log(url);
  try {
    const proc = Bun.spawn(["xdg-open", url], { stdout: "ignore", stderr: "ignore" });
    if ((await proc.exited) !== 0) {
      console.error("xdg-open failed; open the URL above manually.");
    }
  } catch {
    console.error("xdg-open is not available; open the URL above manually.");
  }
}
