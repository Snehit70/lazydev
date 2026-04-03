# LazyDev

Zero-config dev server proxy for Linux.

**Key feature**: Clean subdomain URLs (`*.localhost`) routing to your manually-started dev servers.

## Installation

```bash
cd ~/projects/lazydev
bun link
lazydev init
```

## Quick Start

```bash
# 1. Start your dev server manually (in a separate terminal)
cd ~/projects/myproject
bun dev

# 2. Start the proxy
lazydev start

# 3. Access in browser
# http://myproject.localhost

# Optional: create a short alias
lazydev alias mp myproject
# http://mp.localhost
```

## CLI Commands

```
lazydev init              # Setup config, dnsmasq, port 80
lazydev start             # Start proxy daemon
lazydev stop              # Stop proxy daemon
lazydev restart           # Restart proxy daemon
lazydev alias <a> <p>     # Add alias <a> for project <p>
lazydev unalias <a>       # Remove alias <a>
lazydev status [name]     # Show status
lazydev logs              # View proxy logs
lazydev completions       # Install shell completions
```

## How It Works

1. **You start your dev server** (e.g., `bun dev`, `npm run dev`)
2. **LazyDev discovers the listening port** from the running process
3. **LazyDev proxies** `*.localhost` requests to your dev server

```
Browser → http://myproject.localhost → LazyDev Proxy → discovered localhost:PORT
```

## Configuration

Config file: `~/.config/lazydev/config.yaml`

```yaml
settings:
  proxy_port: 80
  projects_dir: ~/projects

aliases:
  mp: myproject
```

## Why Proxy-Only?

The original LazyDev attempted to manage dev server lifecycle (start/stop on idle). This worked for simple servers but failed with:
- **Nuxt/Vite**: Cold start + lazy compilation = race conditions
- **Complex frameworks**: Hot reload, workers, background processes

Proxy-only mode is simpler and more reliable - you control your dev server, LazyDev handles routing.

## Comparison

| Feature | Proxy-Only | Scale-to-Zero |
|---------|------------|---------------|
| Clean URLs | ✅ | ✅ |
| Your control | ✅ Start/stop anytime | ❌ Auto-managed |
| Framework support | ✅ Any | ⚠️ Limited |
| RAM usage | You decide | Managed |

## Requirements

- Bun 1.2+
- Linux
- dnsmasq (for DNS)
- systemd user session (recommended for background service mode)

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

## License

MIT
