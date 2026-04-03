# LazyDev v0.4.0 - Comprehensive Feature Plan

## Overview

Add three major features:
1. **Log streaming to file** - persistent logs with follow capability
2. **Hot config reload** - config changes without restart
3. **Systemd integration** - proper daemon management

---

## Feature 1: Log Streaming to File

### Problem
Currently logs only appear in the terminal where proxy runs. No persistent logs.

### Solution
Write logs to file at `~/.local/share/lazydev/proxy.log`, support tail-like follow.

### Implementation

**New file: `src/lib/logger.ts`**
```typescript
const LOG_DIR = `${homedir()}/.local/share/lazydev`;
const LOG_FILE = `${LOG_DIR}/proxy.log`;

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

export function log(level: string, message: string): void {
  ensureLogDir();
  const timestamp = new Date().toISOString();
  const logLine = `${timestamp} [${level}] ${message}\n`;
  
  // Write to file
  appendFileSync(LOG_FILE, logLine);
  
  // Also write to stdout (development)
  console.log(logLine.trim());
}

export function readLogs(lines: number = 100): string {
  if (!existsSync(LOG_FILE)) return "";
  // Read last N lines
}

export function tailLogs(lines: number, onLine: (line: string) => void): () => void {
  // Watch file, emit new lines
}
```

**Update `src/cli/logs.ts`:**
```bash
lazydev logs              # Last 100 lines
lazydev logs -n 50       # Last 50 lines  
lazydev logs -f          # Follow in real-time
```

### Changes Required
- Create `src/lib/logger.ts`
- Update proxy.ts to use logger instead of console.log
- Update logs.ts CLI to read/tail log file

---

## Feature 2: Hot Config Reload

### Problem
Currently if you add an alias or change projects_dir, you must restart the proxy.

### Solution
Watch config file for changes, reload on modification (debounced).

### Implementation

**In `src/lib/proxy.ts`:**
```typescript
import { watch } from "fs";

// Add to global scope or proxy module
let configWatcher: FSWatcher | null = null;

export function watchConfig(configPath: string, onReload: () => void): void {
  const debounce = debounceFn(onReload, 500);
  
  configWatcher = watch(configPath, (eventType) => {
    if (eventType === "change") {
      console.log("[Config] Detected change, reloading...");
      debounce();
    }
  });
}

export function stopConfigWatcher(): void {
  if (configWatcher) {
    configWatcher.close();
    configWatcher = null;
  }
}
```

**In `src/cli/start.ts`:**
```typescript
// After starting proxy:
watchConfig(configPath, () => {
  try {
    const newConfig = loadConfig();
    setConfig(newConfig);
    console.log("[Config] Reloaded successfully");
  } catch (err) {
    console.error("[Config] Failed to reload:", err);
  }
});
```

### Changes Required
- Add watchConfig() function to proxy.ts or new config.ts
- Call from start.ts
- Add debounce utility

---

## Feature 3: Systemd Service Integration

### Problem
Current `lazydev start` runs in foreground. User must keep terminal open. Should run as proper systemd service.

### Solution
Replace manual PID management with systemd. `start` → creates/enables service if needed, then starts it.

### Current State
- Service file exists: `lazydev.service`
- systemd.ts is all stubs
- start.ts does manual PID management

### New Flow

```bash
# lazydev start
#   → Check if systemd available
#   → If not, fall back to foreground mode
#   → If yes:
#       → Check if service exists
#       → If not, create from template
#       → systemctl daemon-reload
#       → systemctl enable lazydev
#       → systemctl start lazydev
#   → Show status

# lazydev stop
#   → systemctl stop lazydev

# lazydev restart  
#   → systemctl restart lazydev
```

### Implementation

**Update `src/lib/systemd.ts`:**

```typescript
const SERVICE_NAME = "lazydev";
const SERVICE_FILE_PATH = "~/.config/systemd/user/lazydev.service";

function getServiceFile(): string {
  const bunPath = process.argv[0]; // /home/user/.bun/bin/bun
  const scriptPath = process.argv[1]; // /path/to/src/index.ts
  
  return `[Unit]
Description=LazyDev - Zero-config dev server proxy
After=network.target

[Service]
Type=simple
ExecStart=${bunPath} ${scriptPath} run
Restart=always
RestartSec=5
Environment=HOME=${homedir()}

