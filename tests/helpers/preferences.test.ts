import { describe, test, expect } from "bun:test";
import { PrivateKeySigner } from "applesauce-signers";
import {
  unlockAppData,
  getAppDataContent,
} from "applesauce-common/helpers/app-data";
import { unixNow } from "applesauce-core/helpers";
import type { EventTemplate } from "applesauce-core/helpers/event";
import { DEFAULT_RATE_LIMIT_CONFIG, type AppConfig } from "../../services/config";
import {
  PREFS_KIND,
  PREFS_NAMESPACE,
  PREFS_VERSION,
  type SyncedPrefs,
  serializePrefs,
  mergePrefs,
  sanitizeSyncedPrefs,
  isNewerPrefs,
  samePrefsPayload,
} from "../../helpers/preferences";
import {
  evaluate,
  createRateLimitState,
  MIN_WINDOW_SECONDS,
} from "../../services/rate-limit-accounting";

/** Builds a full AppConfig fixture with local-only secrets set, so tests can
 *  assert they survive (or never leak into) the synced subset. */
function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    pubkey: "fixture-pubkey",
    lookupRelays: ["wss://relay.example.com"],
    server: "https://ntfy.sh",
    topic: "fixture-secret-topic",
    email: "fixture@example.com",
    appLink: "nostr:{link}",
    signer: {
      fixture: "serialized-signer-blob",
    } as unknown as AppConfig["signer"],
    whitelists: ["global-white"],
    blacklists: ["global-black"],
    messages: {
      contacts: { enabled: true },
      others: { enabled: true },
      sendContent: true,
      whitelists: ["msg-white"],
      blacklists: ["msg-black"],
    },
    replies: {
      enabled: true,
      whitelists: ["reply-white"],
      blacklists: ["reply-black"],
    },
    zaps: {
      enabled: false,
      whitelists: ["zap-white"],
      blacklists: ["zap-black"],
    },
    groups: {
      enabled: true,
      whitelists: ["group-white"],
      blacklists: ["group-black"],
      groupLink: "https://chachi.chat/{hostname}/{group}",
      modes: { "group-a": "all", "group-b": "muted" },
    },
    rateLimit: {
      window: 60,
      global: 20,
      perType: { replies: 5, zaps: 5, messages: 5, groups: 5 },
      perGroup: 3,
      perDm: 5,
    },
    ...overrides,
  };
}

describe("serializePrefs", () => {
  test("returns exactly the D2-04 rules subset (D2-04/D2-06)", () => {
    const config = makeConfig();
    const payload = serializePrefs(config);

    expect(payload).toEqual({
      version: PREFS_VERSION,
      messages: {
        contacts: { enabled: true },
        others: { enabled: true },
        whitelists: ["msg-white"],
        blacklists: ["msg-black"],
      },
      replies: {
        enabled: true,
        whitelists: ["reply-white"],
        blacklists: ["reply-black"],
      },
      zaps: {
        enabled: false,
        whitelists: ["zap-white"],
        blacklists: ["zap-black"],
      },
      groups: {
        enabled: true,
        whitelists: ["group-white"],
        blacklists: ["group-black"],
        modes: { "group-a": "all", "group-b": "muted" },
      },
      whitelists: ["global-white"],
      blacklists: ["global-black"],
      appLink: "nostr:{link}",
      rateLimit: {
        window: 60,
        global: 20,
        perType: { replies: 5, zaps: 5, messages: 5, groups: 5 },
        perGroup: 3,
        perDm: 5,
      },
    });
  });

  test("never emits device-local secrets (D2-05/Pitfall 8)", () => {
    const config = makeConfig();
    const json = JSON.stringify(serializePrefs(config));

    for (const forbidden of [
      "sendContent",
      "groupLink",
      "signer",
      "server",
      "topic",
      "email",
      "lookupRelays",
      "pubkey",
    ]) {
      expect(json.includes(forbidden)).toBe(false);
    }
  });

  test("sets version === PREFS_VERSION (D2-06)", () => {
    expect(serializePrefs(makeConfig()).version).toBe(PREFS_VERSION);
  });
});

