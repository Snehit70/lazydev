import { existsSync, mkdirSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";
import { $ } from "bun";

const HOME = homedir();
const SYSTEMD_DIR = join(HOME, ".config/systemd/user");
const SERVICE_PATH = join(SYSTEMD_DIR, "lazydev.service");

export function isSystemdAvailable(): boolean {
  return platform() === "linux" && existsSync("/run/systemd/system");
}

function escapeSystemdPercent(str: string): string {
  return str.replace(/%/g, "%%");
}

function getBunPath(): string {
  return process.execPath;
}

function getLazydevPath(): string {
  const globalBin = join(HOME, ".local/bin/lazydev");
  if (existsSync(globalBin)) {
    return globalBin;
  }
  
  const bunGlobalBin = join(HOME, ".bun/bin/lazydev");
  if (existsSync(bunGlobalBin)) {
    return bunGlobalBin;
  }
  
  const moduleDir = import.meta.dir;
  const distPath = join(moduleDir, "..", "..", "dist", "index.js");
  
  if (existsSync(distPath)) {
    return distPath;
  }
  
  const srcPath = join(moduleDir, "..", "..", "src", "index.ts");
  if (existsSync(srcPath)) {
    return srcPath;
  }
  
  throw new Error("Could not find lazydev installation path");
}

export function isServiceInstalled(): boolean {
  return existsSync(SERVICE_PATH);
}

export async function installService(): Promise<void> {
  if (!isSystemdAvailable()) {
    throw new Error("systemd is not available on this system");
  }
  
  if (!existsSync(SYSTEMD_DIR)) {
    mkdirSync(SYSTEMD_DIR, { recursive: true });
  }
  
  const lazydevPath = getLazydevPath();
  const lazydevExt = lazydevPath.endsWith(".js") || lazydevPath.endsWith(".ts");
  
  let execStart: string;
  if (lazydevExt) {
    const bunPath = escapeSystemdPercent(getBunPath());
    const escapedPath = escapeSystemdPercent(lazydevPath);
    execStart = `${bunPath} ${escapedPath} start --foreground`;
  } else {
    execStart = `${escapeSystemdPercent(lazydevPath)} start --foreground`;
  }
  
  const serviceContent = `[Unit]
Description=LazyDev - Scale-to-zero dev server manager
After=network.target dnsmasq.service

[Service]
Type=simple
ExecStart=${execStart}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`;
  
  await Bun.write(SERVICE_PATH, serviceContent);
  console.log(`Created systemd service file: ${SERVICE_PATH}`);
  
  await $`systemctl --user daemon-reload`.quiet();
}

export async function isServiceRunning(): Promise<boolean> {
  if (!isSystemdAvailable()) {
    return false;
  }
  
  try {
    const result = await $`systemctl --user is-active lazydev`.quiet().text();
    return result.trim() === "active";
  } catch {
    return false;
  }
}

export async function startService(): Promise<{ success: boolean; message: string }> {
  if (!isSystemdAvailable()) {
    return { success: false, message: "systemd is not available on this system" };
  }
  
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
  if (!isSystemdAvailable()) {
    return { success: false, message: "systemd is not available on this system" };
  }
  
  if (!isServiceInstalled()) {
    return { success: true, message: "Service is not installed" };
  }
  
  const errors: string[] = [];
  
  try {
    await $`systemctl --user stop lazydev`.quiet();
  } catch (err) {
    errors.push(`stop: ${err instanceof Error ? err.message : String(err)}`);
  }
  
  try {
    await $`systemctl --user disable lazydev`.quiet();
  } catch (err) {
    errors.push(`disable: ${err instanceof Error ? err.message : String(err)}`);
  }
  
  if (errors.length > 0) {
    return { success: false, message: errors.join("; ") };
  }
  
  return { success: true, message: "Service stopped and disabled" };
}

export async function restartService(): Promise<{ success: boolean; message: string }> {
  if (!isSystemdAvailable()) {
    return { success: false, message: "systemd is not available on this system" };
  }
  
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
  if (!isSystemdAvailable()) {
    return { active: false, enabled: false };
  }
  
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

export async function getServiceLogs(lines: number = 100): Promise<string> {
  if (!isSystemdAvailable()) {
    return "";
  }
  
  const safeLines = Math.max(1, Math.floor(lines) || 100);
  
  try {
    const result = await $`journalctl --user -u lazydev -n ${safeLines.toString()} --no-pager`.quiet().text();
    return result;
  } catch (err) {
    console.debug(`getServiceLogs failed: ${err instanceof Error ? err.message : String(err)}`);
    return "";
  }
}

export async function followServiceLogs(): Promise<void> {
  if (!isSystemdAvailable()) {
    throw new Error("systemd is not available on this system");
  }
  
  try {
    await $`journalctl --user -u lazydev -f`;
  } catch (err) {
    throw new Error(`Failed to follow lazydev service logs: ${err instanceof Error ? err.message : String(err)}`);
  }
}
