#!/usr/bin/env bun
import { parseArgs } from "util";
import pkg from "../package.json";

function parseCliArgs() {
  try {
    return parseArgs({
      args: Bun.argv.slice(2),
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        follow: { type: "boolean", short: "f" },
        lines: { type: "string", short: "l" },
        shell: { type: "string" },
      },
      allowPositionals: true,
    });
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    console.error("Run 'lazydev --help' for usage.");
    process.exit(1);
  }
}

const args = parseCliArgs();

const [command, ...positionals] = args.positionals;

async function run() {
  if (args.values.version) {
    console.log(`lazydev v${pkg.version}`);
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
    case "remove":
      console.log(`\n⚠️  The '${command}' command has been removed in v0.3.0.\n`);
      console.log("LazyDev now automatically discovers your running dev servers.");
      console.log("Just start your dev server and visit http://<project>.localhost\n");
      console.log("Example:");
      console.log("  cd ~/projects/myapp");
      console.log("  bun dev");
      console.log("  # Visit http://myapp.localhost\n");
      process.exit(0);
      break;
    case "start":
      await import("./cli/start").then((m) => m.run());
      break;
    case "stop":
      await import("./cli/stop").then((m) => m.run());
      break;
    case "restart":
      await import("./cli/restart").then((m) => m.run());
      break;
    case "alias":
      await import("./cli/alias").then((m) => m.run(positionals[0], positionals[1]));
      break;
    case "unalias":
      await import("./cli/unalias").then((m) => m.run(positionals[0]));
      break;
    case "status":
    case "list":
      await import("./cli/status").then((m) => m.run(positionals[0]));
      break;
    case "logs":
      await import("./cli/logs").then((m) => m.run(
        args.values.follow,
        args.values.lines ? Math.max(1, parseInt(args.values.lines, 10) || 100) : 100
      ));
      break;
    case "completions":
      await import("./cli/completions").then((m) => m.run(args.values.shell));
      break;
    case "run":
      await import("./cli/start").then((m) => m.run(true));
      break;
    case "doctor":
      await import("./cli/doctor").then((m) => m.run());
      break;
    case "open":
      await import("./cli/open").then((m) => m.run(positionals[0]));
      break;
    case "url":
      await import("./cli/open").then((m) => m.printUrl(positionals[0]));
      break;
    case "_names":
      // Used by shell completions.
      await import("./cli/completions").then((m) => m.printNames());
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

function showHelp() {
  console.log(`
lazydev - Zero-config dev server proxy

Usage: lazydev <command> [options]

Commands:
  init              Create config and check DNS / port setup
  start             Start the proxy (systemd user service if available)
  stop              Stop the proxy
  restart           Restart the proxy service
  run               Run the proxy in the foreground
  status [name]     Show running dev servers (alias: list)
  open [name]       Open a project in the browser (default: current directory)
  url [name]        Print a project's URL
  alias <a> <t>     Route <a>.localhost to project path or port <t>
  unalias <a>       Remove alias <a>
  logs              Show proxy logs
  doctor            Check the setup and explain why a server isn't found
  completions       Install shell completions (--shell bash|zsh|fish)

Options:
  -h, --help        Show this help
  -v, --version     Show version
  -f, --follow      Follow logs in real-time
  -l, --lines <n>   Number of log lines (default: 100)

How it works:
  1. Start the proxy:  lazydev start
  2. Start your dev server:  cd ~/projects/myapp && bun dev
  3. Visit:  http://myapp.localhost

LazyDev discovers dev servers started inside ~/projects/<name> and
routes <name>.localhost to them. Visit http://localhost for a list.

Aliases:
  lazydev alias mp myproject          mp.localhost → ~/projects/myproject
  lazydev alias web monorepo/apps/web nested paths work
  lazydev alias grafana 3000          any local port, e.g. a Docker container
`);
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