[Install]
WantedBy=default.target
`;
}

export async function ensureService(): Promise<boolean> {
  // Check if systemd available
  if (!isSystemdAvailable()) return false;
  
  // Check if service file exists
  if (!existsSync(SERVICE_FILE_PATH)) {
    writeFileSync(SERVICE_FILE_PATH, getServiceFile());
    execSync("systemctl daemon-reload");
  }
  
  // Enable service
  execSync(`systemctl enable ${SERVICE_NAME}`);
  return true;
}

export async function startService(): Promise<{ success: boolean; message: string }> {
  try {
    const created = await ensureService();
    execSync(`systemctl start ${SERVICE_NAME}`);
    return { success: true, message: "Service started" };
  } catch (err) {
    return { success: false, message: String(err) };
  }
}

export async function restartService(): Promise<{ success: boolean; message: string }> {
  try {
    execSync(`systemctl restart ${SERVICE_NAME}`);
    return { success: true, message: "Service restarted" };
  } catch (err) {
    return { success: false, message: String(err) };
  }
}

export async function stopService(): Promise<{ success: boolean; message: string }> {
  try {
    execSync(`systemctl stop ${SERVICE_NAME}`);
    return { success: true, message: "Service stopped" };
  } catch (err) {
    return { success: false, message: String(err) };
  }
}

export function isSystemdAvailable(): boolean {
  try {
    execSync("systemctl is-system-running", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
```

**Update `src/cli/start.ts`:**
```typescript
export async function run(foreground: boolean = false) {
  const useSystemd = !foreground && isSystemdAvailable();
  
  if (useSystemd) {
    const result = await startService();
    if (result.success) {
      console.log("✓ LazyDev service started");
      return;
    }
    console.log("⚠ Systemd failed, starting in foreground...");
  }
  
  // Fall back to foreground mode
  // ... existing code
}
```

**Update `src/cli/stop.ts`:**
```typescript
export async function run() {
  if (isSystemdAvailable()) {
    const result = await stopService();
    console.log(result.message);
    return;
  }
  
  // Fall back to PID file
  // ... existing code
}
```

**Update `src/cli/restart.ts`:**
```typescript
export async function run() {
  if (isSystemdAvailable()) {
    const result = await restartService();
    console.log(result.message);
    return;
  }
  
  // Fall back to stop + start
}
```

### Changes Required
- Rewrite `src/lib/systemd.ts` with real implementation
- Update `src/cli/start.ts` to use systemd
- Update `src/cli/stop.ts` to use systemd
- Update `src/cli/restart.ts` to use systemd

### Edge Cases
- No systemd (containers, WSL without systemd) → fallback to foreground
- Permission denied → error message, suggest sudo
- Service file already exists → skip creation, just start

---

## Implementation Order

### Phase 1: Logger (Quick Win)
1. Create `src/lib/logger.ts`
2. Update proxy.ts to use logger
3. Implement `lazydev logs`

### Phase 2: Hot Reload (Dependent on Logger)
1. Add watchConfig() function
2. Integrate with start.ts
3. Test alias changes without restart

### Phase 3: Systemd (Major)
1. Rewrite systemd.ts
2. Update start/stop/restart
3. Test service lifecycle

---

## Files to Change

| File | Changes |
|------|---------|
| `src/lib/logger.ts` | New file |
| `src/lib/proxy.ts` | Use logger, add watchConfig |
| `src/lib/systemd.ts` | Full rewrite |
| `src/lib/config.ts` | Export config path |
| `src/cli/logs.ts` | Read/tail log file |
| `src/cli/start.ts` | Use systemd, add watch |
| `src/cli/stop.ts` | Use systemd |
| `src/cli/restart.ts` | Use systemd |

---

## Testing Checklist

### Logger
- [ ] Logs written to file
- [ ] `lazydev logs` shows last N lines
- [ ] `lazydev logs -f` follows in real-time

### Hot Reload
- [ ] Add alias to config
- [ ] Visit new alias without restart
- [ ] Verify config change picked up

### Systemd
- [ ] `lazydev start` creates service (first time)
- [ ] `lazydev start` starts service (subsequent)
- [ ] `lazydev stop` stops service
- [ ] `lazydev restart` restarts service
- [ ] Service survives terminal close
- [ ] Service auto-starts on boot (if enabled)
- [ ] Fallback works without systemd
