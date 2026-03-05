# LazyDev - Zero-Config Dev Server Proxy

## Project Overview

LazyDev is a zero-config dev server proxy that:
- Gives each project a clean subdomain URL (`http://project.localhost`)
- **Automatically discovers** running dev servers in `~/projects/`
- No manual configuration needed - just start your dev server and visit the URL

## Architecture

```
src/
├── index.ts           # CLI entry point (command routing)
├── lib/
│   ├── types.ts       # TypeScript interfaces (Config, Settings)
│   ├── config.ts      # YAML config loader with validation
│   ├── proxy.ts       # HTTP/WebSocket reverse proxy + port discovery
│   ├── systemd.ts     # Systemd stubs
│   └── completions.ts # Shell completions
└── cli/               # CLI commands (init, start, stop, status, logs, completions)
```

## Commands

| Command | Description |
|---------|-------------|
| `lazydev init` | Initialize config, setup dnsmasq |
| `lazydev start` | Start the proxy daemon |
| `lazydev stop` | Stop the proxy daemon |
| `lazydev restart` | Restart the proxy daemon |
| `lazydev status [name]` | Show running dev servers |
| `lazydev logs` | View proxy logs |
| `lazydev completions` | Install shell completions |

## How It Works (v0.3.0+)

```
User visits: fleetflow.localhost
     ↓
Proxy checks: ~/projects/fleetflow/ exists?
     ↓
Find process with cwd = that path (using ss + /proc)
     ↓
Get port that process is listening on
     ↓
Proxy request to that port
```

**No `lazydev add` needed!** Just:
1. Start the proxy: `lazydev start`
2. Start your dev server: `cd ~/projects/myapp && bun dev`
3. Visit: `http://myapp.localhost`

## Configuration

Config location: `~/.config/lazydev/config.yaml`

```yaml
settings:
  proxy_port: 80
  projects_dir: ~/projects    # Where to look for projects (default: ~/projects)

# Optional: aliases for shorter URLs
aliases:
  ff: fleetflow              # ff.localhost → ~/projects/fleetflow
  api: backend-service       # api.localhost → ~/projects/backend-service
```

## Proxy Flow

1. Request arrives at `project.localhost`
2. Check if `~/projects/project/` exists
3. Find listening process with cwd matching project path
4. Proxy request to discovered port
5. If no server running: return 503 with helpful message

## Key Functions

### `findPortForProject(projectPath, includeSubdirs?)`
Uses `ss -tlnp` + `/proc/{pid}/cwd` to find which port a dev server is listening on.
- Returns the port number if found
- `includeSubdirs=true` for monorepos (matches if cwd is a subdirectory)

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (full strict mode)
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

## Environment Variables

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
bun run src/index.ts status
```

## Known Issues / TODO

- [ ] `lazydev logs` stub - returns "not implemented"
- [ ] Hot reload when config changes
- [ ] systemd service integration (service file exists but not auto-installed)
- [ ] Windows/macOS support (currently Linux-only due to /proc filesystem)

## Why Zero-Config?

The previous version required manual `lazydev add --port <n>` for each project.
v0.3.0 eliminates this by discovering running dev servers automatically using
Linux process inspection (`/proc` filesystem).

Benefits:
- No configuration drift (config always matches reality)
- Works immediately with any project in `~/projects/`
- Supports monorepos (detects servers in subdirectories)
