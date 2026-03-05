# LazyDev - Proxy-Only Dev Server Manager

## Project Overview

LazyDev is a dev server manager that:
- Gives each project a clean subdomain URL (`http://project.localhost`)
- Proxies requests to your manually-started dev servers
- No lifecycle management - you control your dev servers

## Architecture

```
src/
├── index.ts           # CLI entry point (command routing)
├── lib/
│   ├── types.ts       # TypeScript interfaces (Config, ProjectConfig, Settings)
│   ├── config.ts      # YAML config loader with validation
│   ├── proxy.ts       # HTTP/WebSocket reverse proxy on port 80
│   ├── systemd.ts     # Systemd stubs (proxy-only mode)
│   └── completions.ts # Shell completions
└── cli/               # CLI commands (init, add, remove, list, start, stop, status, logs, completions)
```

## Commands

| Command | Description |
|---------|-------------|
| `lazydev init` | Initialize config, setup dnsmasq |
| `lazydev add --port <n>` | Add a project (requires port) |
| `lazydev remove <name>` | Remove a project |
| `lazydev list` | List configured projects |
| `lazydev start` | Start the proxy daemon |
| `lazydev stop` | Stop the proxy daemon |
| `lazydev restart` | Restart the proxy daemon |
| `lazydev status [name]` | Show project status |
| `lazydev logs` | View proxy logs |
| `lazydev completions` | Install shell completions |

## Configuration

Config location: `~/.config/lazydev/config.yaml`

```yaml
settings:
  proxy_port: 80

projects:
  myproject:
    port: 3000
    aliases: [mp]      # optional: access via http://mp.localhost
    disabled: false    # optional
```

## Proxy Flow

1. Request arrives at `project.localhost`
2. Extract subdomain → lookup project config
3. If disabled: return 503
4. Proxy request to configured port
5. Relay response to client

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
```

## Known Issues / TODO

- [ ] `lazydev logs` stub - returns "not implemented"
- [ ] Hot reload when config changes
- [ ] systemd service integration (service file exists but not auto-installed)
- [ ] Windows/macOS support (currently Linux-only due to dnsmasq)

## Why Proxy-Only?

The previous version attempted scale-to-zero (auto stop/start dev servers). This failed for Nuxt/Vite due to:
- Lazy compilation: routes compile on first browser request
- Cold start race conditions: HTTP accepts before ready
- Complex framework lifecycle: workers, hot reload, background processes

Proxy-only is simpler and more reliable - you control your dev server, LazyDev handles routing.
