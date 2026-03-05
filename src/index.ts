#!/usr/bin/env bun
import { parseArgs } from "util";

const args = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
    port: { type: "string", short: "p" },
    json: { type: "boolean", short: "j" },
    follow: { type: "boolean", short: "f" },
    lines: { type: "string", short: "l" },
    name: { type: "string", short: "n" },
    yes: { type: "boolean", short: "y" },
    shell: { type: "string" },
  },
  allowPositionals: true,
});

const [command, ...positionals] = args.positionals;

async function run() {
  if (args.values.version) {
    console.log("lazydev v0.2.0");
    return;
  }
  
  if (args.values.help || !command) {
    showHelp();
    return;
  }
  
  switch (command) {
    case "init":
      await import("./cli/init").then((m) => m.run());
      break;
    case "add":
      if (!args.values.port) {
        console.error("Error: --port is required");
        console.error("Usage: lazydev add --port <port> [--name <name>]");
        process.exit(1);
      }
      const portStr = args.values.port!;
      const port = parseInt(portStr);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        console.error(`Invalid port: ${portStr}. Must be 1-65535.`);
        process.exit(1);
      }
      await import("./cli/add").then((m) => m.run({
        name: args.values.name ?? undefined,
        port,
        nonInteractive: args.values.yes ?? false,
      }));
      break;
    case "remove":
      await import("./cli/remove").then((m) => m.run(positionals[0]));
      break;
    case "list":
      await import("./cli/list").then((m) => m.run(args.values.json));
      break;
    case "start":
      await import("./cli/start").then((m) => m.run(true));
      break;
    case "stop":
      await import("./cli/stop").then((m) => m.run());
      break;
    case "restart":
      await import("./cli/restart").then((m) => m.run());
      break;
    case "status":
      await import("./cli/status").then((m) => m.run(positionals[0]));
      break;
    case "logs":
      await import("./cli/logs").then((m) => m.run(
        positionals[0],
        args.values.follow,
        args.values.lines ? Math.max(1, parseInt(args.values.lines) || 100) : 100
      ));
      break;
    case "completions":
      await import("./cli/completions").then((m) => m.run(args.values.shell));
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

function showHelp() {
  console.log(`
lazydev - Proxy-only dev server manager

Usage: lazydev <command> [options]

Commands:
  init              Initialize lazydev (create config, setup dnsmasq)
  add --port <n>    Add a project (must start your dev server manually)
  remove <name>     Remove a project
  list              List all configured projects
  start             Start the proxy daemon
  stop              Stop the proxy daemon
  restart           Restart the proxy daemon
  status [name]     Show status of all projects or specific one
  logs              Show daemon logs
  completions       Install shell completions

Options:
  -h, --help        Show this help
  -v, --version     Show version
  -j, --json        Output as JSON
  -f, --follow      Follow logs in real-time
  -l, --lines <n>   Number of log lines (default: 100)

Add Options:
  -n, --name <name>     Project name (default: project<port>)
  -p, --port <port>     Port your dev server runs on (required)
  -y, --yes             Skip interactive prompts

Note:
  LazyDev now works in proxy-only mode. You start your own dev servers
  (e.g., bun dev, npm run dev), and LazyDev routes *.localhost to them.
`);
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
