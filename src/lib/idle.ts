import type { Settings, ProjectState, ProjectConfig } from "./types";
import { getAllStates, updateActivity, getProjectMetrics } from "./state";
import { stopProject } from "./process";

let intervalId: Timer | null = null;
let configGetter: (() => Record<string, ProjectConfig>) | null = null;

export function setConfigGetter(getter: () => Record<string, ProjectConfig>): void {
  configGetter = getter;
}

function calculateActivityScore(requestHistory: number[]): number {
  const now = Date.now();
  const windows = [
    { threshold: 30000, score: 1.0 },
    { threshold: 60000, score: 0.8 },
    { threshold: 120000, score: 0.6 },
    { threshold: 300000, score: 0.4 },
    { threshold: 600000, score: 0.2 },
  ];
  
  for (const window of windows) {
    const recentRequests = requestHistory.filter(t => now - t < window.threshold);
    if (recentRequests.length >= 3) {
      return window.score;
    }
  }
  
  return 0.0;
}

function calculateDynamicTimeout(
  state: ProjectState,
  settings: Settings
): number {
  if (!settings.dynamic_timeout) {
    return settings.idle_timeout;
  }
  
  const metrics = getProjectMetrics(state.name);
  
  const coldStartTime = metrics.cold_start_time ?? 5000;
  const coldStartFactor = coldStartTime / 5000;
  
  const wsMultiplier = state.websocket_connections > 0 ? 2.0 : 1.0;
  
  const activityScore = calculateActivityScore(metrics.request_history);
  const activityMultiplier = 0.5 + (activityScore * 0.5);
  
  const baseTimeout = 5 * 60 * 1000;
  const effectiveTimeout = baseTimeout 
    * coldStartFactor 
    * wsMultiplier 
    * activityMultiplier;
  
  return Math.max(settings.min_timeout, Math.min(settings.max_timeout, effectiveTimeout));
}

export function startIdleWatcher(settings: Settings): void {
  if (intervalId) {
    clearInterval(intervalId);
  }
  
  intervalId = setInterval(async () => {
    try {
      const states = getAllStates();
      const now = Date.now();
      const configs = configGetter?.() ?? {};
      
      for (const [name, state] of Object.entries(states)) {
        if (state.status !== "running") continue;
        
        const projectConfig = configs[name];
        if (projectConfig?.disabled) continue;
        
        if (state.websocket_connections > 0) {
          updateActivity(name);
          continue;
        }
        
        if (!state.last_activity) continue;
        
        if (projectConfig?.idle_timeout === 0) continue;
        
        const idleTime = now - state.last_activity;
        const timeout = projectConfig?.idle_timeout !== undefined 
          ? projectConfig.idle_timeout 
          : calculateDynamicTimeout(state, settings);
        
        if (idleTime >= timeout) {
          const metrics = getProjectMetrics(name);
          const coldStartSec = Math.round((metrics.cold_start_time ?? 0) / 1000);
          console.log(
            `[IdleWatcher] Stopping ${name} (idle ${Math.round(idleTime / 60000)}m, cold start: ${coldStartSec}s)`
          );
          await stopProject(name);
        }
      }
    } catch (err) {
      console.error("[IdleWatcher] Error:", err instanceof Error ? err.message : String(err));
    }
  }, settings.scan_interval);
}

export function stopIdleWatcher(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function getEffectiveTimeout(name: string, settings: Settings): number {
  const state = getAllStates()[name];
  if (!state) return settings.idle_timeout;
  
  const configs = configGetter?.() ?? {};
  const projectConfig = configs[name];
  
  return projectConfig?.idle_timeout ?? calculateDynamicTimeout(state, settings);
}
