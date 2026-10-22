import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { suggestDevCommand } from "../src/lib/hints";

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "lazydev-hints-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts });

test("uses the package manager from the lockfile", () => {
  expect(suggestDevCommand(project({ "package.json": pkg({ dev: "vite" }), "bun.lock": "" }))).toBe("bun run dev");
  expect(suggestDevCommand(project({ "package.json": pkg({ dev: "vite" }), "pnpm-lock.yaml": "" }))).toBe("pnpm dev");
  expect(suggestDevCommand(project({ "package.json": pkg({ dev: "vite" }), "yarn.lock": "" }))).toBe("yarn dev");
  expect(suggestDevCommand(project({ "package.json": pkg({ dev: "vite" }) }))).toBe("npm run dev");
  expect(suggestDevCommand(project({ "package.json": pkg({ start: "node ." }) }))).toBe("npm start");
});

test("recognizes other ecosystems", () => {
  expect(suggestDevCommand(project({ "manage.py": "" }))).toBe("python manage.py runserver");
  expect(suggestDevCommand(project({ "bin/dev": "" }))).toBe("bin/dev");
  expect(suggestDevCommand(project({ "Cargo.toml": "" }))).toBe("cargo run");
  expect(suggestDevCommand(project({}))).toBe("<your dev command>");
});
