import { describe, expect, test, beforeAll } from "bun:test";
import { mkdirSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { labelForPath, parseHost, resolveProjectDir, resolveRoute } from "../src/lib/routing";

describe("parseHost", () => {
  test("routes <name>.localhost to a project", () => {
    expect(parseHost("myapp.localhost")).toEqual({ kind: "project", name: "myapp" });
    expect(parseHost("MyApp.localhost:80")).toEqual({ kind: "project", name: "myapp" });
    expect(parseHost("myapp.localhost.")).toEqual({ kind: "project", name: "myapp" });
    expect(parseHost("my_app-2.localhost:8080")).toEqual({ kind: "project", name: "my_app-2" });
  });

  test("routes nested subdomains to the closest label", () => {
    expect(parseHost("api.myapp.localhost")).toEqual({ kind: "project", name: "myapp" });
  });

  test("bare localhost and loopback IPs show the dashboard", () => {
    expect(parseHost("localhost")).toEqual({ kind: "dashboard" });
    expect(parseHost("localhost:8080")).toEqual({ kind: "dashboard" });
    expect(parseHost("127.0.0.1")).toEqual({ kind: "dashboard" });
    expect(parseHost("[::1]:80")).toEqual({ kind: "dashboard" });
  });

  test("rejects other hosts and unsafe names", () => {
    expect(parseHost(null).kind).toBe("invalid");
    expect(parseHost("example.com").kind).toBe("invalid");
    expect(parseHost("..localhost").kind).toBe("invalid");
    expect(parseHost(".localhost").kind).toBe("invalid");
    expect(parseHost("-x.localhost").kind).toBe("invalid");
  });
});

describe("resolveProjectDir", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "lazydev-routing-"));
    mkdirSync(join(root, "plain"));
    mkdirSync(join(root, "MixedCase"));
    mkdirSync(join(root, "mono", "apps", "web"), { recursive: true });
  });

  test("finds exact and case-insensitive matches", () => {
    expect(resolveProjectDir(root, "plain")).toBe(join(root, "plain"));
    expect(resolveProjectDir(root, "mixedcase")).toBe(join(root, "MixedCase"));
  });

  test("supports nested alias targets", () => {
    expect(resolveProjectDir(root, "mono/apps/web")).toBe(join(root, "mono", "apps", "web"));
  });

  test("returns null for missing projects and paths outside the root", () => {
    expect(resolveProjectDir(root, "missing")).toBeNull();
    expect(resolveProjectDir(root, "..")).toBeNull();
    expect(resolveProjectDir(root, "../etc")).toBeNull();
    expect(resolveProjectDir(root, ".")).toBeNull();
  });

});

describe("resolveRoute", () => {
  let first: string;
  let second: string;

  beforeAll(() => {
    first = mkdtempSync(join(tmpdir(), "lazydev-routing-a-"));
    second = mkdtempSync(join(tmpdir(), "lazydev-routing-b-"));
    mkdirSync(join(first, "shared"));
    mkdirSync(join(second, "shared"));
    mkdirSync(join(second, "work-only"));
    mkdirSync(join(first, "mono", "apps", "web"), { recursive: true });
  });

  test("applies directory aliases", () => {
    expect(resolveRoute([first], { p: "shared" }, "p")).toEqual({ kind: "project", label: "p", target: "shared", path: join(first, "shared") });
    expect(resolveRoute([first], {}, "nope")).toEqual({ kind: "missing", label: "nope", target: "nope" });
  });

  test("port aliases route to the port", () => {
    expect(resolveRoute([first], { grafana: 3000 }, "grafana")).toEqual({ kind: "port", label: "grafana", port: 3000 });
  });

  test("searches projects directories in order", () => {
    const dirs = [first, second];
    expect(resolveRoute(dirs, {}, "shared")).toMatchObject({ kind: "project", path: join(first, "shared") });
    expect(resolveRoute(dirs, {}, "work-only")).toMatchObject({ kind: "project", path: join(second, "work-only") });
  });

  test("labelForPath maps a working directory to its hostname label", () => {
    const dirs = [first, second];
    expect(labelForPath(dirs, {}, join(first, "shared", "src"))).toBe("shared");
    expect(labelForPath(dirs, {}, join(second, "work-only"))).toBe("work-only");
    expect(labelForPath(dirs, { web: "mono/apps/web" }, join(first, "mono", "apps", "web", "src"))).toBe("web");
    expect(labelForPath(dirs, { web: "mono/apps/web" }, join(first, "mono"))).toBe("mono");
    expect(labelForPath(dirs, {}, first)).toBeNull();
    expect(labelForPath(dirs, {}, "/etc")).toBeNull();
  });
});
