import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SERVICE_NAME = "lazydev";
const SERVICE_DIR = join(homedir(), ".config", "systemd", "user");
const SERVICE_FILE_PATH = join(SERVICE_DIR, `${SERVICE_NAME}.service`);

const __filename = fileURLToPath(import.meta.url);
const LAZYDEV_ROOT = dirname(dirname(dirname(__filename)));

function runSystemctl(command: string): string {
  return execSync(`systemctl --user ${command}`, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function getServiceFile(): string {
  const scriptPath = join(LAZYDEV_ROOT, "src", "index.ts");
  const home = homedir();
  const configOverride = process.env["LAZYDEV_CONFIG"];
  
  return `[Unit]
Description=LazyDev - Zero-config dev server proxy
After=network.target

[Service]
Type=simple
WorkingDirectory=${home}
ExecStart="${process.execPath}" "${scriptPath}" run
Restart=on-failure
RestartSec=2
Environment=HOME=${home}
${configOverride ? `Environment=LAZYDEV_CONFIG=${configOverride}\n` : ""}
[Install]
WantedBy=default.target
`;
}

export function isSystemdAvailable(): boolean {
  try {
    execSync("systemctl --user show-environment", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

export function getServiceStatus(): { active: boolean; canControl: boolean } {
  if (!isSystemdAvailable()) {
    return { active: false, canControl: false };
  }
  
  try {
    const output = runSystemctl(`is-active ${SERVICE_NAME}`);
    return { active: output === "active", canControl: true };
  } catch {
    return { active: false, canControl: true };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServiceState(active: boolean): Promise<boolean> {
  for (let i = 0; i < 10; i++) {
    if (getServiceStatus().active === active) {
      return true;
    }
    await sleep(200);
  }
  return getServiceStatus().active === active;
}

export async function ensureService(): Promise<{ success: boolean; message: string }> {
  if (!isSystemdAvailable()) {
    return { success: false, message: "systemd not available" };
  }
  
  try {
    const serviceContent = getServiceFile();

    if (!existsSync(SERVICE_DIR)) {
      mkdirSync(SERVICE_DIR, { recursive: true });
    }

    if (!existsSync(SERVICE_FILE_PATH)) {
      writeFileSync(SERVICE_FILE_PATH, serviceContent, { mode: 0o644 });
    } else {
      const currentContent = readFileSync(SERVICE_FILE_PATH, "utf-8");
      if (currentContent !== serviceContent) {
        writeFileSync(SERVICE_FILE_PATH, serviceContent, { mode: 0o644 });
      }
    }

    runSystemctl("daemon-reload");
    runSystemctl(`enable ${SERVICE_NAME}`);
    
    return { success: true, message: "Service created and enabled" };
  } catch (err) {
    return { success: false, message: `Failed to create service: ${err}` };
  }
}

export async function startService(): Promise<{ success: boolean; message: string }> {
  if (!isSystemdAvailable()) {
    return { success: false, message: "systemd not available" };
  }
  
  try {
    // Check if already running
    const status = getServiceStatus();
    if (status.active) {
      return { success: true, message: "Service already running" };
    }
    
    // Try to create service if not exists
    const ensured = await ensureService();
    if (!ensured.success) {
      return { success: false, message: ensured.message };
    }
    
    // Start service
    runSystemctl(`start ${SERVICE_NAME}`);

    if (await waitForServiceState(true)) {
      return { success: true, message: "Service started" };
    }

    return { success: false, message: "Service failed to become active" };
  } catch (err) {
    return { success: false, message: `Failed to start service: ${err}` };
  }
}

export async function stopService(): Promise<{ success: boolean; message: string }> {
  if (!isSystemdAvailable()) {
    return { success: false, message: "systemd not available" };
  }
  
  try {
    runSystemctl(`stop ${SERVICE_NAME}`);
    if (await waitForServiceState(false)) {
      return { success: true, message: "Service stopped" };
    }
    return { success: false, message: "Service failed to stop" };
  } catch {
    return { success: false, message: "Service not running" };
  }
}

export async function restartService(): Promise<{ success: boolean; message: string }> {
  if (!isSystemdAvailable()) {
    return { success: false, message: "systemd not available" };
  }
  
  try {
    // Pick up service file changes from an upgraded lazydev
    const ensured = await ensureService();
    if (!ensured.success) {
      return { success: false, message: ensured.message };
    }
    runSystemctl(`restart ${SERVICE_NAME}`);
    if (await waitForServiceState(true)) {
      return { success: true, message: "Service restarted" };
    }
    return { success: false, message: "Service failed to become active after restart" };
  } catch (err) {
    return { success: false, message: `Failed to restart service: ${err}` };
  }
}
