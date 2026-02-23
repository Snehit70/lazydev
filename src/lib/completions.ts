import { writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const HOME = homedir();

const BASH_COMPLETION = `# lazydev bash completion
_lazydev_completion() {
    local cur prev words cword
    _init_completion || return

    local commands="init add remove list start stop restart status up down logs"
    local options="-h --help -v --version -p --port -a --all -j --json -f --follow -l --lines -F --foreground -n --name -c --cmd -t --timeout -y --yes"

    if [[ \${cword} -eq 1 ]]; then
        COMPREPLY=($(compgen -W "\${commands} \${options}" -- "\${cur}"))
        return
    fi

    case "\${words[1]}" in
        add)
            if [[ "\${cur}" == -* ]]; then
                COMPREPLY=($(compgen -W "-n --name -c --cmd -t --timeout -y --yes" -- "\${cur}"))
            else
                _filedir -d
            fi
            ;;
        remove|status|up|down|logs)
            # Project name completion would require reading config
            # For now, just show options
            if [[ "\${cur}" == -* ]]; then
                case "\${words[1]}" in
                    down) COMPREPLY=($(compgen -W "-a --all" -- "\${cur}")) ;;
                    logs) COMPREPLY=($(compgen -W "-f --follow -l --lines" -- "\${cur}")) ;;
                esac
            fi
            ;;
        start)
            COMPREPLY=($(compgen -W "-p --port -F --foreground" -- "\${cur}"))
            ;;
    esac
}

complete -F _lazydev_completion lazydev
`;

const ZSH_COMPLETION = `#compdef lazydev

_lazydev() {
    local -a commands
    commands=(
        'init:Initialize lazydev (create config, setup dnsmasq)'
        'add:Add a project'
        'remove:Remove a project'
        'list:List all configured projects'
        'start:Start the proxy daemon'
        'stop:Stop the proxy daemon'
        'restart:Restart the proxy daemon'
        'status:Show project status'
        'up:Force start a project'
        'down:Force stop a project'
        'logs:Show logs'
    )

    local -a options
    options=(
        '-h[Show help]'
        '--help[Show help]'
        '-v[Show version]'
        '--version[Show version]'
    )

    _arguments -C \\
        '*:: :->args'

    case $state in
        args)
            case $words[1] in
                add)
                    _arguments \\
                        '-n[Project name]:name' \\
                        '--name[Project name]:name' \\
                        '-c[Start command]:command' \\
                        '--cmd[Start command]:command' \\
                        '-t[Idle timeout]:timeout' \\
                        '--timeout[Idle timeout]:timeout' \\
                        '-y[Skip interactive prompts]' \\
                        '--yes[Skip interactive prompts]' \\
                        '1::directory:_directories'
                    ;;
                remove|status|up|down|logs)
                    _arguments \\
                        '1::project name'
                    ;;
                start)
                    _arguments \\
                        '-p[Override proxy port]:port' \\
                        '--port[Override proxy port]:port' \\
                        '-F[Run in foreground]' \\
                        '--foreground[Run in foreground]'
                    ;;
                logs)
                    _arguments \\
                        '-f[Follow logs]' \\
                        '--follow[Follow logs]' \\
                        '-l[Number of log lines]:lines' \\
                        '--lines[Number of log lines]:lines'
                    ;;
                down)
                    _arguments \\
                        '-a[Stop all projects]' \\
                        '--all[Stop all projects]'
                    ;;
                init|list|stop|restart)
                    ;;
                *)
                    _describe 'command' commands
                    ;;
            esac
            ;;
    esac
}

_lazydev
`;

const FISH_COMPLETION = `# lazydev fish completion

complete -c lazydev -f

# Commands
complete -c lazydev -n '__fish_use_subcommand' -a init -d 'Initialize lazydev'
complete -c lazydev -n '__fish_use_subcommand' -a add -d 'Add a project'
complete -c lazydev -n '__fish_use_subcommand' -a remove -d 'Remove a project'
complete -c lazydev -n '__fish_use_subcommand' -a list -d 'List all projects'
complete -c lazydev -n '__fish_use_subcommand' -a start -d 'Start the daemon'
complete -c lazydev -n '__fish_use_subcommand' -a stop -d 'Stop the daemon'
complete -c lazydev -n '__fish_use_subcommand' -a restart -d 'Restart the daemon'
complete -c lazydev -n '__fish_use_subcommand' -a status -d 'Show project status'
complete -c lazydev -n '__fish_use_subcommand' -a up -d 'Force start a project'
complete -c lazydev -n '__fish_use_subcommand' -a down -d 'Force stop a project'
complete -c lazydev -n '__fish_use_subcommand' -a logs -d 'Show logs'

# Global options
complete -c lazydev -n '__fish_use_subcommand' -s h -l help -d 'Show help'
complete -c lazydev -n '__fish_use_subcommand' -s v -l version -d 'Show version'

# Add command
complete -c lazydev -n '__fish_seen_subcommand_from add' -s n -l name -d 'Project name'
complete -c lazydev -n '__fish_seen_subcommand_from add' -s c -l cmd -d 'Start command'
complete -c lazydev -n '__fish_seen_subcommand_from add' -s t -l timeout -d 'Idle timeout'
complete -c lazydev -n '__fish_seen_subcommand_from add' -s y -l yes -d 'Skip prompts'

# Start command
complete -c lazydev -n '__fish_seen_subcommand_from start' -s p -l port -d 'Proxy port'
complete -c lazydev -n '__fish_seen_subcommand_from start' -s F -l foreground -d 'Run in foreground'

# Logs command
complete -c lazydev -n '__fish_seen_subcommand_from logs' -s f -l follow -d 'Follow logs'
complete -c lazydev -n '__fish_seen_subcommand_from logs' -s l -l lines -d 'Number of lines'

# Down command
complete -c lazydev -n '__fish_seen_subcommand_from down' -s a -l all -d 'Stop all projects'
`;

export function getShell(): "bash" | "zsh" | "fish" | null {
  const shell = process.env["SHELL"] ?? "";
  if (shell.includes("zsh")) return "zsh";
  if (shell.includes("bash")) return "bash";
  if (shell.includes("fish")) return "fish";
  return null;
}

export function installCompletions(shell?: "bash" | "zsh" | "fish"): { success: boolean; message: string } {
  const targetShell = shell ?? getShell();
  
  if (!targetShell) {
    return { 
      success: false, 
      message: "Could not detect shell. Set $SHELL or specify: --shell bash|zsh|fish" 
    };
  }
  
  let targetPath: string;
  let completion: string;
  
  switch (targetShell) {
    case "bash":
      targetPath = join(HOME, ".local/share/bash-completion/completions/lazydev");
      completion = BASH_COMPLETION;
      break;
    case "zsh":
      targetPath = join(HOME, ".zfunc/_lazydev");
      completion = ZSH_COMPLETION;
      break;
    case "fish":
      targetPath = join(HOME, ".config/fish/completions/lazydev.fish");
      completion = FISH_COMPLETION;
      break;
  }
  
  const targetDir = join(targetPath, "..");
  
  try {
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    writeFileSync(targetPath, completion);
  } catch (err) {
    return { 
      success: false, 
      message: `Failed to write completion: ${err instanceof Error ? err.message : String(err)}` 
    };
  }
  
  const instructions = targetShell === "zsh" 
    ? "Run: source ~/.zshrc or restart your shell"
    : targetShell === "bash"
    ? "Run: source ~/.bashrc or restart your shell"
    : "Restart your shell or run: source ~/.config/fish/config.fish";
  
  return { 
    success: true, 
    message: `✓ Installed ${targetShell} completions to: ${targetPath}\n  ${instructions}` 
  };
}
