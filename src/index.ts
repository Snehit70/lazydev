#!/usr/bin/env bun
import { parseArgs } from "util";

const args = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
    json: { type: "boolean", short: "j" },
    follow: { type: "boolean", short: "f" },
    lines: { type: "string", short: "l" },
    shell: { type: "string" },
  },
  allowPositionals: true,
});

const [command, ...positionals] = args.positionals;

async function run() {
  if (args.values.version) {
    console.log("lazydev v0.4.0");
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
      console.log(`\n⚠️  The '${command}' command has been removed in v2.\n`);
      console.log("LazyDev now automatically discovers your running dev servers.");
      console.log("Just start your dev server and visit http://<project>.localhost\n");
      console.log("Example:");
      console.log("  cd ~/projects/myapp");
      console.log("  bun dev");
      console.log("  # Visit http://myapp.localhost\n");
      process.exit(0);
      break;
    case "list":
      await import("./cli/list").then((m) => m.run(args.values.json));
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
    case "run":
      await import("./cli/start").then((m) => m.run(true));
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
  init              Initialize lazydev (setup dnsmasq, port 80)
  start             Start the proxy daemon
  stop              Stop the proxy daemon
  restart           Restart the proxy daemon
  alias <a> <p>     Add alias <a> for project <p>
  unalias <a>       Remove alias <a>
  status [name]     Show running dev servers
  logs              Show daemon logs
  completions       Install shell completions

Options:
  -h, --help        Show this help
  -v, --version     Show version
  -f, --follow      Follow logs in real-time
  -l, --lines <n>   Number of log lines (default: 100)

How it works:
  1. Start the proxy:  lazydev start
  2. Start your dev server:  cd ~/projects/myapp && bun dev
  3. Visit:  http://myapp.localhost

LazyDev automatically discovers running dev servers in ~/projects/
and routes <name>.localhost to the correct port. No config needed!
`);
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
