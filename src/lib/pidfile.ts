import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname } from "path";

const PID_FILE = `${process.env["LAZYDEV_DATA_DIR"] || `${homedir()}/.local/share/lazydev`}/proxy.pid`;

/**
 * Process start time in clock ticks since boot (field 22 of /proc/<pid>/stat).
 * Together with the PID it identifies a process even after the PID is reused.
 */
function startTime(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
    // comm (field 2) may contain spaces and parens; fields resume after the last ')'
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return fields[19] ?? null;
  } catch {
    return null;
  }
}

export function writePidFile(): void {
  mkdirSync(dirname(PID_FILE), { recursive: true });
  writeFileSync(PID_FILE, `${process.pid} ${startTime(process.pid) ?? ""}`.trim());
}

export function removePidFile(): void {
  try {
    if (readPidFile()?.pid === process.pid) unlinkSync(PID_FILE);
  } catch {
    // Already gone
  }
}

function readPidFile(): { pid: number; start: string | undefined } | null {
  if (!existsSync(PID_FILE)) return null;
  const [pidText, start] = readFileSync(PID_FILE, "utf-8").trim().split(/\s+/);
  const pid = parseInt(pidText ?? "", 10);
  return Number.isInteger(pid) && pid > 0 ? { pid, start } : null;
}

/**
 * PID of a foreground proxy started with `lazydev run`, or null. A stale PID
 * file, or one pointing at a recycled PID, is removed.
 */
export function getForegroundPid(): number | null {
  const entry = readPidFile();
  if (entry === null) return null;
  const current = startTime(entry.pid);
  if (current !== null && current === entry.start) return entry.pid;
  try {
    unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
  return null;
}
