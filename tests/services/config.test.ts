import { describe, expect, test } from "bun:test";
import config$, {
  DEFAULT_MESSAGES_CONFIG,
  getConfig,
  migrateConfig,
} from "../../services/config";

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

  // tests/fixtures/config-pre-modes.json has messages.enabled:false with no
  // contacts/others keys -- this is the D5-06 MIGRATION path (distinct from
  // the new-install seed default), so both category flags migrate to false.
  test("migrates the pre-modes fixture's flat messages.enabled:false to contacts/others both false (D5-06)", () => {
    const { messages } = getConfig();
    expect(messages.contacts.enabled).toBe(false);
    expect(messages.others.enabled).toBe(false);
    expect(messages).not.toHaveProperty("enabled");
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
  test("legacy directMessageNotifications:true chains into messages.contacts/others.enabled:true and messages.sendContent:false (D3-04/D5-06)", () => {
    const migrated = migrateConfig({ directMessageNotifications: true });

    expect(migrated.messages.contacts.enabled).toBe(true);
    expect(migrated.messages.others.enabled).toBe(true);
    expect(migrated.messages.sendContent).toBe(false);
    expect(migrated.messages).not.toHaveProperty("enabled");
  });

  test("legacy directMessageNotifications:false also yields messages.sendContent:false (default is unconditional) (D3-04/D5-06)", () => {
    const migrated = migrateConfig({ directMessageNotifications: false });

    expect(migrated.messages.contacts.enabled).toBe(false);
    expect(migrated.messages.others.enabled).toBe(false);
    expect(migrated.messages.sendContent).toBe(false);
  });

  test("splits an existing flat messages.enabled:true into both category flags true, preserving sendContent/whitelists/blacklists (D5-06)", () => {
    const migrated = migrateConfig({
      messages: {
        enabled: true,
        sendContent: true,
        whitelists: ["a"],
        blacklists: ["b"],
      },
    });

    expect(migrated.messages.contacts.enabled).toBe(true);
    expect(migrated.messages.others.enabled).toBe(true);
    expect(migrated.messages.sendContent).toBe(true);
    expect(migrated.messages.whitelists).toEqual(["a"]);
    expect(migrated.messages.blacklists).toEqual(["b"]);
    expect(migrated.messages).not.toHaveProperty("enabled");
  });

  test("splits an existing flat messages.enabled:false into both category flags false (D5-06)", () => {
    const migrated = migrateConfig({
      messages: { enabled: false, sendContent: false, whitelists: [], blacklists: [] },
    });

    expect(migrated.messages.contacts.enabled).toBe(false);
    expect(migrated.messages.others.enabled).toBe(false);
  });

  test("is idempotent -- a config already on the contacts/others shape is left untouched and messages.enabled is not re-added", () => {
    const alreadySplit = {
      messages: {
        contacts: { enabled: true },
        others: { enabled: false },
        sendContent: false,
        whitelists: [],
        blacklists: [],
      },
    };

    const migrated = migrateConfig(alreadySplit);

    expect(migrated.messages.contacts.enabled).toBe(true);
    expect(migrated.messages.others.enabled).toBe(false);
    expect(migrated.messages).not.toHaveProperty("enabled");
  });

  test("backfills groups.modes to {} when groups has no modes key (D3-10/D-10 parity)", () => {
    const migrated = migrateConfig({
      groups: { enabled: true, whitelists: [], blacklists: [] },
    });

    expect(migrated.groups.modes).toEqual({});
  });

  test("normalizes a null top-level groups key to {modes:{}} instead of leaving it null (WR-03)", () => {
    const migrated = migrateConfig({ groups: null });

    expect(migrated.groups).toEqual({ modes: {} });
  });

  test("backfills groups to {modes:{}} when groups key is entirely absent (WR-03)", () => {
    const migrated = migrateConfig({});

    expect(migrated.groups).toEqual({ modes: {} });
  });

  // CR-01 regression coverage: three reproducible crash shapes from a
  // malformed/partial config.json, mirroring the WR-03 `groups: null` /
  // omitted-key defensive coverage above but for `messages`.
  test("normalizes a null top-level messages key to the full default shape instead of leaving it null (CR-01)", () => {
    const migrated = migrateConfig({ messages: null });

    expect(migrated.messages).toEqual(DEFAULT_MESSAGES_CONFIG);
    // Must not be the same object reference as the shared default (a later
    // config$.next() must not be able to mutate the shared constant).
    expect(migrated.messages).not.toBe(DEFAULT_MESSAGES_CONFIG);
  });

  test("normalizes a non-object top-level messages key (e.g. a stray string) the same way (CR-01)", () => {
    const migrated = migrateConfig({ messages: "not-an-object" });

    expect(migrated.messages).toEqual(DEFAULT_MESSAGES_CONFIG);
  });

  test("backfills missing whitelists/blacklists/sendContent on a legacy messages.enabled shape so shouldNotify's .length checks can't crash (CR-01)", () => {
    const migrated = migrateConfig({ messages: { enabled: true } });

    expect(migrated.messages.contacts.enabled).toBe(true);
    expect(migrated.messages.others.enabled).toBe(true);
    expect(migrated.messages.whitelists).toEqual([]);
    expect(migrated.messages.blacklists).toEqual([]);
    expect(migrated.messages.sendContent).toBe(false);
    expect(migrated.messages).not.toHaveProperty("enabled");
  });

  test("backfills only the missing category when a partial new-schema messages has just `contacts` present, without requiring both keys absent (CR-01)", () => {
    const migrated = migrateConfig({
      messages: { contacts: { enabled: true } },
    });

    // contacts is preserved exactly as provided
    expect(migrated.messages.contacts.enabled).toBe(true);
    // others is backfilled independently -- no legacy `enabled` flag is
    // present, so it falls back to the D5-05 default (false), not to
    // whatever `contacts` happened to be set to.
    expect(migrated.messages.others.enabled).toBe(false);
    expect(migrated.messages.whitelists).toEqual([]);
    expect(migrated.messages.blacklists).toEqual([]);
    expect(migrated.messages.sendContent).toBe(false);
  });

  test("backfills only the missing category when a partial new-schema messages has just `others` present (CR-01)", () => {
    const migrated = migrateConfig({
      messages: { others: { enabled: true } },
    });

    // others is preserved exactly as provided
    expect(migrated.messages.others.enabled).toBe(true);
    // contacts is backfilled independently -- no legacy `enabled` flag is
    // present, so it falls back to the D5-05 default (true), not false.
    expect(migrated.messages.contacts.enabled).toBe(true);
  });
});

describe("services/config DEFAULT_MESSAGES_CONFIG", () => {
  test("new-install default is contacts.enabled:true / others.enabled:false (D5-05, corrected -- NOT both ON)", () => {
    expect(DEFAULT_MESSAGES_CONFIG.contacts.enabled).toBe(true);
    expect(DEFAULT_MESSAGES_CONFIG.others.enabled).toBe(false);
    expect(DEFAULT_MESSAGES_CONFIG.sendContent).toBe(false);
    expect(DEFAULT_MESSAGES_CONFIG.whitelists).toEqual([]);
    expect(DEFAULT_MESSAGES_CONFIG.blacklists).toEqual([]);
  });
});
