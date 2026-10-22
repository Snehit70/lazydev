import { readdir, readFile, readlink } from "fs/promises";

// Discovers listening TCP sockets and the processes that own them by reading
// /proc directly: /proc/net/tcp{,6} maps socket inodes to ports, and
// /proc/<pid>/fd maps processes to socket inodes.

export interface Listener {
  pid: number;
  port: number;
  /** Address to connect to (IPv6 without brackets). */
  host: string;
  cwd: string;
}

/** Where to send proxied traffic. */
export type Target = Pick<Listener, "host" | "port">;

interface Socket {
  port: number;
  host: string;
}

const TCP_LISTEN = "0A";
const SNAPSHOT_TTL_MS = 1000;

function decodeIPv4(hex: string): string {
  // /proc/net/tcp stores IPv4 addresses as a little-endian 32-bit word.
  const bytes = [6, 4, 2, 0].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return bytes.join(".");
}

function decodeIPv6(hex: string): string {
  // Four 32-bit words, each little-endian.
  const groups: string[] = [];
  for (let word = 0; word < 4; word++) {
    const w = hex.slice(word * 8, word * 8 + 8);
    const bytes = [6, 4, 2, 0].map((i) => w.slice(i, i + 2)).join("");
    groups.push(parseInt(bytes.slice(0, 4), 16).toString(16));
    groups.push(parseInt(bytes.slice(4, 8), 16).toString(16));
  }
  const addr = groups.join(":");
  if (addr === "0:0:0:0:0:0:0:0") return "::";
  if (addr === "0:0:0:0:0:0:0:1") return "::1";
  const mapped = addr.match(/^0:0:0:0:0:ffff:([0-9a-f]+):([0-9a-f]+)$/);
  if (mapped?.[1] && mapped[2]) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return addr;
}

/** Turn a bind address into an address a local client can connect to. */
export function connectHost(bindAddress: string): string {
  if (bindAddress === "0.0.0.0") return "127.0.0.1";
  if (bindAddress === "::") return "::1";
  return bindAddress;
}

/** Parse /proc/net/tcp or /proc/net/tcp6 into listening sockets keyed by inode. */
export function parseProcNetTcp(content: string, ipv6: boolean): Map<string, Socket> {
  const sockets = new Map<string, Socket>();
  for (const line of content.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    const local = fields[1];
    const state = fields[3];
    const inode = fields[9];
    if (!local || state !== TCP_LISTEN || !inode || inode === "0") continue;

    const [addrHex, portHex] = local.split(":");
    if (!addrHex || !portHex) continue;

    const bind = ipv6 ? decodeIPv6(addrHex) : decodeIPv4(addrHex);
    sockets.set(inode, { port: parseInt(portHex, 16), host: connectHost(bind) });
  }
  return sockets;
}

async function readListeningSockets(): Promise<Map<string, Socket>> {
  const sockets = new Map<string, Socket>();
  for (const [file, ipv6] of [["/proc/net/tcp", false], ["/proc/net/tcp6", true]] as const) {
    try {
      for (const [inode, socket] of parseProcNetTcp(await readFile(file, "utf-8"), ipv6)) {
        sockets.set(inode, socket);
      }
    } catch {
      // IPv6 may be disabled
    }
  }
  return sockets;
}

function within(path: string, dirs: string[]): boolean {
  return dirs.some((dir) => path === dir || path.startsWith(dir + "/"));
}

/**
 * List listening TCP sockets owned by processes whose cwd is one of `roots` or
 * below it. Processes we cannot inspect (other users) are skipped.
 */
export async function scanListeners(roots: string[]): Promise<Listener[]> {
  const sockets = await readListeningSockets();
  if (sockets.size === 0) return [];

  const pids = (await readdir("/proc")).filter((entry) => /^\d+$/.test(entry));
  const listeners: Listener[] = [];
  const seen = new Set<string>();

  await Promise.all(pids.map(async (pidStr) => {
    const pid = Number(pidStr);
    if (pid === process.pid) return;

    let cwd: string;
    try {
      cwd = await readlink(`/proc/${pid}/cwd`);
    } catch {
      return;
    }
    if (!within(cwd, roots)) return;

    let fds: string[];
    try {
      fds = await readdir(`/proc/${pid}/fd`);
    } catch {
      return;
    }

    for (const fd of fds) {
      let target: string;
      try {
        target = await readlink(`/proc/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      const inode = target.match(/^socket:\[(\d+)\]$/)?.[1];
      const socket = inode ? sockets.get(inode) : undefined;
      if (!socket) continue;

      // Forked children share their parent's sockets; keep one entry each.
      const key = `${cwd}|${socket.host}|${socket.port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      listeners.push({ pid, cwd, ...socket });
    }
  }));

  return listeners;
}

/**
 * Pick the listener that serves `projectPath`. A process started in the project
 * root beats one started in a subdirectory; ties go to the lowest port, then IPv4.
 */
export function pickListener(listeners: Listener[], projectPath: string, excludePort?: number): Listener | null {
  const candidates = projectListeners(listeners, projectPath, excludePort);

  candidates.sort((a, b) => {
    const exactA = a.cwd === projectPath ? 0 : 1;
    const exactB = b.cwd === projectPath ? 0 : 1;
    if (exactA !== exactB) return exactA - exactB;
    if (a.port !== b.port) return a.port - b.port;
    return (a.host.includes(":") ? 1 : 0) - (b.host.includes(":") ? 1 : 0);
  });

  return candidates[0] ?? null;
}

/** Every candidate listener for `projectPath`, unsorted. */
export function projectListeners(listeners: Listener[], projectPath: string, excludePort?: number): Listener[] {
  return listeners.filter((l) =>
    l.port !== excludePort &&
    l.port >= 1024 &&
    within(l.cwd, [projectPath])
  );
}

/**
 * Find a socket listening on `port`, whoever owns it (Docker, another user,
 * a server outside the projects directory). Prefers IPv4 loopback.
 */
export async function findPortListener(port: number): Promise<Target | null> {
  const matches = [...(await readListeningSockets()).values()].filter((s) => s.port === port);
  const rank = (s: Socket) => (s.host === "127.0.0.1" ? 0 : s.host.includes(":") ? 2 : 1);
  return matches.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

let snapshot: { key: string; at: number; listeners: Listener[] } | null = null;
let inflight: { key: string; promise: Promise<Listener[]> } | null = null;

/** Cached, de-duplicated scan. Results are at most SNAPSHOT_TTL_MS old. */
export async function getListeners(roots: string[]): Promise<Listener[]> {
  const key = roots.join("\n");
  if (snapshot && snapshot.key === key && Date.now() - snapshot.at < SNAPSHOT_TTL_MS) {
    return snapshot.listeners;
  }
  if (inflight && inflight.key === key) {
    return inflight.promise;
  }

  const promise = scanListeners(roots).then((listeners) => {
    snapshot = { key, at: Date.now(), listeners };
    return listeners;
  }).finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  inflight = { key, promise };
  return promise;
}

export function invalidateListeners(): void {
  snapshot = null;
}

/** Format host:port for use in a URL. */
export function hostPort(listener: Target): string {
  return listener.host.includes(":") ? `[${listener.host}]:${listener.port}` : `${listener.host}:${listener.port}`;
}
