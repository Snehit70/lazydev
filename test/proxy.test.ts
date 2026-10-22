import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Subprocess } from "bun";
import { setConfig, startProxy, stopProxy } from "../src/lib/proxy";
import type { Config } from "../src/lib/types";

interface UpstreamEcho {
  port: number;
  path: string;
  host: string;
  forwardedHost: string | null;
  forwardedProto: string | null;
  forwardedFor: string | null;
}

const FIXTURE = join(import.meta.dir, "fixtures", "upstream.ts");

let projectsDir: string;
let workDir: string;
let proxyUrl: string;
let proxyPort: number;
let demoPort: number;
const upstreams: Subprocess<"ignore", "pipe", "inherit">[] = [];

async function startUpstream(project: string, env: Record<string, string> = {}, root = projectsDir): Promise<{ proc: Subprocess<"ignore", "pipe", "inherit">; port: number }> {
  const proc = Bun.spawn(["bun", FIXTURE], {
    cwd: join(root, project),
    env: { ...process.env, ...env },
    stdout: "pipe",
  });
  upstreams.push(proc);
  const { value } = await proc.stdout.getReader().read();
  const port = Number(new TextDecoder().decode(value).match(/ready (\d+)/)?.[1]);
  if (!port) throw new Error("upstream did not start");
  return { proc, port };
}

async function stopUpstream(proc: Subprocess): Promise<void> {
  proc.kill();
  await proc.exited;
}

function get(host: string, path = "/", init: RequestInit = {}, base = proxyUrl): Promise<Response> {
  return fetch(base + path, { ...init, headers: { host, ...(init.headers as Record<string, string>) } });
}

function unusedPort(): number {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = probe.port!;
  probe.stop(true);
  return port;
}

function openSocket(host: string, protocols: string[], headers: Record<string, string> = {}): Promise<{ ws: WebSocket; first: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(proxyUrl.replace("http", "ws") + "/hmr?token=abc", { protocols, headers: { host, ...headers } } as unknown as string[]);
    ws.onmessage = (event) => resolve({ ws, first: String(event.data) });
    ws.onerror = () => reject(new Error("websocket error"));
    ws.onclose = (event) => reject(new Error(`closed ${event.code}`));
    setTimeout(() => reject(new Error("timeout")), 3000);
  });
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.onmessage = (event) => resolve(String(event.data));
  });
}

