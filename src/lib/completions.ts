import { writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";

function getShell(): string | null {
  const shell = process.env["SHELL"];
  if (shell?.includes("bash")) return "bash";
  if (shell?.includes("zsh")) return "zsh";
  if (shell?.includes("fish")) return "fish";
  return null;
}

function installCompletions(shell: string): { success: boolean; message: string } {
  const HOME = homedir();
  
  if (shell === "bash") {
    const rcPath = `${HOME}/.bashrc`;
    const compLine = `[ -f ~/.lazydev-completions.sh ] && source ~/.lazydev-completions.sh\n`;
    
    const compScript = `#!/bin/bash
_lazydev() {
  local cur prev
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  
  case "\$prev" in
    lazydev)
      COMPREPLY=($(compgen -W "init add remove list start stop restart status logs completions" -- "\$cur"))
      ;;
    lazydev add)
      COMPREPLY=($(compgen -W "--port --name --yes -p -n -y" -- "\$cur"))
      ;;
    lazydev remove|status|logs)
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
      writeFileSync(`${HOME}/.lazydev-completions.sh`, compScript);
      const rcContent = existsSync(rcPath) ? require("fs").readFileSync(rcPath, "utf-8") : "";
      if (!rcContent.includes("lazydev-completions")) {
        require("fs").appendFileSync(rcPath, `\n${compLine}`);
      }
      return { success: true, message: "Bash completions installed. Restart shell or source ~/.bashrc" };
    } catch (err) {
      return { success: false, message: `Failed: ${err}` };
    }
  }
  
  if (shell === "zsh") {
    const compDir = `${HOME}/.zsh/completions`;
    const compScript = `# LazyDev zsh completions
local -a _lazydev_commands
_lazydev_commands=(
  'init:Initialize lazydev'
  'add:Add a project'
  'remove:Remove a project'
  'list:List projects'
  'start:Start proxy'
  'stop:Stop proxy'
  'restart:Restart proxy'
  'status:Show status'
  'logs:Show logs'
  'completions:Install completions'
)

_lazydev() {
  local -a options
  options=(
    '(-h --help)'{-h,help}'[Show help]'
    '(-v --version)'{-v,version}'[Show version]'
    '(-p --port)'{-p,port}'[Port number]'
    '(-n --name)'{-n,name}'[Project name]'
    '(-y --yes)'{-y,yes}'[Skip prompts]'
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
  
  return { success: false, message: `Shell '${shell}' not supported. Use bash or zsh.` };
}

export { getShell, installCompletions };
