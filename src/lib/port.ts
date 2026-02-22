import { $ } from "bun";
import type { Settings } from "./types";

const PORT_SCAN_CMD = `ss -tlnH 'sport >= :4000 and sport <= :4999' | awk '{print $4}' | cut -d: -f2`;

const usedPorts = new Set<number>();

export async function getUsedPorts(): Promise<Set<number>> {
  try {
    const result = await $`sh -c ${PORT_SCAN_CMD}`.quiet().text();
    const ports = result
      .split("\n")
      .map((p) => parseInt(p.trim()))
      .filter((p) => !isNaN(p));
    return new Set(ports);
  } catch {
    return new Set();
  }
}

export async function findAvailablePort(settings: Settings): Promise<number> {
  const [minPort, maxPort] = settings.port_range;
  const systemUsed = await getUsedPorts();
  
  for (let port = minPort; port <= maxPort; port++) {
    if (!systemUsed.has(port) && !usedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
  }
  
  throw new Error(`No available ports in range ${minPort}-${maxPort}`);
}

export function releasePort(port: number): void {
  usedPorts.delete(port);
}

export function markPortUsed(port: number): void {
  usedPorts.add(port);
}