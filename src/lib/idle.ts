import type { Settings } from "./types";
import { getAllStates, updateActivity } from "./state";
import { stopProject } from "./process";
import { getServer } from "./proxy";

let intervalId: Timer | null = null;

export function startIdleWatcher(settings: Settings): void {
  if (intervalId) {
    clearInterval(intervalId);
  }
  
  intervalId = setInterval(() => {
    const states = getAllStates();
    const now = Date.now();
    
    for (const [name, state] of Object.entries(states)) {
      if (state.status !== "running") continue;
      
      if (state.websocket_connections > 0) {
        updateActivity(name);
        continue;
      }
      
      if (!state.last_activity) continue;
      
      const idleTime = now - state.last_activity;
      const timeout = state.last_activity && settings.idle_timeout;
      
      if (idleTime >= settings.idle_timeout) {
        console.log(`[IdleWatcher] Stopping ${name} (idle for ${Math.round(idleTime / 1000)}s)`);
        stopProject(name);
      }
    }
  }, settings.scan_interval);
}

export function stopIdleWatcher(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}