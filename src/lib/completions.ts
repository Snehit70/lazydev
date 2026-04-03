import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";

function getShell(): string | null {
  const shell = process.env["SHELL"];
  if (shell?.includes("bash")) return "bash";
  if (shell?.includes("zsh")) return "zsh";
  if (shell?.includes("fish")) return "fish";
  return null;
}

function installCompletions(shell: string): { success: boolean; message: string } {
  const home = homedir();

  if (shell === "bash") {
    const rcPath = `${home}/.bashrc`;
    const compLine = `[ -f ~/.lazydev-completions.sh ] && source ~/.lazydev-completions.sh\n`;
    const compScript = `#!/bin/bash
_lazydev() {
  local cur prev
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  case "\$prev" in
    lazydev)
      COMPREPLY=($(compgen -W "init start stop restart alias unalias status logs completions run" -- "\$cur"))
      ;;
    alias|unalias|status|logs)
      COMPREPLY=()
      ;;
    *)
      ;;
  esac
  return 0
}
complete -F _lazydev lazydev
`;

    try {
      writeFileSync(`${home}/.lazydev-completions.sh`, compScript);
      const rcContent = existsSync(rcPath) ? readFileSync(rcPath, "utf-8") : "";
      if (!rcContent.includes("lazydev-completions")) {
        appendFileSync(rcPath, `\n${compLine}`);
      }
      return { success: true, message: "Bash completions installed. Restart shell or source ~/.bashrc" };
    } catch (err) {
      return { success: false, message: `Failed: ${err}` };
    }
  }

  if (shell === "zsh") {
    const compDir = `${home}/.zsh/completions`;
    const compScript = `# LazyDev zsh completions
local -a _lazydev_commands
_lazydev_commands=(
  'init:Initialize lazydev'
  'start:Start proxy'
  'stop:Stop proxy'
  'restart:Restart proxy'
  'alias:Add alias'
  'unalias:Remove alias'
  'status:Show status'
  'logs:Show logs'
  'completions:Install completions'
)

_lazydev() {
  local -a options
  options=(
    '(-h --help)'{-h,help}'[Show help]'
    '(-v --version)'{-v,version}'[Show version]'
    '(-f --follow)'{-f,follow}'[Follow logs]'
    '(-l --lines)'{-l,lines}'[Number of log lines]'
  )

  _describe 'command' _lazydev_commands || return 0
  _describe 'option' options || return 0
}

compdef _lazydev lazydev
`;

    try {
      if (!existsSync(compDir)) {
        mkdirSync(compDir, { recursive: true });
      }
      writeFileSync(`${compDir}/_lazydev`, compScript);
      return { success: true, message: "Zsh completions installed to ~/.zsh/completions/" };
    } catch (err) {
      return { success: false, message: `Failed: ${err}` };
    }
  }

  if (shell === "fish") {
    const compDir = `${home}/.config/fish/completions`;
    const compScript = `# LazyDev fish completions
complete -c lazydev -f -a 'init start stop restart alias unalias status logs completions run'
complete -c lazydev -f -l 'help' -d 'Show help'
complete -c lazydev -f -l 'version' -d 'Show version'
complete -c lazydev -f -l 'follow' -d 'Follow logs in real time'
complete -c lazydev -f -l 'lines' -d 'Number of log lines'
`;

    try {
      if (!existsSync(compDir)) {
        mkdirSync(compDir, { recursive: true });
      }
      writeFileSync(`${compDir}/lazydev.fish`, compScript);
      return { success: true, message: "Fish completions installed to ~/.config/fish/completions/" };
    } catch (err) {
      return { success: false, message: `Failed: ${err}` };
    }
  }

  return { success: false, message: `Shell '${shell}' not supported. Use bash, zsh, or fish.` };
}

export { getShell, installCompletions };
