import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { expandTilde, getConfigPath, loadConfig, parseAliasTarget, parseConfig, resolveProjectsDirs, updateConfigFile, validateAliasTarget } from "../src/lib/config";
import { DEFAULT_SETTINGS } from "../src/lib/types";

describe("parseConfig", () => {
  test("empty config uses defaults", () => {
    expect(parseConfig("")).toEqual({ settings: { proxy_port: 80 }, aliases: {} });
    expect(parseConfig("settings:\n")).toEqual({ settings: { proxy_port: 80 }, aliases: {} });
  });

  test("reads settings and lowercases alias keys", () => {
    const config = parseConfig("settings:\n  proxy_port: 8080\n  projects_dir: ~/code\naliases:\n  FF: fleetflow\n");
    expect(config).toEqual({ settings: { proxy_port: 8080, projects_dir: "~/code" }, aliases: { ff: "fleetflow" } });
  });

  test("does not mutate the shared defaults", () => {
    parseConfig("settings:\n  proxy_port: 9999\n");
    expect(DEFAULT_SETTINGS.proxy_port).toBe(80);
    expect(parseConfig("").settings.proxy_port).toBe(80);
  });

  test("accepts a list of projects directories and port aliases", () => {
    const config = parseConfig("settings:\n  projects_dir: [~/projects, /srv/work]\naliases:\n  grafana: 3000\n  web: mono/apps/web\n");
    expect(config.settings.projects_dir).toEqual(["~/projects", "/srv/work"]);
    expect(config.aliases).toEqual({ grafana: 3000, web: "mono/apps/web" });
  });

  test("ignores the legacy projects section", () => {
    expect(parseConfig("projects:\n  app:\n    port: 3000\n").aliases).toEqual({});
  });

  test("rejects invalid values with a clear message", () => {
    expect(() => parseConfig("- a\n- b\n")).toThrow("top level");
    expect(() => parseConfig("settings: []\n")).toThrow('"settings" must be a mapping');
    expect(() => parseConfig("settings:\n  proxy_port: '80'\n")).toThrow("proxy_port");
    expect(() => parseConfig("settings:\n  proxy_port: 70000\n")).toThrow("proxy_port");
    expect(() => parseConfig("aliases:\n  ff: true\n")).toThrow("must map to a project path or a port");
    expect(() => parseConfig("aliases:\n  ff: 70000\n")).toThrow("port must be between");
    expect(() => parseConfig("aliases:\n  ff: 30.5\n")).toThrow("port must be between");
    expect(() => parseConfig("settings:\n  projects_dir: []\n")).toThrow("projects_dir");
    expect(() => parseConfig("settings:\n  projects_dir: [~/a, 3]\n")).toThrow("projects_dir");
    expect(() => parseConfig("aliases:\n  ff: ../etc\n")).toThrow("'..'");
    expect(() => parseConfig("aliases:\n  'bad alias': x\n")).toThrow("bad alias");
    expect(() => parseConfig("settings: [\n")).toThrow("Invalid YAML");
  });
});

describe("paths", () => {
  test("expandTilde only expands a leading ~/", () => {
    expect(expandTilde("~/x")).toBe(`${homedir()}/x`);
    expect(expandTilde("/a/~/b")).toBe("/a/~/b");
    expect(expandTilde("~user/x")).toBe("~user/x");
  });

  test("resolveProjectsDirs defaults to ~/projects, trims trailing slashes and dedupes", () => {
    expect(resolveProjectsDirs({ settings: { proxy_port: 80 }, aliases: {} })).toEqual([`${homedir()}/projects`]);
    expect(resolveProjectsDirs({ settings: { proxy_port: 80, projects_dir: "/srv/code/" }, aliases: {} })).toEqual(["/srv/code"]);
    expect(resolveProjectsDirs({ settings: { proxy_port: 80, projects_dir: ["~/projects", "/srv/code", `${homedir()}/projects/`] }, aliases: {} }))
      .toEqual([`${homedir()}/projects`, "/srv/code"]);
  });

  test("CLI alias targets: digits are ports, anything else a path", () => {
    expect(parseAliasTarget("3000")).toBe(3000);
    expect(parseAliasTarget("mono/apps/web/")).toBe("mono/apps/web");
    expect(validateAliasTarget(0)).toContain("port");
    expect(validateAliasTarget("/abs")).not.toBeNull();
  });
});

describe("updateConfigFile", () => {
  test("preserves comments and validates the result", () => {
    const path = getConfigPath();
    writeFileSync(path, "# my settings\nsettings:\n  proxy_port: 80 # clean URLs\n");

    updateConfigFile((doc) => doc.setIn(["aliases", "mp"], "myproject"));
    const text = readFileSync(path, "utf-8");
    expect(text).toContain("# my settings");
    expect(text).toContain("# clean URLs");
    expect(loadConfig().aliases).toEqual({ mp: "myproject" });

    expect(() => updateConfigFile((doc) => doc.setIn(["settings", "proxy_port"], "nope"))).toThrow("proxy_port");
    expect(loadConfig().settings.proxy_port).toBe(80);
  });
});