describe("mergePrefs", () => {
  test("preserves current's local-only fields and applies incoming's synced fields (D2-06)", () => {
    const current = makeConfig({
      pubkey: "current-pubkey",
      server: "current-server",
      topic: "current-topic",
      email: "current-email",
      lookupRelays: ["wss://current.example.com"],
      signer: {
        fixture: "current-signer-blob",
      } as unknown as AppConfig["signer"],
      messages: {
        contacts: { enabled: false },
        others: { enabled: false },
        sendContent: true,
        whitelists: ["current-msg-white"],
        blacklists: ["current-msg-black"],
      },
      groups: {
        enabled: false,
        whitelists: ["current-group-white"],
        blacklists: ["current-group-black"],
        groupLink: "https://current-link.example.com/{group}",
        modes: { "current-group": "muted" },
      },
    });

    const incomingConfig = makeConfig({
      whitelists: ["incoming-white"],
      blacklists: ["incoming-black"],
      appLink: "nostr:{incoming-link}",
      messages: {
        contacts: { enabled: true },
        others: { enabled: false },
        sendContent: false, // never read by serializePrefs, irrelevant to the incoming payload
        whitelists: ["incoming-msg-white"],
        blacklists: ["incoming-msg-black"],
      },
      groups: {
        enabled: true,
        whitelists: ["incoming-group-white"],
        blacklists: ["incoming-group-black"],
        groupLink: "irrelevant",
        modes: { "incoming-group": "all" },
      },
    });
    const incoming = serializePrefs(incomingConfig);

    const merged = mergePrefs(current, incoming);

    // Local-only fields survive untouched
    expect(merged.pubkey).toBe(current.pubkey);
    expect(merged.signer).toBe(current.signer);
    expect(merged.server).toBe(current.server);
    expect(merged.topic).toBe(current.topic);
    expect(merged.email).toBe(current.email);
    expect(merged.lookupRelays).toBe(current.lookupRelays);
    expect(merged.messages.sendContent).toBe(current.messages.sendContent);
    expect(merged.groups.groupLink).toBe(current.groups.groupLink);

    // Synced fields come from incoming
    expect(merged.messages.contacts.enabled).toBe(
      incoming.messages.contacts.enabled,
    );
    expect(merged.messages.others.enabled).toBe(
      incoming.messages.others.enabled,
    );
    expect(merged.messages.whitelists).toBe(incoming.messages.whitelists);
    expect(merged.messages.blacklists).toBe(incoming.messages.blacklists);
    expect(merged.replies).toEqual(incoming.replies);
    expect(merged.zaps).toEqual(incoming.zaps);
    expect(merged.groups.enabled).toBe(incoming.groups.enabled);
    expect(merged.groups.whitelists).toBe(incoming.groups.whitelists);
    expect(merged.groups.blacklists).toBe(incoming.groups.blacklists);
    expect(merged.groups.modes).toBe(incoming.groups.modes);
    expect(merged.whitelists).toBe(incoming.whitelists);
    expect(merged.blacklists).toBe(incoming.blacklists);
    expect(merged.appLink).toBe(incoming.appLink);
  });
});