beforeAll(async () => {
  projectsDir = realpathSync(mkdtempSync(join(tmpdir(), "lazydev-proxy-")));
  workDir = realpathSync(mkdtempSync(join(tmpdir(), "lazydev-work-")));
  for (const dir of ["demo", "idle", "MixedCase", "v6only", "restarts"]) {
    mkdirSync(join(projectsDir, dir));
  }
  mkdirSync(join(workDir, "client"));
  mkdirSync(join(workDir, "demo"));
  writeFileSync(join(projectsDir, "idle", "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
  writeFileSync(join(projectsDir, "idle", "bun.lock"), "");

  demoPort = (await startUpstream("demo")).port;
  await startUpstream("MixedCase");
  await startUpstream("v6only", { HOST: "::1" });
  await startUpstream("client", {}, workDir);
  // Shadowed by projectsDir/demo, so it must never receive traffic.
  await startUpstream("demo", {}, workDir);

  const server = await startProxy({ settings: { proxy_port: 0, projects_dir: projectsDir }, aliases: {} });
  proxyPort = server.port!;
  proxyUrl = `http://127.0.0.1:${proxyPort}`;
  const config: Config = {
    settings: { proxy_port: 0, projects_dir: [projectsDir, workDir] },
    aliases: { d: "demo", pinned: demoPort, dead: unusedPort(), loop: proxyPort },
  };
  setConfig(config);
});

afterAll(async () => {
  stopProxy();
  await Promise.all(upstreams.map(stopUpstream));
});

describe("HTTP proxying", () => {
  test("forwards requests with forwarding headers on the request", async () => {
    const res = await get("demo.localhost", "/some/path?q=1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as UpstreamEcho;
    expect(body.path).toBe("/some/path?q=1");
    expect(body.host).toBe(`localhost:${body.port}`);
    expect(body.forwardedHost).toBe("demo.localhost");
    expect(body.forwardedProto).toBe("http");
    expect(body.forwardedFor).toBe("127.0.0.1");
    expect(res.headers.get("x-forwarded-host")).toBeNull();
  });

  test("passes gzip responses through without double decoding", async () => {
    const res = await get("demo.localhost", "/gzip", { headers: { "accept-encoding": "gzip" } });
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(await res.text()).toBe("compressed ".repeat(100));
  });

  test("rewrites redirects to the upstream origin", async () => {
    const res = await get("demo.localhost", "/redirect", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://demo.localhost/target?x=1");
  });

  test("keeps multiple Set-Cookie headers", async () => {
    const res = await get("demo.localhost", "/cookies");
    expect(res.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });

  test("streams request bodies", async () => {
    const res = await get("demo.localhost", "/body", { method: "POST", body: "payload" });
    expect(await res.text()).toBe("payload");
  });

  test("resolves aliases, nested subdomains and mixed-case directories", async () => {
    expect((await get("d.localhost")).status).toBe(200);
    expect((await get("api.demo.localhost")).status).toBe(200);
    expect((await get("mixedcase.localhost")).status).toBe(200);
  });

  test("reaches servers that only listen on IPv6", async () => {
    const res = await get("v6only.localhost");
    expect(res.status).toBe(200);
  });

  test("accepts clients connecting over IPv6", async () => {
    const res = await get("demo.localhost", "/", {}, `http://[::1]:${proxyPort}`);
    expect(res.status).toBe(200);
  });

  test("streams responses without buffering", async () => {
    const res = await get("demo.localhost", "/sse");
    const reader = res.body!.getReader();
    const first = await Promise.race([reader.read(), Bun.sleep(1500).then(() => null)]);
    expect(first && new TextDecoder().decode(first.value)).toBe("data: first\n\n");
    await reader.cancel();
  });
});

describe("multiple projects directories", () => {
  test("routes to projects in later directories", async () => {
    expect((await get("client.localhost")).status).toBe(200);
  });

  test("the first directory wins a name clash", async () => {
    const body = (await (await get("demo.localhost")).json()) as UpstreamEcho;
    expect(body.port).toBe(demoPort);
  });
});

describe("port aliases", () => {
  test("route straight to the port", async () => {
    const body = (await (await get("pinned.localhost")).json()) as UpstreamEcho;
    expect(body.port).toBe(demoPort);
  });

  test("503 when nothing listens on the port", async () => {
    const res = await get("dead.localhost");
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("nothing is listening there");
  });

  test("refuse to loop back into the proxy", async () => {
    expect((await get("loop.localhost")).status).toBe(508);
  });
});

describe("error pages", () => {
  test("404 for unknown projects, 503 when nothing is listening", async () => {
    const missing = await get("nope.localhost");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("Expected directory");

    const idle = await get("idle.localhost", "/", { headers: { accept: "text/html" } });
    expect(idle.status).toBe(503);
    expect(idle.headers.get("content-type")).toContain("text/html");
    expect(idle.headers.get("x-lazydev-error")).toBe("503");
  });

  test("the 503 page suggests the dev command and waits for the server", async () => {
    const html = await (await get("idle.localhost", "/", { headers: { accept: "text/html" } })).text();
    expect(html).toContain("bun run dev");
    expect(html).toContain("location.reload()");
  });

  test("proxied responses never carry the LazyDev error header", async () => {
    expect((await get("demo.localhost")).headers.get("x-lazydev-error")).toBeNull();
  });

  test("400 for hosts outside .localhost", async () => {
    expect((await get("example.com")).status).toBe(400);
    expect((await get("..localhost")).status).toBe(400);
  });

  test("bare localhost lists running projects", async () => {
    const text = await (await get("localhost")).text();
    expect(text).toContain("demo");
    expect(text).toContain("client");
    expect(text).not.toContain("idle");
  });

  test("the HTML dashboard shows aliases and whether they are up", async () => {
    const html = await (await get("localhost", "/", { headers: { accept: "text/html" } })).text();
    expect(html).toContain("pinned.localhost");
    expect(html).toContain(`port ${demoPort}`);
    expect(html).toMatch(/dead\.localhost<\/a> <span class="port">→ port \d+ \(not running\)/);
  });
});

describe("discovery freshness", () => {
  test("a server started after a 503 is reachable immediately", async () => {
    expect((await get("restarts.localhost")).status).toBe(503);
    const { proc } = await startUpstream("restarts");
    expect((await get("restarts.localhost")).status).toBe(200);
    await stopUpstream(proc);
  });

  test("a server restarted on a new port is picked up without waiting", async () => {
    const first = await startUpstream("restarts");
    expect(((await (await get("restarts.localhost")).json()) as UpstreamEcho).port).toBe(first.port);
    await stopUpstream(first.proc);

    const second = await startUpstream("restarts");
    const res = await get("restarts.localhost");
    expect(res.status).toBe(200);
    expect(((await res.json()) as UpstreamEcho).port).toBe(second.port);
    await stopUpstream(second.proc);
  });
});

describe("WebSocket proxying", () => {
  test("forwards the subprotocol and cookies, and relays messages both ways", async () => {
    const { ws, first } = await openSocket("demo.localhost", ["vite-hmr"], { cookie: "session=1" });
    expect(ws.protocol).toBe("vite-hmr");
    expect(first).toBe("hello cookie=session=1");

    ws.send("ping");
    expect(await nextMessage(ws)).toBe("echo:ping");
    ws.close();
  });

  test("returns an error when the upstream refuses the upgrade", async () => {
    await expect(openSocket("demo.localhost", [])).rejects.toThrow();
  });
});

describe("config reload", () => {
  test("setConfig swaps aliases at runtime", async () => {
    setConfig({ settings: { proxy_port: 0, projects_dir: projectsDir }, aliases: { other: "demo" } });
    expect((await get("other.localhost")).status).toBe(200);
    expect((await get("d.localhost")).status).toBe(404);
  });
});
