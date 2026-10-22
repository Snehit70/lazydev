import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { connectHost, findPortListener, hostPort, parseProcNetTcp, pickListener, projectListeners, scanListeners, type Listener } from "../src/lib/discovery";

const TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1111 1 0000000000000000 100 0 0 10 0
   1: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 2222 1 0000000000000000 100 0 0 10 0
   2: 0100007F:1435 0100007F:D2F0 01 00000000:00000000 00:00000000 00000000  1000        0 3333 1 0000000000000000 20 4 30 10 -1
`;

const TCP6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000001000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 4444 1 0000000000000000 100 0 0 10 0
   1: 00000000000000000000000000000000:1F91 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 5555 1 0000000000000000 100 0 0 10 0
   2: 0000000000000000FFFF00000100007F:1F92 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 6666 1 0000000000000000 100 0 0 10 0
`;

describe("parseProcNetTcp", () => {
  test("parses IPv4 listeners and skips other states", () => {
    const sockets = parseProcNetTcp(TCP, false);
    expect([...sockets]).toEqual([
      ["1111", { port: 5173, host: "127.0.0.1" }],
      ["2222", { port: 3000, host: "127.0.0.1" }],
    ]);
  });

  test("parses IPv6 listeners", () => {
    const sockets = parseProcNetTcp(TCP6, true);
    expect(sockets.get("4444")).toEqual({ port: 8080, host: "::1" });
    expect(sockets.get("5555")).toEqual({ port: 8081, host: "::1" });
    expect(sockets.get("6666")).toEqual({ port: 8082, host: "127.0.0.1" });
  });

  test("connectHost maps wildcard binds to loopback", () => {
    expect(connectHost("0.0.0.0")).toBe("127.0.0.1");
    expect(connectHost("::")).toBe("::1");
    expect(connectHost("192.168.1.5")).toBe("192.168.1.5");
  });

  test("hostPort brackets IPv6", () => {
    expect(hostPort({ host: "::1", port: 80 })).toBe("[::1]:80");
    expect(hostPort({ host: "127.0.0.1", port: 80 })).toBe("127.0.0.1:80");
  });
});

describe("pickListener", () => {
  const l = (cwd: string, port: number, host = "127.0.0.1"): Listener => ({ pid: port, cwd, port, host });

  test("prefers the project root over subdirectories, then lower ports", () => {
    const listeners = [l("/p/app/packages/docs", 3001), l("/p/app", 5174), l("/p/app", 5173), l("/p/other", 1025)];
    expect(pickListener(listeners, "/p/app")?.port).toBe(5173);
  });

  test("falls back to subdirectories and ignores sibling prefixes", () => {
    expect(pickListener([l("/p/app/web", 3000), l("/p/app2", 4000)], "/p/app")?.port).toBe(3000);
    expect(pickListener([l("/p/app2", 4000)], "/p/app")).toBeNull();
  });

  test("excludes privileged ports and the proxy's own port", () => {
    expect(pickListener([l("/p/app", 80), l("/p/app", 8080)], "/p/app", 8080)).toBeNull();
  });

  test("prefers IPv4 when a port is bound on both families", () => {
    expect(pickListener([l("/p/app", 3000, "::1"), l("/p/app", 3000)], "/p/app")?.host).toBe("127.0.0.1");
  });

  test("projectListeners lists every port in the project", () => {
    const ports = projectListeners([l("/p/app", 3000), l("/p/app/web", 24678), l("/p/other", 4000)], "/p/app").map((x) => x.port);
    expect(ports).toEqual([3000, 24678]);
  });
});

describe("scanListeners", () => {
  test("finds a server by its process cwd", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "lazydev-scan-")));
    const proc = Bun.spawn(["bun", join(import.meta.dir, "fixtures", "upstream.ts")], { cwd: dir, stdout: "pipe" });
    try {
      const reader = proc.stdout.getReader();
      const { value } = await reader.read();
      const port = Number(new TextDecoder().decode(value).match(/ready (\d+)/)?.[1]);

      const listeners = await scanListeners(["/nonexistent", dir]);
      expect(listeners).toContainEqual({ pid: proc.pid, cwd: dir, port, host: "127.0.0.1" });
      expect(await findPortListener(port)).toEqual({ port, host: "127.0.0.1" });
      expect(await scanListeners(["/nonexistent"])).toEqual([]);
    } finally {
      proc.kill();
      await proc.exited;
    }
  });
});