describe("sanitizeSyncedPrefs", () => {
  test("rejects non-object values (ASVS V5)", () => {
    expect(sanitizeSyncedPrefs(null)).toBeNull();
    expect(sanitizeSyncedPrefs(42)).toBeNull();
    expect(sanitizeSyncedPrefs("x")).toBeNull();
    expect(sanitizeSyncedPrefs([])).toBeNull();
  });

  test("drops non-string entries from whitelists/blacklists (ASVS V5)", () => {
    const sanitized = sanitizeSyncedPrefs({
      whitelists: ["good", 42, null, "also-good", {}],
      blacklists: ["fine"],
      messages: { contacts: { enabled: true }, others: { enabled: true }, whitelists: [], blacklists: [] },
      replies: { enabled: true, whitelists: [], blacklists: [] },
      zaps: { enabled: true, whitelists: [], blacklists: [] },
      groups: { enabled: true, whitelists: [], blacklists: [], modes: {} },
    });

    expect(sanitized?.whitelists).toEqual(["good", "also-good"]);
    expect(sanitized?.blacklists).toEqual(["fine"]);
  });

  test("drops groups.modes entries whose value is not a GroupNotificationMode (ASVS V5)", () => {
    const sanitized = sanitizeSyncedPrefs({
      whitelists: [],
      blacklists: [],
      messages: { contacts: { enabled: true }, others: { enabled: true }, whitelists: [], blacklists: [] },
      replies: { enabled: true, whitelists: [], blacklists: [] },
      zaps: { enabled: true, whitelists: [], blacklists: [] },
      groups: {
        enabled: true,
        whitelists: [],
        blacklists: [],
        modes: {
          valid1: "all",
          valid2: "muted",
          invalid: "evil-mode",
          alsoInvalid: 42,
        },
      },
    });

    expect(sanitized?.groups.modes).toEqual({ valid1: "all", valid2: "muted" });
  });

  test("round-trips a valid full payload unchanged in meaning", () => {
    const payload = serializePrefs(makeConfig());
    const sanitized = sanitizeSyncedPrefs(payload);

    expect(sanitized).toEqual(payload);
  });

  test("sets version === PREFS_VERSION on a payload with no version field", () => {
    const sanitized = sanitizeSyncedPrefs({
      whitelists: [],
      blacklists: [],
      messages: { contacts: { enabled: true }, others: { enabled: true }, whitelists: [], blacklists: [] },
      replies: { enabled: true, whitelists: [], blacklists: [] },
      zaps: { enabled: true, whitelists: [], blacklists: [] },
      groups: { enabled: true, whitelists: [], blacklists: [], modes: {} },
    });

    expect(sanitized?.version).toBe(PREFS_VERSION);
    expect(PREFS_VERSION).toBe(4);
  });

  test("contacts/others round-trip: serialize -> sanitize reproduces both category flags independently (D5-10)", () => {
    const config = makeConfig({
      messages: {
        contacts: { enabled: true },
        others: { enabled: false },
        sendContent: true,
        whitelists: ["msg-white"],
        blacklists: ["msg-black"],
      },
    });
    const payload = serializePrefs(config);
    const sanitized = sanitizeSyncedPrefs(payload);

    expect(sanitized?.messages.contacts.enabled).toBe(true);
    expect(sanitized?.messages.others.enabled).toBe(false);
  });

  // Pitfall 5 / T-5-04: a pre-Phase-5 peer device only ever published a flat
  // `messages.enabled` boolean, with no `contacts`/`others` keys at all. This
  // MUST seed BOTH category flags from that legacy value, never silently
  // coerce them to false -- otherwise an already-upgraded device would see
  // DM notifications turn off entirely the moment it applies the old peer's
  // synced payload.
  test("old-schema payload (messages.enabled:true, no contacts/others keys) seeds BOTH category flags true, not false (Pitfall 5/T-5-04)", () => {
    const sanitized = sanitizeSyncedPrefs({
      whitelists: [],
      blacklists: [],
      messages: { enabled: true, whitelists: [], blacklists: [] },
      replies: { enabled: true, whitelists: [], blacklists: [] },
      zaps: { enabled: true, whitelists: [], blacklists: [] },
      groups: { enabled: true, whitelists: [], blacklists: [], modes: {} },
    });

    expect(sanitized?.messages.contacts.enabled).toBe(true);
    expect(sanitized?.messages.others.enabled).toBe(true);
  });

  test("old-schema payload (messages.enabled:false, no contacts/others keys) seeds BOTH category flags false (Pitfall 5)", () => {
    const sanitized = sanitizeSyncedPrefs({
      whitelists: [],
      blacklists: [],
      messages: { enabled: false, whitelists: [], blacklists: [] },
      replies: { enabled: true, whitelists: [], blacklists: [] },
      zaps: { enabled: true, whitelists: [], blacklists: [] },
      groups: { enabled: true, whitelists: [], blacklists: [], modes: {} },
    });

    expect(sanitized?.messages.contacts.enabled).toBe(false);
    expect(sanitized?.messages.others.enabled).toBe(false);
  });
});

