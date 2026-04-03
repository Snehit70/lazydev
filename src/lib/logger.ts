import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "fs";
import { homedir } from "os";
import { watch } from "fs";

const LOG_DIR = `${homedir()}/.local/share/lazydev`;
const LOG_FILE = `${LOG_DIR}/proxy.log`;
const LOG_MAX_BYTES = 5 * 1024 * 1024;

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

export function info(message: string): void {
  log("INFO", message);
}

export function warn(message: string): void {
  log("WARN", message);
}

export function error(message: string): void {
  log("ERROR", message);
}

export function debug(message: string): void {
  log("DEBUG", message);
}

function rotateLogIfTooLarge(): void {
  try {
    if (!existsSync(LOG_FILE)) return;
    const stat = statSync(LOG_FILE);
    if (stat.size > LOG_MAX_BYTES) {
      renameSync(LOG_FILE, `${LOG_FILE}.old`);
    }
  } catch {
    // Ignore rotation errors
  }
}

function log(level: string, message: string): void {
  ensureLogDir();
  rotateLogIfTooLarge();
  const timestamp = formatTimestamp();
  const logLine = `${timestamp} [${level}] ${message}`;
  
  try {
    appendFileSync(LOG_FILE, logLine + "\n");
  } catch (err) {
    console.error("Failed to write to log file:", err);
  }
  
  console.log(logLine);
}

export function getLogFilePath(): string {
  return LOG_FILE;
}

export function readLogs(lineCount: number = 100): string {
  try {
    if (!existsSync(LOG_FILE)) {
      return "";
    }
    
    const content = readFileSync(LOG_FILE, "utf-8");
    const lines = content.split("\n").filter(line => line.length > 0);
    const lastLines = lines.slice(-lineCount);
    return lastLines.join("\n");
  } catch (err) {
    return `Error reading logs: ${err}`;
  }
}

export function tailLogs(
  onLine: (line: string) => void
): () => void {
  ensureLogDir();
  if (!existsSync(LOG_FILE)) {
    try { appendFileSync(LOG_FILE, ""); } catch { /* ignore */ }
  }

  let position = 0;
  
  try {
    if (existsSync(LOG_FILE)) {
      const content = readFileSync(LOG_FILE, "utf-8");
      position = content.length;
    }
  } catch {
    // Start from beginning if can't read
  }
  
  const watcher = watch(LOG_FILE, (eventType) => {
    if (eventType === "change") {
      try {
        if (!existsSync(LOG_FILE)) return;
        
        const content = readFileSync(LOG_FILE, "utf-8");
        const newContent = content.slice(position);
        position = content.length;
        
        const newLines = newContent.split("\n").filter(line => line.length > 0);
        for (const line of newLines) {
          onLine(line);
        }
      } catch {
        // File might be locked or deleted, ignore
      }
    }
  });
  
  return () => {
    watcher.close();
  };
}

export function infoSync(message: string): void {
  const timestamp = formatTimestamp();
  const logLine = `${timestamp} [INFO] ${message}`;
  
  try {
    ensureLogDir();
    appendFileSync(LOG_FILE, logLine + "\n");
  } catch {
    // Ignore file errors in sync mode
  }
  
  console.log(logLine);
}
