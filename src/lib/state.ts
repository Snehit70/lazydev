import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { ProjectState, DaemonState, ProjectMetrics } from "./types";

const homeDir = homedir();
if (!homeDir) throw new Error("Cannot determine home directory");

const STATE_DIR = process.env["LAZYDEV_STATE_DIR"] ?? join(homeDir, ".local/share/lazydev");
const DB_PATH = join(STATE_DIR, "state.db");

let db: Database | null = null;

function getDb(): Database {
  if (!db) {
    mkdirSync(STATE_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.run(`
      CREATE TABLE IF NOT EXISTS projects (
        name TEXT PRIMARY KEY,
        port INTEGER,
        pid INTEGER,
        status TEXT,
        last_activity INTEGER,
        started_at INTEGER,
        websocket_connections INTEGER DEFAULT 0
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS metrics (
        name TEXT PRIMARY KEY,
        cold_start_time INTEGER,
        request_history TEXT
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        stream TEXT,
        timestamp INTEGER,
        message TEXT
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_logs_name ON logs(name)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp)`);
  }
  return db;
}

export function loadState(): DaemonState {
  const database = getDb();
  const rows = database.query("SELECT * FROM projects").all() as any[];
  
  const projects: Record<string, ProjectState> = {};
  for (const row of rows) {
    projects[row.name] = {
      name: row.name,
      port: row.port,
      pid: row.pid,
      status: row.status,
      last_activity: row.last_activity,
      started_at: row.started_at,
      websocket_connections: row.websocket_connections ?? 0,
    };
  }
  
  return {
    started_at: Date.now(),
    projects,
  };
}

export function getProjectState(name: string): ProjectState | null {
  const database = getDb();
  const row = database.query("SELECT * FROM projects WHERE name = ?").get(name) as any;
  
  if (!row) return null;
  
  return {
    name: row.name,
    port: row.port,
    pid: row.pid,
    status: row.status,
    last_activity: row.last_activity,
    started_at: row.started_at,
    websocket_connections: row.websocket_connections ?? 0,
  };
}

export function setProjectState(name: string, state: Partial<ProjectState>): void {
  const database = getDb();
  
  const existing = getProjectState(name);
  
  if (existing) {
    const updates = { ...existing, ...state };
    database.run(
      `UPDATE projects SET port=?, pid=?, status=?, last_activity=?, started_at=?, websocket_connections=? WHERE name=?`,
      [updates.port, updates.pid, updates.status, updates.last_activity, updates.started_at, updates.websocket_connections, name]
    );
  } else {
    database.run(
      `INSERT INTO projects (name, port, pid, status, last_activity, started_at, websocket_connections) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, state.port ?? null, state.pid ?? null, state.status ?? "stopped", state.last_activity ?? null, state.started_at ?? null, state.websocket_connections ?? 0]
    );
  }
}

export function updateActivity(name: string): void {
  const database = getDb();
  const now = Date.now();
  database.run(
    `UPDATE projects SET last_activity = ? WHERE name = ?`,
    [now, name]
  );
  
  addRequestToHistory(name, now);
}

export function incrementWebSockets(name: string): void {
  const database = getDb();
  database.run(
    `UPDATE projects SET websocket_connections = websocket_connections + 1, last_activity = ? WHERE name = ?`,
    [Date.now(), name]
  );
}

export function decrementWebSockets(name: string): void {
  const database = getDb();
  database.run(
    `UPDATE projects SET websocket_connections = MAX(0, websocket_connections - 1), last_activity = ? WHERE name = ?`,
    [Date.now(), name]
  );
}

export function deleteProjectState(name: string): void {
  const database = getDb();
  database.run("DELETE FROM projects WHERE name = ?", [name]);
  database.run("DELETE FROM metrics WHERE name = ?", [name]);
}

export function getAllStates(): Record<string, ProjectState> {
  const state = loadState();
  return state.projects;
}

// Metrics functions

export function getProjectMetrics(name: string): ProjectMetrics {
  const database = getDb();
  const row = database.query("SELECT * FROM metrics WHERE name = ?").get(name) as any;
  
  if (!row) {
    return {
      name,
      cold_start_time: null,
      request_history: [],
    };
  }
  
  return {
    name: row.name,
    cold_start_time: row.cold_start_time,
    request_history: row.request_history ? JSON.parse(row.request_history) : [],
  };
}

export function setColdStartTime(name: string, time: number): void {
  const database = getDb();
  const existing = database.query("SELECT * FROM metrics WHERE name = ?").get(name);
  
  if (existing) {
    database.run(
      `UPDATE metrics SET cold_start_time = ? WHERE name = ?`,
      [time, name]
    );
  } else {
    database.run(
      `INSERT INTO metrics (name, cold_start_time, request_history) VALUES (?, ?, ?)`,
      [name, time, "[]"]
    );
  }
}

export function addRequestToHistory(name: string, timestamp: number): void {
  const database = getDb();
  const metrics = getProjectMetrics(name);
  
  const history = [...metrics.request_history, timestamp].slice(-20);
  
  if (metrics.cold_start_time !== null) {
    database.run(
      `UPDATE metrics SET request_history = ? WHERE name = ?`,
      [JSON.stringify(history), name]
    );
  } else {
    database.run(
      `INSERT OR REPLACE INTO metrics (name, cold_start_time, request_history) VALUES (?, ?, ?)`,
      [name, metrics.cold_start_time, JSON.stringify(history)]
    );
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