describe("sanitizeSyncedPrefs rateLimit (D6-07 / RESEARCH Pitfall 6)", () => {
  test("coerces a present rateLimit's numeric fields via asNonNegativeInt (negative/NaN/non-number -> per-field local default, float floored, 0 preserved)", () => {
    const sanitized = sanitizeSyncedPrefs({
      whitelists: [],
      blacklists: [],
      messages: { contacts: { enabled: true }, others: { enabled: true }, whitelists: [], blacklists: [] },
      replies: { enabled: true, whitelists: [], blacklists: [] },
      zaps: { enabled: true, whitelists: [], blacklists: [] },
      groups: { enabled: true, whitelists: [], blacklists: [], modes: {} },
      rateLimit: {
        window: 3.9,
        global: -1,
        perType: { replies: 0, zaps: "x", messages: NaN, groups: 12 },
        perGroup: -1,
        perDm: "x",
      },
    });

    expect(sanitized?.rateLimit).toEqual({
      window: 3, // floored
      global: DEFAULT_RATE_LIMIT_CONFIG.global, // negative -> fallback
      perType: {
        replies: 0, // 0 is valid, preserved
        zaps: DEFAULT_RATE_LIMIT_CONFIG.perType.zaps, // non-numeric -> fallback
        messages: DEFAULT_RATE_LIMIT_CONFIG.perType.messages, // NaN -> fallback
        groups: 12,
      },
      perGroup: DEFAULT_RATE_LIMIT_CONFIG.perGroup, // negative -> fallback
      perDm: DEFAULT_RATE_LIMIT_CONFIG.perDm, // non-numeric -> fallback
    });
  });

  test("D7-05: coerces a malformed perGroup/perDm (negative/NaN/string) per-field, preserving an explicit 0", () => {
    const sanitized = sanitizeSyncedPrefs({
      whitelists: [],
      blacklists: [],
      messages: { contacts: { enabled: true }, others: { enabled: true }, whitelists: [], blacklists: [] },
      replies: { enabled: true, whitelists: [], blacklists: [] },
      zaps: { enabled: true, whitelists: [], blacklists: [] },
      groups: { enabled: true, whitelists: [], blacklists: [], modes: {} },
      rateLimit: {
        window: 60,
        global: 20,
        perType: { replies: 5, zaps: 5, messages: 5, groups: 5 },
        perGroup: NaN,
        perDm: 0,
      },
    });

    expect(sanitized?.rateLimit.perGroup).toBe(DEFAULT_RATE_LIMIT_CONFIG.perGroup);
    expect(sanitized?.rateLimit.perDm).toBe(0); // 0 is valid, preserved
  });

  // The CRITICAL Pitfall-6 regression: a pre-Phase-6 peer device's payload
  // has NO rateLimit key at all. This MUST fall back to this device's own
  // local DEFAULT_RATE_LIMIT_CONFIG -- NEVER to {global:0, window:0,
  // perType:{...0}} -- or a rolling multi-device upgrade would silently
  // disable rate limiting on an already-upgraded device (T-6-04).
  test("absent rateLimit key (pre-Phase-6 peer payload) falls back to local DEFAULT_RATE_LIMIT_CONFIG, NOT zeros/unlimited (Pitfall 6)", () => {
    const sanitized = sanitizeSyncedPrefs({
      whitelists: [],
      blacklists: [],
      messages: { contacts: { enabled: true }, others: { enabled: true }, whitelists: [], blacklists: [] },
      replies: { enabled: true, whitelists: [], blacklists: [] },
      zaps: { enabled: true, whitelists: [], blacklists: [] },
      groups: { enabled: true, whitelists: [], blacklists: [], modes: {} },
      // no rateLimit key at all
    });

    expect(sanitized?.rateLimit).toEqual(DEFAULT_RATE_LIMIT_CONFIG);
    expect(sanitized?.rateLimit.global).not.toBe(0);
    expect(sanitized?.rateLimit.window).not.toBe(0);
  });

  test("a null rateLimit value also falls back to local DEFAULT_RATE_LIMIT_CONFIG (Pitfall 6)", () => {
    const sanitized = sanitizeSyncedPrefs({
      whitelists: [],
      blacklists: [],
      messages: { contacts: { enabled: true }, others: { enabled: true }, whitelists: [], blacklists: [] },
      replies: { enabled: true, whitelists: [], blacklists: [] },
      zaps: { enabled: true, whitelists: [], blacklists: [] },
      groups: { enabled: true, whitelists: [], blacklists: [], modes: {} },
      rateLimit: null,
    });

    expect(sanitized?.rateLimit).toEqual(DEFAULT_RATE_LIMIT_CONFIG);
  });

  test("serialize -> sanitize -> merge round-trips rateLimit, including perGroup/perDm (D7-05)", () => {
    const config = makeConfig({
      rateLimit: {
        window: 30,
        global: 10,
        perType: { replies: 1, zaps: 2, messages: 3, groups: 4 },
        perGroup: 7,
        perDm: 9,
      },
    });
    const payload = serializePrefs(config);

    expect(payload.rateLimit.perGroup).toBe(7);
    expect(payload.rateLimit.perDm).toBe(9);

    const sanitized = sanitizeSyncedPrefs(payload);

    expect(sanitized?.rateLimit).toEqual(payload.rateLimit);

    const current = makeConfig();
    const merged = mergePrefs(current, sanitized!);
    expect(merged.rateLimit).toEqual(payload.rateLimit);
    expect(merged.rateLimit.perGroup).toBe(7);
    expect(merged.rateLimit.perDm).toBe(9);
  });

  // The CRITICAL Pitfall-6 regression for D7-05: a pre-Phase-7 peer device's
  // payload has a `rateLimit` object present (Phase 6 shipped it) but WITHOUT
  // `perGroup`/`perDm` keys at all -- this must fall back to this device's own
  // local defaults, NEVER to 0.
  test("a pre-Phase-7 peer's rateLimit (present, but no perGroup/perDm keys) falls back to LOCAL defaults, never 0 (Pitfall 6, D7-05)", () => {
    const sanitized = sanitizeSyncedPrefs({
      whitelists: [],
      blacklists: [],
      messages: { contacts: { enabled: true }, others: { enabled: true }, whitelists: [], blacklists: [] },
      replies: { enabled: true, whitelists: [], blacklists: [] },
      zaps: { enabled: true, whitelists: [], blacklists: [] },
      groups: { enabled: true, whitelists: [], blacklists: [], modes: {} },
      rateLimit: {
        window: 60,
        global: 20,
        perType: { replies: 5, zaps: 5, messages: 5, groups: 5 },
        // no perGroup/perDm keys at all -- pre-Phase-7 peer payload
      },
    });

    expect(sanitized?.rateLimit.perGroup).toBe(DEFAULT_RATE_LIMIT_CONFIG.perGroup);
    expect(sanitized?.rateLimit.perDm).toBe(DEFAULT_RATE_LIMIT_CONFIG.perDm);
    expect(sanitized?.rateLimit.perGroup).not.toBe(0);
    expect(sanitized?.rateLimit.perDm).not.toBe(0);
  });

  // CR-01 (iteration 2): a synced payload with `rateLimit.window: 0` is a
  // realistic adversarial/interop input -- another device or a third-party
  // app publishing a kind-30078 payload with a degenerate window. Unlike
  // global/perType (where 0 legitimately means "unlimited"), `window: 0`
  // must never reach this device's config unclamped, or the entire rate
  // limiter (D6-01..D6-10) is silently disabled the moment this payload is
  // applied via mergePrefs/updateConfig.
  test("CR-01 (iter 2): a synced payload with rateLimit.window:0 is clamped up to MIN_WINDOW_SECONDS, not applied as 0", () => {
    const sanitized = sanitizeSyncedPrefs({
      whitelists: [],
      blacklists: [],
      messages: { contacts: { enabled: true }, others: { enabled: true }, whitelists: [], blacklists: [] },
      replies: { enabled: true, whitelists: [], blacklists: [] },
      zaps: { enabled: true, whitelists: [], blacklists: [] },
      groups: { enabled: true, whitelists: [], blacklists: [], modes: {} },
      rateLimit: {
        window: 0,
        global: 1,
        perType: { replies: 1, zaps: 5, messages: 5, groups: 5 },
      },
    });

    expect(sanitized?.rateLimit.window).toBe(MIN_WINDOW_SECONDS);
    expect(sanitized?.rateLimit.window).not.toBe(0);
    // global/perType 0-as-unlimited semantics are untouched by this fix.
    expect(sanitized?.rateLimit.global).toBe(1);
  });

  test("CR-01 (iter 2): after mergePrefs applies a synced window:0 payload, evaluate() still rate-limits -- 1 of 10 delivered, not 10 of 10", () => {
    const sanitized = sanitizeSyncedPrefs({
      whitelists: [],
      blacklists: [],
      messages: { contacts: { enabled: true }, others: { enabled: true }, whitelists: [], blacklists: [] },
      replies: { enabled: true, whitelists: [], blacklists: [] },
      zaps: { enabled: true, whitelists: [], blacklists: [] },
      groups: { enabled: true, whitelists: [], blacklists: [], modes: {} },
      rateLimit: {
        window: 0,
        global: 1,
        perType: { replies: 1, zaps: 5, messages: 5, groups: 5 },
      },
    })!;

    const merged = mergePrefs(makeConfig(), sanitized);

    // Reproduces the review's exact repro: 10 sequential evaluate() calls
    // against the merged (post-sync) rateLimit. If window had reached
    // evaluate() as 0 (unclamped), rollIfExpired would reset state to
    // all-zero on every call and all 10 would deliver.
    // Steps of 0.1s so all 10 calls land within the same clamped 1s
    // (MIN_WINDOW_SECONDS) window -- proving real accumulation, not just
    // "didn't crash". (Stepping by a full 1s per call would itself hit the
    // `now - windowStart < windowSeconds` equality boundary every time at
    // windowSeconds===1, rolling on every call for an unrelated reason.)
    let state = createRateLimitState(1000);
    let delivered = 0;
    for (let i = 0; i < 10; i++) {
      const result = evaluate(state, "replies", 1000 + i * 0.1, merged.rateLimit);
      state = result.state;
      if (result.deliver) delivered++;
    }

    expect(delivered).toBe(1);
    expect(delivered).not.toBe(10);
  });
});

