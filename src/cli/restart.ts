import { run as runStop } from "./stop";

export async function run() {
  console.log("Restarting LazyDev daemon...\n");
  await runStop();
  
  console.log("\nStarting...");
  const { run: runStart } = await import("./start");
  await runStart();
}
