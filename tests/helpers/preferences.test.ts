import { describe, test, expect } from "bun:test";
import { PrivateKeySigner } from "applesauce-signers";
import {
  unlockAppData,
  getAppDataContent,
} from "applesauce-common/helpers/app-data";
import { unixNow } from "applesauce-core/helpers";
import type { EventTemplate } from "applesauce-core/helpers/event";
import type { AppConfig } from "../../services/config";
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
      enabled: true,
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
        enabled: true,
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
        enabled: false,
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
        enabled: true,
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
    expect(merged.messages.enabled).toBe(incoming.messages.enabled);
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
      messages: { enabled: true, whitelists: [], blacklists: [] },
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
      messages: { enabled: true, whitelists: [], blacklists: [] },
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
    changed.messages.enabled = !changed.messages.enabled;

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
