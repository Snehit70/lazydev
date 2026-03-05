import { readdirSync, statSync } from "fs";
import { loadConfig, expandTilde } from "../lib/config";
import { findPortForProject, getProjectsDir, setConfig } from "../lib/proxy";

interface ProjectStatus {
  name: string;
  path: string;
  port: number | null;
  running: boolean;
}

async function scanProjects(): Promise<ProjectStatus[]> {
  const projectsDir = getProjectsDir();
  const results: ProjectStatus[] = [];
  
  try {
    const entries = readdirSync(projectsDir);
    
    for (const entry of entries) {
      const fullPath = `${projectsDir}/${entry}`;
      
      try {
        const stat = statSync(fullPath);
        if (!stat.isDirectory()) continue;
        
        // Skip hidden directories
        if (entry.startsWith(".")) continue;
        
        const port = await findPortForProject(fullPath, true);
        
        results.push({
          name: entry,
          path: fullPath,
          port,
          running: port !== null,
        });
      } catch {
        // Skip inaccessible directories
      }
    }
  } catch (err) {
    console.error(`Cannot read projects directory: ${projectsDir}`);
  }
  
  return results;
}

export async function run(name?: string) {
  try {
    const config = loadConfig();
    setConfig(config);
    
    const projectsDir = config.settings.projects_dir 
      ? expandTilde(config.settings.projects_dir)
      : expandTilde("~/projects");
    
    if (name) {
      // Check specific project
      const projectPath = `${projectsDir}/${name}`;
      const port = await findPortForProject(projectPath);
      
      if (port) {
        console.log(`Project: ${name}`);
        console.log(`  Status: 🟢 running`);
        console.log(`  Port:   ${port}`);
        console.log(`  URL:    http://${name}.localhost`);
      } else {
        console.log(`Project: ${name}`);
        console.log(`  Status: 🔴 not running`);
        console.log(`  Path:   ${projectPath}`);
        console.log(`\nStart with: cd ${projectPath} && bun dev`);
      }
      return;
    }
    
    // Scan all projects
    const projects = await scanProjects();
    const running = projects.filter(p => p.running);
    const stopped = projects.filter(p => !p.running);
    
    console.log(`\nProjects dir: ${projectsDir}\n`);
    
    if (running.length > 0) {
      console.log("Running dev servers:");
      console.log("  Name              Port    URL");
      console.log("  ─────────────────────────────────────────────────");
      
      for (const p of running) {
        const url = `http://${p.name}.localhost`;
        console.log(`  ${p.name.padEnd(17)} ${String(p.port).padEnd(7)} ${url}`);
      }
      console.log("");
    }
    
    // Show aliases if any
    const aliases = config.aliases ?? {};
    if (Object.keys(aliases).length > 0) {
      console.log("Aliases:");
      for (const [alias, target] of Object.entries(aliases)) {
        console.log(`  ${alias} → ${target}`.padEnd(30) + `http://${alias}.localhost`);
      }
      console.log("");
    }
    
    if (stopped.length > 0 && stopped.length <= 10) {
      console.log("Not running:");
      for (const p of stopped.slice(0, 5)) {
        console.log(`  ${p.name}`);
      }
      if (stopped.length > 5) {
        console.log(`  ... and ${stopped.length - 5} more`);
      }
      console.log("");
    }
    
    if (running.length === 0) {
      console.log("No dev servers running.\n");
      console.log("Start one with:");
      console.log("  cd ~/projects/<name>");
      console.log("  bun dev\n");
    }
    
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error:", message);
    process.exit(1);
  }
}
