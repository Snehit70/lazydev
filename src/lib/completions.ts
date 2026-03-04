function getShell(): string | null {
  const shell = process.env["SHELL"];
  if (shell?.includes("bash")) return "bash";
  if (shell?.includes("zsh")) return "zsh";
  if (shell?.includes("fish")) return "fish";
  return null;
}

function installCompletions(_shell: string): { success: boolean; message: string } {
  return { success: false, message: "Completions not implemented yet" };
}

export { getShell, installCompletions };
