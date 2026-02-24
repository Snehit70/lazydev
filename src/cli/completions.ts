import { installCompletions, getShell } from "../lib/completions";

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
