# LazyDev

Scale-to-zero dev server manager for Linux.

**Key feature**: Automatically stops idle dev servers to save RAM (300-500 MB per server).

## Installation

```bash
cd ~/projects/lazydev
bun link
lazydev init
```

## Quick Start

```bash
# 1. Add a project
lazydev add ~/projects/myproject

# 2. Start the daemon
lazydev start

# 3. Access in browser
# http://myproject.localhost
```

## CLI Commands

```
lazydev init              # Setup config, dnsmasq, port 80
lazydev add <path>        # Add project
lazydev remove <name>     # Remove project
lazydev list              # List all projects
lazydev start             # Start daemon
lazydev stop              # Stop daemon
lazydev status [name]     # Show status
lazydev up <name>         # Force start
lazydev down <name>       # Force stop
lazydev down --all        # Stop all
lazydev logs [name]       # View logs
```

## How It Works

1. **Clean URLs**: `http://project.localhost` (no port numbers)
2. **Auto port allocation**: Projects get random ports in 4000-4999 range
3. **Scale-to-zero**: Servers stop after 10 min idle (configurable)
4. **WebSocket support**: HMR works for Vite, Nuxt, Next.js

## Configuration

Config file: `~/.config/lazydev/config.yaml`

```yaml
settings:
  proxy_port: 80
  idle_timeout: 10m
  startup_timeout: 30s
  port_range: [4000, 4999]

projects:
  myproject:
    name: myproject
    cwd: ~/projects/myproject
    start_cmd: bun dev
    idle_timeout: 15m
```

## Requirements

- Bun 1.2+
- Linux
- dnsmasq (for DNS)

## Setup

### 1. Port 80 (clean URLs)

```bash
sudo setcap 'cap_net_bind_service=+ep' $(which bun)
```

### 2. dnsmasq (DNS)

```bash
sudo dnf install dnsmasq
echo "address=/localhost/127.0.0.1" | sudo tee /etc/dnsmasq.d/lazydev
sudo systemctl enable --now dnsmasq
```

## Comparison with Portless

| Feature | LazyDev | Portless |
|---------|---------|----------|
| Clean URLs | ✅ Port 80 | Port 1355 |
| Scale-to-zero | ✅ | ❌ |
| RAM savings | ✅ 300-500 MB/server | ❌ |
| Config | One-time | Wrap every command |

## License

MIT
