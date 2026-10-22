import { existsSync, readFileSync } from "fs";
import { join } from "path";

function packageManager(dir: string): "bun" | "pnpm" | "yarn" | "npm" {
  if (existsSync(join(dir, "bun.lock")) || existsSync(join(dir, "bun.lockb"))) return "bun";
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  return "npm";
}

function packageScripts(dir: string): Record<string, unknown> | null {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as { scripts?: unknown };
    return typeof pkg.scripts === "object" && pkg.scripts !== null ? (pkg.scripts as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

/** Best guess at the command that starts the dev server in `dir`. */
export function suggestDevCommand(dir: string): string {
  const scripts = packageScripts(dir);
  if (scripts) {
    const pm = packageManager(dir);
    const script = ["dev", "start", "serve"].find((name) => typeof scripts[name] === "string");
    if (script) {
      if (pm === "npm") return script === "start" ? "npm start" : `npm run ${script}`;
      return pm === "bun" ? `bun run ${script}` : `${pm} ${script}`;
    }
  }

  if (existsSync(join(dir, "bin", "dev"))) return "bin/dev";
  if (existsSync(join(dir, "bin", "rails"))) return "bin/rails server";
  if (existsSync(join(dir, "manage.py"))) return "python manage.py runserver";
  if (existsSync(join(dir, "artisan"))) return "php artisan serve";
  if (existsSync(join(dir, "mix.exs"))) return "mix phx.server";
  if (existsSync(join(dir, "Cargo.toml"))) return "cargo run";
  if (existsSync(join(dir, "go.mod"))) return "go run .";
  return scripts ? `${packageManager(dir)} run dev` : "<your dev command>";
}
