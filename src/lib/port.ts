import { $ } from "bun";
import type { Settings } from "./types";

const usedPorts = new Set<number>();

export async function getUsedPorts(settings: Settings): Promise<Set<number>> {
  const [minPort, maxPort] = settings.port_range;
  const cmd = `ss -tlnH 'sport >= :${minPort} and sport <= :${maxPort}' | awk '{print $4}' | cut -d: -f2`;
  
  try {
    const result = await $`sh -c ${cmd}`.quiet().text();
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
  const systemUsed = await getUsedPorts(settings);
  
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