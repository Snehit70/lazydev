import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Keep tests away from the user's real config, log and PID file.
const dir = mkdtempSync(join(tmpdir(), "lazydev-test-"));
process.env["LAZYDEV_DATA_DIR"] = join(dir, "data");
process.env["LAZYDEV_CONFIG"] = join(dir, "config.yaml");
