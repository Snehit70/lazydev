# LazyDev v2: Zero-Config Proactive Proxy

## Overview

Eliminate manual project configuration. The proxy automatically discovers running dev servers by matching subdomain to project directory.

## Core Concept

```
User visits: fleetflow.localhost
     ↓
Proxy checks: ~/projects/fleetflow/ exists?
     ↓
Find process with cwd = ~/projects/fleetflow
     ↓
Get port that process is listening on
     ↓
Proxy request to that port
```

## User Workflow (New)

```bash
# One-time setup
lazydev init          # Setup dnsmasq, port 80 capability

# Daily usage
lazydev start         # Start proxy daemon (or run as systemd service)

# In any terminal
cd ~/projects/fleetflow
bun dev               # Starts on whatever port (3000, 5173, etc.)

# In browser
http://fleetflow.localhost   # Just works!
```

**No `lazydev add` needed!**

## Technical Implementation

### 1. Directory Detection

When request comes in for `<name>.localhost`:

```
1. Check if ~/projects/<name>/ exists
2. If not → 404 "Project not found"
```

### 2. Process → Port Discovery (Linux)

Find listening port for a process with specific cwd:

```bash
# Option A: Using /proc filesystem
# 1. Find all PIDs with matching cwd
for pid in /proc/[0-9]*; do
  if [[ "$(readlink $pid/cwd)" == "/home/user/projects/fleetflow" ]]; then
    echo $pid
  fi
done

# 2. For each PID, find listening sockets
# Parse /proc/<pid>/fd/ → /proc/<pid>/net/tcp
```

```bash
# Option B: Using lsof (simpler but external dependency)
lsof -c . -a -i TCP -s TCP:LISTEN -F pcn | 
  awk '/^p/{pid=$0} /^n/{print pid, $0}' |
  while read pid port; do
    cwd=$(readlink /proc/${pid#p}/cwd)
    if [[ "$cwd" == "/home/user/projects/fleetflow" ]]; then
      echo ${port#n} | grep -oP ':\K\d+'
    fi
  done
```

```bash
# Option C: Using ss + /proc (no lsof dependency)
ss -tlnp | grep LISTEN | while read line; do
  port=$(echo $line | awk '{print $4}' | grep -oP ':\K\d+$')
  pid=$(echo $line | grep -oP 'pid=\K\d+')
  cwd=$(readlink /proc/$pid/cwd 2>/dev/null)
  if [[ "$cwd" == "/home/user/projects/fleetflow" ]]; then
    echo $port
  fi
done
```

### 3. Bun/Node.js Implementation

```typescript
import { readlink } from "fs/promises";
import { execSync } from "child_process";

interface ProcessPort {
  pid: number;
  port: number;
  cwd: string;
}

async function findPortForProject(projectPath: string): Promise<number | null> {
  // Get all listening TCP sockets with PIDs
  const ss = execSync("ss -tlnp", { encoding: "utf-8" });
  
  for (const line of ss.split("\n")) {
    const portMatch = line.match(/:(\d+)\s/);
    const pidMatch = line.match(/pid=(\d+)/);
    
    if (portMatch && pidMatch) {
      const port = parseInt(portMatch[1]);
      const pid = parseInt(pidMatch[1]);
      
      try {
        const cwd = await readlink(`/proc/${pid}/cwd`);
        if (cwd === projectPath) {
          return port;
        }
      } catch {
        // Process may have exited
      }
    }
  }
  
  return null;
}
```

## Proxy Flow (Updated)

```typescript
async function handleRequest(req: Request): Promise<Response> {
  const host = req.headers.get("host") || "";
  const subdomain = host.split(".")[0];
  
  // 1. Check project directory exists
  const projectPath = `${PROJECTS_DIR}/${subdomain}`;
  if (!existsSync(projectPath)) {
    return new Response(`Project "${subdomain}" not found`, { status: 404 });
  }
  
  // 2. Find running dev server for this project
  const port = await findPortForProject(projectPath);
  if (!port) {
    return new Response(
      `No dev server running for "${subdomain}"\n\n` +
      `Start one with:\n  cd ${projectPath}\n  bun dev`,
      { status: 503 }
    );
  }
  
  // 3. Proxy to discovered port
  return proxyRequest(req, port);
}
```

## Configuration (Simplified)

`~/.config/lazydev/config.yaml`:

```yaml
settings:
  proxy_port: 80
  projects_dir: ~/projects    # Where to look for projects

# Optional: aliases for shorter URLs
aliases:
  ff: fleetflow              # ff.localhost → ~/projects/fleetflow
  api: backend-service       # api.localhost → ~/projects/backend-service
```

## Commands (Updated)

| Command | Description |
|---------|-------------|
| `lazydev init` | Setup dnsmasq, port 80 capability |
| `lazydev start` | Start proxy daemon |
| `lazydev stop` | Stop proxy daemon |
| `lazydev status` | Show all detected running projects |
| `lazydev alias <short> <project>` | Create alias (ff → fleetflow) |
| `lazydev unalias <short>` | Remove alias |

**Removed:**
- `lazydev add` - No longer needed
- `lazydev remove` - No longer needed

## Status Command (New Output)

```
$ lazydev status

Proxy: running on port 80
Projects dir: ~/projects

Running dev servers:
  fleetflow     → port 3000  http://fleetflow.localhost
  backend-api   → port 8080  http://backend-api.localhost
  
Aliases:
  ff → fleetflow            http://ff.localhost

Not running:
  ~/projects/mobile-app     (no dev server detected)
  ~/projects/docs           (no dev server detected)
```

## Edge Cases

### Multiple processes in same directory
- Take the first listening port found
- Or: prefer common dev ports (3000, 5173, 8080)

### Nested projects (monorepo)
```
~/projects/monorepo/
  ├── apps/web/        # Running on 3000
  ├── apps/api/        # Running on 8080
  └── packages/
```
- `monorepo.localhost` → matches ~/projects/monorepo (might find either)
- Solution: Use aliases for clarity
  - `web.localhost` → alias to `monorepo/apps/web`

### Projects outside ~/projects
- Allow config override:
  ```yaml
  extra_dirs:
    - ~/work
    - ~/clients
  ```

### Child processes (e.g., Vite spawned by Nuxt)
- Check parent process cwd too
- Walk up the process tree

## Implementation Phases

### Phase 1: Core (MVP)
- [ ] Implement `findPortForProject()` using `ss` + `/proc`
- [ ] Update proxy to use directory-first lookup
- [ ] Remove `add`/`remove` commands
- [ ] Update `status` to show discovered servers

### Phase 2: Polish
- [ ] Add `alias`/`unalias` commands
- [ ] Handle child processes (walk process tree)
- [ ] Custom error pages (HTML instead of plain text)
- [ ] Cache port lookups (invalidate on 5s interval)

### Phase 3: Nice-to-have
- [ ] Support multiple project directories
- [ ] WebSocket for live status updates
- [ ] Browser extension for quick project switching

## Migration

Users with existing config:
- Old `projects:` entries become aliases automatically
- Show deprecation warning on `lazydev add`