describe("isNewerPrefs", () => {
  test("returns false for equal created_at (D2-08)", () => {
    expect(isNewerPrefs(100, 100)).toBe(false);
  });

  test("returns false for an older candidate (D2-08)", () => {
    expect(isNewerPrefs(99, 100)).toBe(false);
  });

  test("returns true for a strictly newer candidate (D2-08)", () => {
    expect(isNewerPrefs(101, 100)).toBe(true);
  });
});

describe("samePrefsPayload", () => {
  test("returns true for a structurally-identical clone (D2-09)", () => {
    const payload = serializePrefs(makeConfig());
    const clone = structuredClone(payload);

    expect(samePrefsPayload(payload, clone)).toBe(true);
  });

  test("returns false when one field differs (D2-09)", () => {
    const payload = serializePrefs(makeConfig());
    const changed = structuredClone(payload);
    changed.messages.contacts.enabled = !changed.messages.contacts.enabled;

    expect(samePrefsPayload(payload, changed)).toBe(false);
  });

  test("loop-prevention precondition: re-serializing a merged config reproduces the inbound payload (D2-09)", () => {
    const current = makeConfig();
    const otherConfig = makeConfig({
      whitelists: ["other-white"],
      blacklists: ["other-black"],
      appLink: "nostr:{other-link}",
      groups: {
        enabled: false,
        whitelists: ["other-group-white"],
        blacklists: ["other-group-black"],
        groupLink: "irrelevant-to-sync",
        modes: { "other-group": "muted" },
      },
    });
    const inbound = serializePrefs(otherConfig);

    const merged = mergePrefs(current, inbound);
    const reSerialized = serializePrefs(merged);

    expect(samePrefsPayload(reSerialized, inbound)).toBe(true);
  });
});

describe("event round-trip (D2-01/D2-02/D2-03)", () => {
  test("a manually-built, self-encrypted kind-30078 event decrypts back to the original SyncedPrefs via applesauce's app-data helpers", async () => {
    const signer = new PrivateKeySigner();
    const ownPubkey = await signer.getPublicKey();

    const config = makeConfig();
    const payload = serializePrefs(config);
    const plaintext = JSON.stringify(payload);

    const ciphertext = await signer.nip44.encrypt(ownPubkey, plaintext);

    const template: EventTemplate = {
      kind: PREFS_KIND,
      created_at: unixNow(),
      tags: [["d", PREFS_NAMESPACE]],
      content: ciphertext,
    };

    const signed = await signer.signEvent(template);

    await unlockAppData(signed, signer);
    const decrypted = getAppDataContent<SyncedPrefs>(signed);

    expect(decrypted).toEqual(payload);
  });
});
