import { $ } from "bun";
import type { Settings } from "./types";
import { getAllStates } from "./state";

const usedPorts = new Set<number>();
let initialized = false;

export function initializePortsFromState(): void {
  if (initialized) return;
  
  const states = getAllStates();
  for (const state of Object.values(states)) {
    if (state.port !== null && state.status === "running") {
      usedPorts.add(state.port);
    }
  }
  initialized = true;
}

export function resetPortTracking(): void {
  usedPorts.clear();
  initialized = false;
}

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
  
  console.log(`[Port] Finding available port in ${minPort}-${maxPort} (system: ${systemUsed.size}, tracked: ${usedPorts.size})`);
  
  for (let port = minPort; port <= maxPort; port++) {
    if (!systemUsed.has(port) && !usedPorts.has(port)) {
      usedPorts.add(port);
      console.log(`[Port] Allocated: ${port}`);
      return port;
    }
  }
  
  console.log(`[Port] ERROR: No available ports in range ${minPort}-${maxPort}`);
  throw new Error(`No available ports in range ${minPort}-${maxPort}`);
}

export function releasePort(port: number): void {
  usedPorts.delete(port);
  console.log(`[Port] Released: ${port}`);
}

export function markPortUsed(port: number): void {
  usedPorts.add(port);
  console.log(`[Port] Marked as used: ${port}`);
}