import { readFileSync, realpathSync } from "fs";
import { readdir, readFile, readlink } from "fs/promises";
import { basename } from "path";

// A binary with file capabilities (setcap) makes every process exec'd from it
// non-dumpable, which makes /proc/<pid>/cwd and /proc/<pid>/fd unreadable to
// the same user. LazyDev can then no longer discover those dev servers.

export interface CapableBinary {
  path: string;
  caps: string;
}

/** Parse getcap output: "path cap_x=ep" (libcap >= 2.41) or "path = cap_x+ep" (older). */
export function parseGetcap(output: string): string | null {
  return output.trim().match(/\s(?:=\s+)?(cap_\S+)$/)?.[1] ?? null;
}

/** File capabilities on `path` (e.g. "cap_net_bind_service=ep"), or null. */
export function fileCapabilities(path: string): string | null {
  try {
    const result = Bun.spawnSync(["getcap", path], { stdout: "pipe", stderr: "ignore" });
    return parseGetcap(result.stdout.toString());
  } catch {
    return null; // getcap not installed
  }
}

/** The bun binaries a user is likely to run dev servers with, deduplicated. */
function bunBinaries(): string[] {
  const candidates = [Bun.which("bun"), basename(process.execPath) === "bun" ? process.execPath : null];
  const paths = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      paths.add(realpathSync(candidate));
    } catch {
      // dangling symlink
    }
  }
  return [...paths];
}

/** bun binaries carrying file capabilities. */
export function capableBunBinaries(): CapableBinary[] {
  return bunBinaries().flatMap((path) => {
    const caps = fileCapabilities(path);
    return caps ? [{ path, caps }] : [];
  });
}

/** Lowest port unprivileged processes may bind (net.ipv4.ip_unprivileged_port_start). */
export function unprivilegedPortStart(): number {
  try {
    return Number(readFileSync("/proc/sys/net/ipv4/ip_unprivileged_port_start", "utf-8").trim());
  } catch {
    return 1024;
  }
}

/** Explanation and fix for binaries that hide dev servers. */
export function capabilityAdvice(binaries: CapableBinary[], proxyPort: number): string[] {
  const lines = [
    ...binaries.map((b) => `${b.path} has file capabilities (${b.caps}).`),
    "Processes started from it hide their working directory and sockets, so LazyDev",
    "cannot see dev servers run with bun. Remove the capability:",
  ];
  if (proxyPort < unprivilegedPortStart()) {
    lines.push(
      `  # first let the proxy bind port ${proxyPort} without it`,
      `  echo 'net.ipv4.ip_unprivileged_port_start=${proxyPort}' | sudo tee /etc/sysctl.d/50-lazydev.conf`,
      "  sudo sysctl --system",
    );
  }
  lines.push(
    ...binaries.map((b) => `  sudo setcap -r ${b.path}`),
    "  lazydev restart",
    "Then restart your bun dev servers.",
  );
  return lines;
}

export interface HiddenProcess {
  pid: number;
  command: string;
}

export interface HiddenServers {
  /** Your processes whose cwd/sockets can't be read. */
  processes: HiddenProcess[];
  /** Your listening ports (>= 1024) that no readable process owns. */
  ports: number[];
}

function parseUid(status: string): number | null {
  const match = status.match(/^Uid:\s+(\d+)/m);
  return match?.[1] ? Number(match[1]) : null;
}

/**
 * Find listening ports owned by the current user that LazyDev can't attribute
 * to any process, along with the user's processes it can't inspect.
 */
export async function findHiddenServers(): Promise<HiddenServers> {
  const uid = process.getuid?.();
  if (uid === undefined) return { processes: [], ports: [] };

  const ownSockets = new Map<string, number>();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    for (const line of content.split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/);
      const port = parseInt(fields[1]?.split(":")[1] ?? "", 16);
      const inode = fields[9];
      if (fields[3] !== "0A" || Number(fields[7]) !== uid || !inode || inode === "0" || port < 1024) continue;
      ownSockets.set(inode, port);
    }
  }

  const claimed = new Set<string>();
  const processes: HiddenProcess[] = [];
  const pids = (await readdir("/proc")).filter((entry) => /^\d+$/.test(entry));

  await Promise.all(pids.map(async (pidStr) => {
    const pid = Number(pidStr);
    let fds: string[];
    try {
      fds = await readdir(`/proc/${pid}/fd`);
    } catch (err) {
      if ((err as { code?: string }).code !== "EACCES") return;
      try {
        if (parseUid(await readFile(`/proc/${pid}/status`, "utf-8")) !== uid) return;
        const command = (await readFile(`/proc/${pid}/cmdline`, "utf-8")).split("\0").filter(Boolean).join(" ");
        if (command) processes.push({ pid, command });
      } catch {
        // exited
      }
      return;
    }
    for (const fd of fds) {
      try {
        const inode = (await readlink(`/proc/${pid}/fd/${fd}`)).match(/^socket:\[(\d+)\]$/)?.[1];
        if (inode) claimed.add(inode);
      } catch {
        // fd closed
      }
    }
  }));

  const ports = [...new Set(
    [...ownSockets].filter(([inode]) => !claimed.has(inode)).map(([, port]) => port),
  )].sort((a, b) => a - b);
  processes.sort((a, b) => a.pid - b.pid);
  return { processes, ports };
}
