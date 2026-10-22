import { isMap } from "yaml";
import { loadConfig, updateConfigFile } from "../lib/config";

export async function run(alias?: string) {
  if (!alias) {
    console.error("Usage: lazydev unalias <alias>");
    process.exit(1);
  }

  const aliasName = alias.toLowerCase();
  if (!(aliasName in loadConfig().aliases)) {
    console.error(`Alias "${aliasName}" not found.`);
    process.exit(1);
  }

  updateConfigFile((doc) => {
    const aliases = doc.get("aliases");
    if (!isMap(aliases)) return;
    // Keys may have been written with different casing.
    for (const item of [...aliases.items]) {
      if (String((item.key as { value?: unknown })?.value ?? item.key).toLowerCase() === aliasName) {
        aliases.delete(item.key);
      }
    }
    if (aliases.items.length === 0) {
      doc.delete("aliases");
    }
  });

  console.log(`✓ Removed alias: ${aliasName}`);
}
