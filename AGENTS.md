# LazyDev - Scale-to-Zero Dev Server Manager

## Project Overview

LazyDev is a dev server manager that:
- Gives each project a clean subdomain URL (`http://project.localhost`)
- Automatically stops idle servers to save RAM
- Uses **dynamic idle timeout** based on cold start time, WebSocket state, and activity patterns

## Architecture

```
src/
├── index.ts           # CLI entry point (command routing)
├── lib/
│   ├── types.ts       # TypeScript interfaces (Config, Settings, ProjectState, ProjectMetrics)
│   ├── config.ts      # YAML config loader with validation
│   ├── state.ts       # SQLite state persistence (bun:sqlite)
│   ├── port.ts        # Port allocator (4000-4999 range)
│   ├── process.ts     # Dev server start/stop, health checks
│   ├── proxy.ts       # HTTP/WebSocket reverse proxy on port 80
│   └── idle.ts        # Dynamic timeout calculation + idle watcher
└── cli/               # CLI commands (init, add, remove, list, start, stop, status, up, down, logs)
```

## Commands

| Command | Description |
|---------|-------------|
| `lazydev init` | Initialize config, setup dnsmasq |
| `lazydev add <path>` | Add a project (auto-detects start_cmd) |
| `lazydev remove <name>` | Remove a project |
| `lazydev list` | List configured projects |
| `lazydev start` | Start the proxy daemon |
| `lazydev stop` | Stop the proxy daemon |
| `lazydev status [name]` | Show project status |
| `lazydev up <name>` | Force start a project |
| `lazydev down <name>` | Force stop a project |
| `lazydev logs [name]` | Show logs (not yet implemented) |

## Dynamic Timeout Algorithm

```
effective_timeout = base_timeout × cold_start_factor × ws_multiplier × activity_multiplier

Where:
- base_timeout = 5 minutes
- cold_start_factor = cold_start_time / 5000ms
- ws_multiplier = 2.0 if WebSocket connected, 1.0 otherwise
- activity_multiplier = 0.5 + (activity_score × 0.5)
```

Clamped to `[min_timeout, max_timeout]` range (default: 2m - 30m).

## Configuration

Config location: `~/.config/lazydev/config.yaml`

```yaml
settings:
  proxy_port: 80
  idle_timeout: 10m
  startup_timeout: 30s
  port_range: [4000, 4999]
  scan_interval: 30s
  dynamic_timeout: true
  min_timeout: 2m
  max_timeout: 30m

projects:
  myproject:
    name: myproject
    cwd: ~/projects/myproject
    start_cmd: bun dev
    idle_timeout: 15m  # optional override
    disabled: false    # optional
    aliases: [mp]      # optional
```

## State Persistence

SQLite database: `~/.local/share/lazydev/state.db`

Tables:
- `projects` - Runtime state (port, pid, status, last_activity, websocket_connections)
- `metrics` - Performance metrics (cold_start_time, request_history)

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (full strict mode)
- **Database**: bun:sqlite
- **Config**: YAML
- **Proxy**: Bun's built-in `serve()` with WebSocket support

## TypeScript Configuration

Full strict mode enabled:
- `strict: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitReturns: true`
- `noPropertyAccessFromIndexSignature: true`
- `noUncheckedIndexedAccess: true`
- `verbatimModuleSyntax: true`

## Key Implementation Details

### Proxy Flow
1. Request arrives at `project.localhost`
2. Extract subdomain → lookup project config
3. Check if running (state + health check)
4. If stopped: start project, wait for healthy
5. Proxy request to internal port (4000-4999)
6. Update activity timestamp

### Idle Watcher Flow
1. Every `scan_interval` (30s)
2. For each running project:
   - Skip if WebSocket connections > 0
   - Skip if `disabled: true`
   - Calculate effective timeout (dynamic or per-project)
   - Stop if `idle_time >= timeout`

### Config Getter Pattern
The idle watcher needs access to project configs for per-project timeouts.
`setConfigGetter(() => config.projects)` is called at startup in `cli/start.ts`.

## Environment Variables

- `PORT` - Set by LazyDev when starting projects (internal port)
- `HOST` - Set to "localhost"
- `LAZYDEV_STATE_DIR` - Override state directory (default: `~/.local/share/lazydev`)

## Setup Requirements

1. **Port 80 binding**: `sudo setcap 'cap_net_bind_service=+ep' $(which bun)`
2. **DNS wildcard**: dnsmasq config for `*.localhost` → 127.0.0.1

## Testing

```bash
# Build
bun build ./src/index.ts --outdir ./dist --target bun

# Type check
bun run tsc --noEmit

# Run locally
bun run src/index.ts --help
```

## Known Issues / TODO

- [ ] `lazydev logs` not implemented
- [ ] Hot reload when config changes
- [ ] systemd service integration (service file exists but not auto-installed)
- [ ] Windows/macOS support (currently Linux-only due to dnsmasq)
