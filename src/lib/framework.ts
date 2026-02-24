import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface PackageJson {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	scripts?: Record<string, string>;
}

export type FrameworkType = "vite" | "nuxt" | "sveltekit" | "astro" | "next" | "angular" | "unknown";

export interface FrameworkInfo {
	type: FrameworkType;
	isViteBased: boolean;
	name: string;
}

const VITE_PLUGINS = [
	"vite",
	"@vitejs/plugin-vue",
	"@vitejs/plugin-react",
	"@vitejs/plugin-react-swc",
	"@vitejs/plugin-svelte",
	"@vitejs/plugin-solid",
	"@vitejs/plugin-preact",
];

function readPackageJson(cwd: string): PackageJson | null {
	const pkgPath = join(cwd, "package.json");
	if (!existsSync(pkgPath)) return null;
	
	try {
		return JSON.parse(readFileSync(pkgPath, "utf-8")) as PackageJson;
	} catch {
		return null;
	}
}

function hasViteConfig(cwd: string): boolean {
	const configs = [
		"vite.config.ts",
		"vite.config.js",
		"vite.config.mts",
		"vite.config.mjs",
	];
	return configs.some((f) => existsSync(join(cwd, f)));
}

function hasNuxtConfig(cwd: string): boolean {
	const configs = ["nuxt.config.ts", "nuxt.config.js"];
	return configs.some((f) => existsSync(join(cwd, f)));
}

function hasSvelteConfig(cwd: string): boolean {
	const configs = ["svelte.config.js", "svelte.config.ts"];
	return configs.some((f) => existsSync(join(cwd, f)));
}

function hasAstroConfig(cwd: string): boolean {
	const configs = ["astro.config.mjs", "astro.config.ts", "astro.config.js"];
	return configs.some((f) => existsSync(join(cwd, f)));
}

function hasNextConfig(cwd: string): boolean {
	const configs = [
		"next.config.js",
		"next.config.mjs",
		"next.config.ts",
	];
	return configs.some((f) => existsSync(join(cwd, f)));
}

function hasAngularConfig(cwd: string): boolean {
	return existsSync(join(cwd, "angular.json"));
}

function hasDependency(pkg: PackageJson | null, names: string[]): boolean {
	if (!pkg) return false;
	const deps: Record<string, string> = {};
	if (pkg.dependencies) Object.assign(deps, pkg.dependencies);
	if (pkg.devDependencies) Object.assign(deps, pkg.devDependencies);
	return names.some((name) => name in deps);
}

export function detectFramework(cwd: string): FrameworkInfo {
	const pkg = readPackageJson(cwd);
	
	// Check for Nuxt first (it uses Vite internally)
	if (hasNuxtConfig(cwd) || hasDependency(pkg, ["nuxt", "nuxt-edge", "nuxt3"])) {
		return {
			type: "nuxt",
			isViteBased: true,
			name: "Nuxt",
		};
	}
	
	// SvelteKit uses Vite
	if (hasSvelteConfig(cwd) && hasDependency(pkg, ["@sveltejs/kit"])) {
		return {
			type: "sveltekit",
			isViteBased: true,
			name: "SvelteKit",
		};
	}
	
	// Astro uses Vite
	if (hasAstroConfig(cwd) || hasDependency(pkg, ["astro"])) {
		return {
			type: "astro",
			isViteBased: true,
			name: "Astro",
		};
	}
	
	// Next.js (NOT Vite-based)
	if (hasNextConfig(cwd) || hasDependency(pkg, ["next"])) {
		return {
			type: "next",
			isViteBased: false,
			name: "Next.js",
		};
	}
	
	// Angular (NOT Vite-based)
	if (hasAngularConfig(cwd) || hasDependency(pkg, ["@angular/core"])) {
		return {
			type: "angular",
			isViteBased: false,
			name: "Angular",
		};
	}
	
	// Plain Vite project (check config file OR dependencies)
	if (hasViteConfig(cwd) || hasDependency(pkg, VITE_PLUGINS)) {
		return {
			type: "vite",
			isViteBased: true,
			name: "Vite",
		};
	}
	
	return {
		type: "unknown",
		isViteBased: false,
		name: "Unknown",
	};
}
