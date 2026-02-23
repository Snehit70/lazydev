import { loadConfig } from "../lib/config";
import { getProcessOutput } from "../lib/process";
import { getProjectState } from "../lib/state";

export async function run(name?: string, follow: boolean = false) {
  try {
    const config = loadConfig();
    
    if (name && !config.projects[name]) {
      console.error(`Project "${name}" not found.`);
      process.exit(1);
    }
    
    if (name) {
      await showProjectLogs(name, follow);
    } else {
      const projects = Object.keys(config.projects);
      if (projects.length === 0) {
        console.log("No projects configured.");
        return;
      }
      
      for (const project of projects) {
        const state = getProjectState(project);
        if (state?.status === "running") {
          console.log(`\n=== ${project} ===`);
          await showProjectLogs(project, false);
        }
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error:", message);
    process.exit(1);
  }
}

async function showProjectLogs(name: string, follow: boolean): Promise<void> {
  const state = getProjectState(name);
  
  if (state?.status !== "running") {
    console.log(`Project "${name}" is not running.`);
    return;
  }
  
  const output = getProcessOutput(name);
  if (!output) {
    console.log(`No process output available for "${name}".`);
    return;
  }
  
  if (follow) {
    console.log(`Following logs for ${name} (Ctrl+C to stop)...\n`);
    
    const stdoutReader = output.stdout.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const stderrReader = output.stderr.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    
    const readStream = async (reader: ReadableStreamDefaultReader<Uint8Array>, prefix: string) => {
      while (true) {
        try {
          const { done, value } = await reader.read();
          if (done) break;
          const text = new TextDecoder().decode(value);
          process.stdout.write(`[${prefix}] ${text}`);
        } catch {
          break;
        }
      }
    };
    
    await Promise.all([
      readStream(stdoutReader, "out"),
      readStream(stderrReader, "err"),
    ]);
  } else {
    const readAll = async (stream: ReadableStream, prefix: string) => {
      const reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      const chunks: string[] = [];
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(new TextDecoder().decode(value));
      }
      
      const text = chunks.join("");
      if (text) {
        const lines = text.split("\n").slice(-50);
        for (const line of lines) {
          if (line.trim()) {
            console.log(`[${prefix}] ${line}`);
          }
        }
      }
    };
    
    await Promise.all([
      readAll(output.stdout, "out"),
      readAll(output.stderr, "err"),
    ]);
  }
}
