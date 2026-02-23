import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { $ } from "bun";

const HOME = homedir();
const SYSTEMD_DIR = join(HOME, ".config/systemd/user");
const SERVICE_PATH = join(SYSTEMD_DIR, "lazydev.service");

const SERVICE_TEMPLATE = `[Unit]
Description=LazyDev - Scale-to-zero dev server manager
After=network.target dnsmasq.service

[Service]
Type=simple
ExecStart=%BUN_PATH% run %LAZYDEV_PATH% start --foreground
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`;

function getBunPath(): string {
  return process.execPath || "/home/snehit/.bun/bin/bun";
}

function getLazydevPath(): string {
  // If lazydev is installed globally, use that
  // Otherwise use local dist
  const globalPath = join(HOME, ".local/bin/lazydev");
  if (existsSync(globalPath)) {
    return globalPath;
  }
  
  // Fallback to local dist (development)
  return join(HOME, "projects/lazydev/dist/index.js");
}

export function isServiceInstalled(): boolean {
  return existsSync(SERVICE_PATH);
}

export async function installService(): Promise<void> {
  if (!existsSync(SYSTEMD_DIR)) {
    mkdirSync(SYSTEMD_DIR, { recursive: true });
  }
  
  const serviceContent = SERVICE_TEMPLATE
    .replace("%BUN_PATH%", getBunPath())
    .replace("%LAZYDEV_PATH%", getLazydevPath());
  
  writeFileSync(SERVICE_PATH, serviceContent);
  
  // Reload systemd daemon
  await $`systemctl --user daemon-reload`.quiet();
}

export async function isServiceRunning(): Promise<boolean> {
  try {
    const result = await $`systemctl --user is-active lazydev`.quiet().text();
    return result.trim() === "active";
  } catch {
    return false;
  }
}

export async function startService(): Promise<{ success: boolean; message: string }> {
  try {
    if (!isServiceInstalled()) {
      await installService();
    }
    
    if (await isServiceRunning()) {
      return { success: true, message: "Service already running" };
    }
    
    await $`systemctl --user start lazydev`.quiet();
    await $`systemctl --user enable lazydev`.quiet();
    
    return { success: true, message: "Service started and enabled" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message };
  }
}

export async function stopService(): Promise<{ success: boolean; message: string }> {
  try {
    await $`systemctl --user stop lazydev`.quiet();
    return { success: true, message: "Service stopped" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message };
  }
}

export async function restartService(): Promise<{ success: boolean; message: string }> {
  try {
    if (!isServiceInstalled()) {
      await installService();
    }
    
    await $`systemctl --user restart lazydev`.quiet();
    await $`systemctl --user enable lazydev`.quiet();
    
    return { success: true, message: "Service restarted" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message };
  }
}

export async function getServiceStatus(): Promise<{ active: boolean; enabled: boolean }> {
  const active = await isServiceRunning();
  
  let enabled = false;
  try {
    const result = await $`systemctl --user is-enabled lazydev`.quiet().text();
    enabled = result.trim() === "enabled";
  } catch {
    enabled = false;
  }
  
  return { active, enabled };
}

export async function getServiceLogs(lines: number = 50): Promise<string> {
  try {
    const result = await $`journalctl --user -u lazydev -n ${String(lines)} --no-pager`.quiet().text();
    return result;
  } catch {
    return "No logs available";
  }
}

export async function followServiceLogs(): Promise<void> {
  await $`journalctl --user -u lazydev -f`;
}
