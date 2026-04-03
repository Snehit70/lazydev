import { execSync } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const SERVICE_NAME = "lazydev";
const SERVICE_FILE_PATH = `/etc/systemd/system/${SERVICE_NAME}.service`;

function getServiceFile(): string {
  const bunPath = process.argv[0];
  const scriptPath = join(process.cwd(), "src/index.ts");
  const user = process.env["USER"] ?? "snehit";
  
  return `[Unit]
Description=LazyDev - Zero-config dev server proxy
After=network.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${homedir()}
ExecStart=${bunPath} ${scriptPath} run
Restart=always
RestartSec=5
Environment=HOME=${homedir()}

[Install]
WantedBy=default.target
`;
}

export function isSystemdAvailable(): boolean {
  try {
    execSync("systemctl is-system-running", { stdio: "ignore" });
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
    const output = execSync(`systemctl is-active ${SERVICE_NAME}`, { encoding: "utf-8" }).trim();
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
    // Check if service file exists
    if (!existsSync(SERVICE_FILE_PATH)) {
      const serviceContent = getServiceFile();
      writeFileSync(SERVICE_FILE_PATH, serviceContent, { mode: 0o644 });
      
      // Reload systemd
      execSync("systemctl daemon-reload", { stdio: "ignore" });
    }
    
    // Enable service
    execSync(`systemctl enable ${SERVICE_NAME}`, { stdio: "ignore" });
    
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
    await ensureService();
    
    // Start service
    execSync(`systemctl start ${SERVICE_NAME}`, { stdio: "ignore" });

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
    execSync(`systemctl stop ${SERVICE_NAME}`, { stdio: "ignore" });
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
    execSync(`systemctl restart ${SERVICE_NAME}`, { stdio: "ignore" });
    if (await waitForServiceState(true)) {
      return { success: true, message: "Service restarted" };
    }
    return { success: false, message: "Service failed to become active after restart" };
  } catch (err) {
    return { success: false, message: `Failed to restart service: ${err}` };
  }
}

export async function runService(): Promise<void> {
  // This is called when the service starts
  // It runs the actual proxy
  const { run } = await import("../cli/start");
  await run(true);
}
