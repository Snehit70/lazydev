# LazyDev

Zero-config `*.localhost` URLs for your dev servers on Linux.

Start a dev server anywhere inside `~/projects/myproject`, then open `http://myproject.localhost`. You don't register projects or remember ports. LazyDev finds the port the server is listening on and proxies to it, WebSockets and HMR included.

## Installation

```bash
git clone <repo> ~/projects/lazydev
cd ~/projects/lazydev
bun install
bun link
lazydev init
```

`lazydev init` creates the config, then checks that the projects directory exists, that `*.localhost` resolves, and that the proxy port can be bound. It tells you what to fix if any of those fail.

## Quick Start

```bash
lazydev start                  # background service (systemd --user)

cd ~/projects/myproject
bun dev                        # or npm run dev, vite, nuxt dev, rails s, ...

# open http://myproject.localhost
```

Open `http://localhost` to see every running project, or run `lazydev open` inside a project to open its URL.

If a server isn't found, `lazydev doctor` explains why.

## CLI Commands

```
lazydev init                  Create config and check the system
lazydev start                 Start the proxy (systemd service, foreground fallback)
lazydev stop                  Stop the proxy
lazydev restart               Restart the proxy
lazydev run                   Run the proxy in the foreground
lazydev status [name]         Show proxy and project status (alias: list)
lazydev open [name]           Open a project in the browser (default: current directory)
lazydev url [name]            Print a project's URL
lazydev doctor                Check the setup and explain why a server isn't found
lazydev logs [-f] [-l N]      Show proxy logs
lazydev alias <short> <dir>   http://<short>.localhost → <projects_dir>/<dir>
lazydev alias <short> <port>  http://<short>.localhost → localhost:<port>
lazydev unalias <short>       Remove an alias
lazydev completions [--shell bash|zsh|fish]
```

## How It Works

```
Browser → http://myproject.localhost → LazyDev (:80) → localhost:<discovered port>
```

1. The last label before `.localhost` names the project, so `api.myproject.localhost` also routes to `myproject`. Matching is case-insensitive.
2. LazyDev reads `/proc/net/tcp{,6}` and `/proc/<pid>/{fd,cwd}` to find listening sockets owned by processes whose working directory is inside the project.
3. A server running in the project root wins over one in a subdirectory (monorepos). Within that, the lowest port wins. Privileged ports (<1024) are ignored.
4. The request is forwarded with `X-Forwarded-Host/Proto/For`. Redirects that point at the upstream port are rewritten to the public URL, and WebSocket upgrades are forwarded with their subprotocol and cookies.

The proxy listens on both `127.0.0.1` and `::1`, since systemd-resolved answers `*.localhost` with `::1` first.

Discovery results are cached for one second. If the dev server restarts on a new port, the next request notices the dead port, rescans, and retries.

Status codes:

| Code | Meaning |
|------|---------|
| 400 | Host is not a valid `*.localhost` name |
| 404 | No such directory in any projects dir and no alias |
| 503 | Directory exists but nothing is listening, or nothing listens on an aliased port |
| 502 | The dev server stopped responding mid-request |
| 508 | A port alias points at the proxy itself |

The 503 page suggests the command that starts the project (from `package.json` scripts and the lockfile, or `bin/dev`, `manage.py`, `Cargo.toml`, ...) and reloads itself once the server is up. `lazydev status <name>` lists other ports the project listens on.

## Configuration

Config file: `~/.config/lazydev/config.yaml`. Edits, including those made by `lazydev alias`, are picked up without a restart; only `proxy_port` needs `lazydev restart`.

```yaml
settings:
  proxy_port: 80
  projects_dir: ~/projects   # or a list: [~/projects, ~/work]; the first match wins

aliases:
  mp: myproject          # http://mp.localhost
  web: monorepo/apps/web # targets can be nested paths
  grafana: 3000          # or a port: Docker containers, servers outside projects_dir
```

A port alias also pins a project to one port when it listens on several.

Environment overrides:

| Variable | Default |
|----------|---------|
| `LAZYDEV_CONFIG` | `~/.config/lazydev/config.yaml` |
| `LAZYDEV_DATA_DIR` | `~/.local/share/lazydev` (logs, PID file) |

## Requirements

- Linux (discovery uses `/proc`)
- Bun 1.2+
- systemd user session for `lazydev start` (otherwise use `lazydev run`)

### Port 80

Unprivileged processes can't bind port 80 by default. Allow it:

```bash
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/50-lazydev.conf
sudo sysctl --system
```

Or set `proxy_port` to something like `8080` and use `http://myproject.localhost:8080`.

Don't use `setcap cap_net_bind_service=+ep` on `bun`. The kernel marks every process started from a binary with file capabilities as non-dumpable, which makes its `/proc/<pid>/cwd` and `/proc/<pid>/fd` unreadable even to you. LazyDev then can't see any dev server run with bun. If you set it earlier, apply the sysctl above, then:

```bash
sudo setcap -r $(readlink -f $(which bun))
lazydev restart
```

Restart your bun dev servers afterwards. `lazydev init`, `status`, and `doctor` warn when bun has file capabilities.

### DNS

Browsers resolve `*.localhost` on their own. With systemd-resolved (the default on Fedora and Ubuntu), so do `curl` and other CLI tools. Without it, use dnsmasq:

```bash
sudo dnf install dnsmasq
echo "address=/localhost/127.0.0.1" | sudo tee /etc/dnsmasq.d/lazydev
sudo systemctl enable --now dnsmasq
```

## Why Proxy-Only?

Earlier versions started and stopped dev servers on demand. Cold starts and lazy compilation in Vite and Nuxt caused races, and HMR, workers, and background processes made lifecycle management fragile. Now you run your dev server however you like, and LazyDev only handles routing.

## Development

```bash
bun test                # unit + proxy integration tests
bunx tsc --noEmit       # type check
bun src/index.ts --help
```

To try changes without touching a running service, use a separate config and port:

```bash
LAZYDEV_CONFIG=/tmp/ld/config.yaml LAZYDEV_DATA_DIR=/tmp/ld bun src/index.ts run
```

## License

MIT
