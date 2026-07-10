import { describe, expect, test } from "bun:test";
import config$, { getConfig, migrateConfig } from "../../services/config";

// services/config.ts reads Bun.env.CONFIG at import time (top-level await
// fs.exists(CONFIG_PATH)), and Bun shares one module cache across every file
// in a `bun test` run. tests/setup.ts (wired via bunfig.toml's [test]
// preload) points Bun.env.CONFIG at a disposable temp copy of
// tests/fixtures/config-pre-modes.json BEFORE any test file's imports run,
// so this static import always resolves against that pre-modes fixture,
// never the real project config.json, regardless of which test file bun
// happens to load first (D-10 test-safety fix — see tests/setup.ts).

describe("services/config groups.modes", () => {
  // This assertion MUST run before any mutation assertions below: the module
  // singleton is imported once for the whole test process, so the post-load
  // backfill state can only be observed here, before config$.next() mutates it.
  test("backfills groups.modes to {} for a pre-Phase-1 config.json with no modes key (D-10/D-06)", () => {
    expect(getConfig().groups.modes).toEqual({});
  });

  test("preserves the fixture's existing groups fields when backfilling modes", () => {
    const { groups } = getConfig();
    expect(groups.enabled).toBe(true);
    expect(groups.whitelists).toEqual(["existing-whitelisted-pubkey"]);
    expect(groups.blacklists).toEqual(["existing-blacklisted-pubkey"]);
    expect(groups.groupLink).toBe("https://chachi.chat/{hostname}/{group}");
  });

  test("round-trips a per-group mode set via config$.next() (D-10)", () => {
    const key = "wss://groups.example.com'abc123";

    const current = getConfig();
    config$.next({
      ...current,
      groups: {
        ...current.groups,
        modes: { ...current.groups.modes, [key]: "muted" },
      },
    });

    expect(getConfig().groups.modes[key]).toBe("muted");
  });
});

// migrateConfig is a pure function -- these cases call it directly on plain
// legacy-shaped objects and never touch config$.next(), so they do not
// perturb the shared config singleton the describe block above depends on
// (D3-09).
describe("services/config migrateConfig", () => {
  test("legacy directMessageNotifications:true migrates to messages.enabled:true and messages.sendContent:false (D3-04)", () => {
    const migrated = migrateConfig({ directMessageNotifications: true });

    expect(migrated.messages.enabled).toBe(true);
    expect(migrated.messages.sendContent).toBe(false);
  });

  test("legacy directMessageNotifications:false also yields messages.sendContent:false (default is unconditional) (D3-04)", () => {
    const migrated = migrateConfig({ directMessageNotifications: false });

    expect(migrated.messages.enabled).toBe(false);
    expect(migrated.messages.sendContent).toBe(false);
  });

  test("backfills groups.modes to {} when groups has no modes key (D3-10/D-10 parity)", () => {
    const migrated = migrateConfig({
      groups: { enabled: true, whitelists: [], blacklists: [] },
    });

    expect(migrated.groups.modes).toEqual({});
  });
});
