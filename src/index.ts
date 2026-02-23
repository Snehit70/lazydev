#!/usr/bin/env bun
import { parseArgs } from "util";

const args = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
    port: { type: "string", short: "p" },
    all: { type: "boolean", short: "a" },
    json: { type: "boolean", short: "j" },
    follow: { type: "boolean", short: "f" },
    lines: { type: "string", short: "n" },
    // Add command options
    name: { type: "string" },
    cmd: { type: "string", short: "c" },
    timeout: { type: "string", short: "t" },
    // Start options
    foreground: { type: "boolean", short: "F" },
  },
  allowPositionals: true,
});

const [command, ...positionals] = args.positionals;

async function run() {
  if (args.values.version) {
    console.log("lazydev v0.1.0");
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
      await import("./cli/add").then((m) => m.run(positionals[0], {
        name: args.values.name,
        cmd: args.values.cmd,
        timeout: args.values.timeout,
      }));
      break;
    case "remove":
      await import("./cli/remove").then((m) => m.run(positionals[0]));
      break;
    case "list":
      await import("./cli/list").then((m) => m.run(args.values.json));
      break;
    case "start":
      await import("./cli/start").then((m) => m.run(
        args.values.port ? parseInt(args.values.port) : undefined,
        args.values.foreground
      ));
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
    case "up":
      await import("./cli/up").then((m) => m.run(positionals[0]));
      break;
    case "down":
      await import("./cli/down").then((m) => m.run(positionals[0], args.values.all));
      break;
    case "logs":
      await import("./cli/logs").then((m) => m.run(
        positionals[0],
        args.values.follow,
        args.values.lines ? parseInt(args.values.lines) : 100
      ));
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

function showHelp() {
  console.log(`
lazydev - Scale-to-zero dev server manager

Usage: lazydev <command> [options]

Commands:
  init              Initialize lazydev (create config, setup dnsmasq)
  add <path>        Add a project
  remove <name>     Remove a project
  list              List all configured projects
  start             Start the proxy daemon (via systemd)
  stop              Stop the proxy daemon
  restart           Restart the proxy daemon
  status [name]     Show status of all projects or specific one
  up <name>         Force start a project
  down <name>       Force stop a project
  down --all        Stop all projects
  logs              Show daemon logs
  logs <name>       Show project logs
  logs -f           Follow logs in real-time

Options:
  -h, --help        Show this help
  -v, --version     Show version
  -p, --port <n>    Override proxy port
  -a, --all         Apply to all projects
  -j, --json        Output as JSON
  -f, --follow      Follow logs in real-time
  -n, --lines <n>   Number of log lines (default: 100)
  -F, --foreground  Run in foreground (for systemd)

Add Options:
  --name <name>     Project name (default: directory name)
  -c, --cmd <cmd>   Start command (default: auto-detected)
  -t, --timeout <t> Idle timeout (default: 10m)
`);
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});