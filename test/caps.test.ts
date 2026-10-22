import { describe, expect, test } from "bun:test";
import { capabilityAdvice, findHiddenServers, parseGetcap } from "../src/lib/caps";

describe("parseGetcap", () => {
  test("reads both output formats", () => {
    expect(parseGetcap("/usr/bin/bun cap_net_bind_service=ep\n")).toBe("cap_net_bind_service=ep");
    expect(parseGetcap("/usr/bin/bun = cap_net_bind_service+ep\n")).toBe("cap_net_bind_service+ep");
  });

  test("returns null without capabilities", () => {
    expect(parseGetcap("")).toBeNull();
  });
});

describe("capabilityAdvice", () => {
  const binaries = [{ path: "/home/u/.bun/bin/bun", caps: "cap_net_bind_service=ep" }];

  test("removes the capability and restarts", () => {
    const advice = capabilityAdvice(binaries, 47999).join("\n");
    expect(advice).toContain("sudo setcap -r /home/u/.bun/bin/bun");
    expect(advice).toContain("lazydev restart");
    expect(advice).not.toContain("sysctl");
  });

  test("sets the sysctl first when the proxy needs a low port", () => {
    const advice = capabilityAdvice(binaries, 1).join("\n");
    expect(advice.indexOf("sysctl")).toBeLessThan(advice.indexOf("setcap -r"));
  });
});

test("findHiddenServers returns sorted ports", async () => {
  const { ports, processes } = await findHiddenServers();
  expect(ports).toEqual([...ports].sort((a, b) => a - b));
  expect(processes.every((p) => p.pid > 0 && p.command.length > 0)).toBe(true);
});
