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
      COMPREPLY=($(compgen -W "init start stop restart run status list open url logs doctor alias unalias completions" -- "\$cur"))
      ;;
    status|list|open|url|unalias)
      COMPREPLY=($(compgen -W "\$(lazydev _names 2>/dev/null)" -- "\$cur"))
      ;;
    logs)
      COMPREPLY=($(compgen -W "--follow -f --lines -l" -- "\$cur"))
      ;;
    completions)
      COMPREPLY=($(compgen -W "--shell" -- "\$cur"))
      ;;
    --shell)
      COMPREPLY=($(compgen -W "bash zsh fish" -- "\$cur"))
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
    const compScript = `#compdef lazydev

_lazydev() {
  local -a commands
  commands=(
    'init:Create config and check the system'
    'start:Start the proxy'
    'stop:Stop the proxy'
    'restart:Restart the proxy'
    'run:Run the proxy in the foreground'
    'status:Show proxy and project status'
    'list:Alias for status'
    'open:Open a project in the browser'
    'url:Print a project URL'
    'logs:Show proxy logs'
    'doctor:Check the setup'
    'alias:Add an alias'
    'unalias:Remove an alias'
    'completions:Install shell completions'
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    _arguments '(-h --help)'{-h,--help}'[Show help]' '(-v --version)'{-v,--version}'[Show version]'
    return
  fi

  case \$words[2] in
    status|list|open|url|unalias)
      local -a names
      names=(\${(f)"\$(lazydev _names 2>/dev/null)"})
      _describe 'project' names
      ;;
    logs)
      _arguments '(-f --follow)'{-f,--follow}'[Follow logs]' '(-l --lines)'{-l,--lines}'[Number of lines]:lines:'
      ;;
    completions)
      _arguments '--shell[Shell]:shell:(bash zsh fish)'
      ;;
  esac
}

_lazydev "\$@"
`;

    try {
      if (!existsSync(compDir)) {
        mkdirSync(compDir, { recursive: true });
      }
      writeFileSync(`${compDir}/_lazydev`, compScript);
      return {
        success: true,
        message:
          "Zsh completions installed to ~/.zsh/completions/_lazydev\n" +
          "If that directory is not in your fpath, add this to ~/.zshrc before compinit:\n" +
          "  fpath=(~/.zsh/completions $fpath)",
      };
    } catch (err) {
      return { success: false, message: `Failed: ${err}` };
    }
  }

  if (shell === "fish") {
    const compDir = `${home}/.config/fish/completions`;
    const compScript = `# LazyDev fish completions
complete -c lazydev -f -n '__fish_use_subcommand' -a 'init start stop restart run status list open url logs doctor alias unalias completions'
complete -c lazydev -f -n '__fish_seen_subcommand_from status list open url unalias' -a '(lazydev _names 2>/dev/null)'
complete -c lazydev -f -n '__fish_seen_subcommand_from completions' -l 'shell' -a 'bash zsh fish' -d 'Shell'
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
