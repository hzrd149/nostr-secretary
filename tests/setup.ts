import fs from "fs/promises";
import os from "os";
import path from "path";

/**
 * Global bun:test preload (wired via bunfig.toml's [test] preload).
 *
 * services/config.ts reads Bun.env.CONFIG at module import time and Bun
 * shares ONE module cache across every file in a `bun test` run. Whichever
 * test file's import graph reaches services/config.ts FIRST determines
 * which config file the whole process loads — including test files that
 * only *transitively* import it (e.g. tests/helpers/groups.test.ts pulls in
 * helpers/groups.ts -> services/nostr.ts -> services/config.ts, with no
 * config-related test of its own).
 *
 * Without this preload, that first import happens against the developer's
 * real config.json (CONFIG_PATH defaults to "config.json" in the cwd), so
 * any later test that mutates config$ (e.g. the round-trip assertion in
 * tests/services/config.test.ts) persists test data into the real project
 * file via the existing save-on-change subscription. A preload is the only
 * hook that is guaranteed to run before any test file's imports, so it is
 * the only place this can be fixed reliably (D-10 test-safety fix).
 */
const FIXTURE_PATH = path.join(
  import.meta.dir,
  "fixtures",
  "config-pre-modes.json",
);

const TEMP_CONFIG_PATH = path.join(
  os.tmpdir(),
  `nostr-secretary-test-config-${process.pid}-${Date.now()}.json`,
);

await fs.copyFile(FIXTURE_PATH, TEMP_CONFIG_PATH);

Bun.env.CONFIG = TEMP_CONFIG_PATH;
process.env.CONFIG = TEMP_CONFIG_PATH;

process.on("exit", () => {
  try {
    require("fs").unlinkSync(TEMP_CONFIG_PATH);
  } catch {
    // best-effort cleanup; os.tmpdir() is reclaimed by the OS regardless
  }
});
