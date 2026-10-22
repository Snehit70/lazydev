# LazyDev - Zero-Config Dev Server Proxy

## Project Overview

LazyDev proxies `http://<project>.localhost` to whatever dev server is running inside `~/projects/<project>`. Nothing is registered. Ports are discovered from `/proc` on every request (cached for 1s). It is proxy-only: it never starts or stops dev servers.

## Architecture

```text
src/
├── index.ts           # CLI entry point (argument parsing, command routing)
├── lib/
│   ├── types.ts       # Config, Settings, defaults
│   ├── config.ts      # YAML load/validate, comment-preserving atomic updates
│   ├── routing.ts     # Host header → project name → directory (alias, case-insensitive)
│   ├── discovery.ts   # /proc listener scan, port selection, snapshot cache
│   ├── caps.ts        # bun file-capability detection, hidden-process scan
│   ├── hints.ts       # Guess a project's dev command for error pages and status
│   ├── proxy.ts       # Bun.serve HTTP/WebSocket proxy, error pages, dashboard, config watch
│   ├── pidfile.ts     # Foreground-mode PID file (pid + start time)
│   ├── systemd.ts     # systemd --user unit management
│   ├── logger.ts      # File logger with rotation
│   └── completions.ts # bash/zsh/fish completion scripts
└── cli/               # One module per command
test/
├── setup.ts           # Preload: points LAZYDEV_CONFIG/LAZYDEV_DATA_DIR at a temp dir
├── fixtures/upstream.ts  # Fake dev server used by proxy tests
└── *.test.ts
```

## Commands

| Command | Description |
|---------|-------------|
| `lazydev init` | Create config; check projects dir, DNS, and port |
| `lazydev start` | Start via systemd, fall back to foreground |
| `lazydev stop` | Stop systemd service or the foreground PID from the PID file |
| `lazydev restart` | Regenerate the unit and restart |
| `lazydev run` | Foreground proxy (what the systemd unit executes) |
| `lazydev status [name]` / `list` | Proxy state, running projects, aliases |
| `lazydev open [name]` / `url [name]` | Open or print a URL (default: project containing cwd) |
| `lazydev doctor` | Setup checks plus listening ports LazyDev can't attribute |
| `lazydev logs [-f] [-l N]` | Proxy logs |
| `lazydev alias <short> <dir\|port>` / `unalias <short>` | Manage aliases |
| `lazydev completions [--shell s]` | Install shell completions |

## Request Flow

1. `parseHost` takes the last label before `.localhost` (`api.foo.localhost` → `foo`). Bare `localhost` serves the dashboard.
2. `resolveRoute` applies aliases (a number means a port route), then resolves the directory in each `projects_dir` root in order (exact match first, then case-insensitive; never escapes the root).
3. `getListeners` scans `/proc/net/tcp{,6}` for LISTEN sockets, maps inodes to PIDs via `/proc/<pid>/fd`, and keeps those whose `cwd` is inside `projects_dir`.
4. `pickListener` prefers a cwd that equals the project dir over subdirectories, then the lowest port, then IPv4. Ports <1024 and the proxy's own port are excluded.
5. `forwardRequest` uses `fetch` with `decompress: false` and `redirect: "manual"`, sets `X-Forwarded-*`, and rewrites `Location`. On a connection error it invalidates the cache and retries once.
6. WebSocket: the proxy connects upstream first (forwarding the subprotocol, cookie, origin, and auth headers), then upgrades the client. It returns 502 if the upstream refuses.

## Bun Gotchas (verified)

- `fetch` decompresses but keeps `content-encoding`. Always pass `decompress: false` when proxying.
- `server.upgrade` echoes the first requested `Sec-WebSocket-Protocol` automatically. Setting it manually duplicates the header, and clients close with 1002.
- `fs.watch` on a directory reports only the temp filename for atomic renames. The config watcher therefore reacts to any event and compares file contents.
- Vite HMR rejects upgrades without `sec-websocket-protocol: vite-hmr`.
- A `bun` binary with file capabilities (`setcap`) makes its processes non-dumpable: `/proc/<pid>/cwd` and `/fd` become unreadable to the same user, so discovery misses them. Tests still pass in that state because a capable parent (`bun test`) spawning bun keeps children dumpable. Never recommend setcap; use the `ip_unprivileged_port_start` sysctl.

## Configuration

`~/.config/lazydev/config.yaml` (override with `LAZYDEV_CONFIG`):

```yaml
settings:
  proxy_port: 80
  projects_dir: ~/projects   # or a list; earlier roots shadow later ones

aliases:
  ff: fleetflow
  web: monorepo/apps/web
  grafana: 3000            # port alias: any local listener, any owner
```

`LAZYDEV_DATA_DIR` (default `~/.local/share/lazydev`) holds `proxy.log` and `proxy.pid`.

## Development

```bash
bun test            # all tests; never touches the real config or service
bunx tsc --noEmit   # strict mode, incl. exactOptionalPropertyTypes and noUncheckedIndexedAccess
```

When testing the CLI by hand, never run `start`/`stop`/`restart` against a live service. Use `LAZYDEV_CONFIG` and `LAZYDEV_DATA_DIR` with a high `proxy_port` and `lazydev run`.

## Known Limitations

- Linux only (`/proc`).
- With several listening ports in one project dir, the lowest port wins. Pin another with a port alias.
- Processes owned by other users, or started from binaries with file capabilities, are invisible, because `/proc/<pid>/fd` is unreadable. Port aliases work for those.
