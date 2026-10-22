import { getConfigPath, loadConfig } from "../lib/config";
import { capableBunBinaries, findHiddenServers } from "../lib/caps";
import { getForegroundPid } from "../lib/pidfile";
import { getServiceStatus, isSystemdAvailable } from "../lib/systemd";
import type { Config } from "../lib/types";
import { checkSetup } from "./init";

/** Check the setup and explain anything that stops discovery or routing. */
export async function run() {
  let config: Config;
  try {
    config = loadConfig();
    console.log(`✓ Config: ${getConfigPath()}`);
  } catch (err) {
    console.log(`✗ Config: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  let problems = checkSetup(config);

  if (isSystemdAvailable() && getServiceStatus().active) {
    console.log("✓ Proxy running (systemd)");
  } else if (getForegroundPid()) {
    console.log(`✓ Proxy running (foreground, PID ${getForegroundPid()})`);
  } else {
    console.log("⚠ Proxy not running. Start it with: lazydev start");
    problems = true;
  }

  const hidden = await findHiddenServers();
  if (hidden.ports.length > 0) {
    console.log(`⚠ Your processes listen on ${hidden.ports.join(", ")}, but LazyDev can't tell which ones`);
    console.log("  These processes hide their cwd and sockets:");
    for (const p of hidden.processes.slice(0, 8)) {
      console.log(`    ${String(p.pid).padStart(7)}  ${p.command.slice(0, 100)}`);
    }
    if (hidden.processes.length > 8) console.log(`    ... and ${hidden.processes.length - 8} more`);
    if (capableBunBinaries().length === 0) {
      console.log("  A binary with file capabilities (setcap) or a setuid wrapper is the usual cause.");
    }
    problems = true;
  }

  console.log(problems ? "\nSome checks need attention." : "\nAll good.");
  if (problems) process.exitCode = 1;
}
