import { expect, test } from "bun:test";
import { existsSync, writeFileSync } from "fs";
import { getForegroundPid, removePidFile, writePidFile } from "../src/lib/pidfile";

const PID_FILE = `${process.env["LAZYDEV_DATA_DIR"]}/proxy.pid`;

test("recognizes its own PID file and removes it on shutdown", () => {
  writePidFile();
  expect(getForegroundPid()).toBe(process.pid);
  removePidFile();
  expect(existsSync(PID_FILE)).toBe(false);
});

test("treats a reused PID as stale and removes the file", () => {
  writeFileSync(PID_FILE, `${process.pid} 1`);
  expect(getForegroundPid()).toBeNull();
  expect(existsSync(PID_FILE)).toBe(false);
});

test("treats a dead PID as stale", () => {
  writeFileSync(PID_FILE, "999999999 1");
  expect(getForegroundPid()).toBeNull();
});
