import { readLogs, getLogFilePath, tailLogs } from "../lib/logger";

export async function run(_name?: string, follow: boolean = false, lines: number = 100) {
  const logFile = getLogFilePath();
  
  if (follow) {
    console.log(`Following logs from: ${logFile}`);
    console.log("Press Ctrl+C to exit\n");
    
    const logs = readLogs(lines);
    if (logs.length > 0) {
      console.log(logs);
    }
    
    const cleanup = tailLogs((line: string) => {
      console.log(line);
    });
    
    process.on("SIGINT", () => {
      console.log("\n\nStopped following logs.");
      cleanup();
      process.exit(0);
    });
    
    process.on("SIGTERM", () => {
      cleanup();
      process.exit(0);
    });
    
    await new Promise(() => {});
  } else {
    const logs = readLogs(lines);
    
    if (logs.length === 0) {
      console.log("No logs found.");
      console.log(`Log file: ${logFile}`);
      return;
    }
    
    console.log(logs);
  }
}
