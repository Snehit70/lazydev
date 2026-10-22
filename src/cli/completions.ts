import { loadConfig, resolveProjectsDirs } from "../lib/config";
import { installCompletions, getShell } from "../lib/completions";
import { parseHost } from "../lib/routing";
import { listProjects } from "./status";

/** Project and alias names, one per line, for shell completion. Silent on errors. */
export async function printNames() {
  try {
    const config = loadConfig();
    const names = new Set(Object.keys(config.aliases));
    for (const { name } of listProjects(resolveProjectsDirs(config))) {
      const parsed = parseHost(`${name.toLowerCase()}.localhost`);
      if (parsed.kind === "project") names.add(parsed.name);
    }
    console.log([...names].sort().join("\n"));
  } catch {
    // No config yet: nothing to complete.
  }
}

export async function run(shell?: string) {
  if (shell) {
    if (shell !== "bash" && shell !== "zsh" && shell !== "fish") {
      console.error(`Invalid shell: ${shell}. Must be bash, zsh, or fish.`);
      process.exit(1);
    }
    const result = installCompletions(shell);
    console.log(result.message);
    if (!result.success) {
      process.exit(1);
    }
    return;
  }
  
  const detectedShell = getShell();
  if (detectedShell) {
    console.log(`Detected shell: ${detectedShell}`);
    const result = installCompletions(detectedShell);
    console.log(result.message);
    if (!result.success) {
      process.exit(1);
    }
  } else {
    console.log("Could not detect shell. Specify with --shell:");
    console.log("  lazydev completions --shell bash");
    console.log("  lazydev completions --shell zsh");
    console.log("  lazydev completions --shell fish");
    process.exit(1);
  }
}
