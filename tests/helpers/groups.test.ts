import { describe, test, expect } from "bun:test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { npubEncode, nprofileEncode } from "nostr-tools/nip19";
import { encodeGroupPointer, type GroupPointer } from "applesauce-common/helpers";
import type { NostrEvent } from "nostr-tools";
import {
  type GroupNotificationMode,
  DEFAULT_GROUP_NOTIFICATION_MODE,
  messageMentionsPubkey,
  passesGroupModeGate,
  getGroupMode,
  summarizeGroupModes,
  isGroupNotificationMode,
} from "../../helpers/groups";

const group: GroupPointer = {
  id: "abc123",
  relay: "wss://groups.example.com",
};

const userSecretKey = generateSecretKey();
const userPubkey = getPublicKey(userSecretKey);

const otherSecretKey = generateSecretKey();
const otherPubkey = getPublicKey(otherSecretKey);

function makeMessage(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "id",
    pubkey: otherPubkey,
    created_at: 0,
    kind: 9,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  };
}

describe("DEFAULT_GROUP_NOTIFICATION_MODE", () => {
  test("is 'mentions' (D-06)", () => {
    expect(DEFAULT_GROUP_NOTIFICATION_MODE).toBe("mentions");
  });
});

describe("getGroupMode", () => {
  test("returns the stored mode for a known group (D-01)", () => {
    const modes: Record<string, GroupNotificationMode> = {
      [encodeGroupPointer(group)]: "all",
    };
    expect(getGroupMode(modes, group)).toBe("all");
  });

  test("returns DEFAULT_GROUP_NOTIFICATION_MODE for an unknown group (D-06)", () => {
    expect(getGroupMode({}, group)).toBe(DEFAULT_GROUP_NOTIFICATION_MODE);
  });
});

describe("passesGroupModeGate", () => {
  test("returns false for 'muted' (D-01)", () => {
    expect(passesGroupModeGate("muted", makeMessage(), userPubkey)).toBe(false);
  });

  test("returns true for 'all' (D-01)", () => {
    expect(passesGroupModeGate("all", makeMessage(), userPubkey)).toBe(true);
  });

  test("returns messageMentionsPubkey(...) for 'mentions' when the message mentions the user (D-01/D-02)", () => {
    const mentioning = makeMessage({ tags: [["p", userPubkey]] });
    expect(passesGroupModeGate("mentions", mentioning, userPubkey)).toBe(true);
  });

  test("returns messageMentionsPubkey(...) for 'mentions' when the message does not mention the user (D-01/D-02)", () => {
    const nonMentioning = makeMessage({ tags: [["p", otherPubkey]] });
    expect(passesGroupModeGate("mentions", nonMentioning, userPubkey)).toBe(false);
  });
});

describe("messageMentionsPubkey", () => {
  test("returns true on a p-tag match (D-02)", () => {
    const message = makeMessage({ tags: [["p", userPubkey]], content: "hey there" });
    expect(messageMentionsPubkey(message, userPubkey)).toBe(true);
  });

  test("returns true on a nostr:npub content mention with no p-tag (D-02)", () => {
    const message = makeMessage({
      tags: [],
      content: `hello nostr:${npubEncode(userPubkey)} how are you`,
    });
    expect(messageMentionsPubkey(message, userPubkey)).toBe(true);
  });

  test("returns true on a nostr:nprofile content mention (D-02)", () => {
    const message = makeMessage({
      tags: [],
      content: `hello nostr:${nprofileEncode({ pubkey: userPubkey, relays: [] })}`,
    });
    expect(messageMentionsPubkey(message, userPubkey)).toBe(true);
  });

  test("returns false when neither a p-tag nor a content mention matches (D-02)", () => {
    const message = makeMessage({
      tags: [["p", otherPubkey]],
      content: `hello nostr:${npubEncode(otherPubkey)}`,
    });
    expect(messageMentionsPubkey(message, userPubkey)).toBe(false);
  });
});

describe("summarizeGroupModes", () => {
  test("returns per-mode counts (D-05)", () => {
    const modes: Record<string, GroupNotificationMode> = {
      a: "all",
      b: "mentions",
      c: "muted",
      d: "muted",
    };
    expect(summarizeGroupModes(modes)).toEqual({ all: 1, mentions: 1, muted: 2 });
  });

  test("returns all-zero counts for an empty modes map", () => {
    expect(summarizeGroupModes({})).toEqual({ all: 0, mentions: 0, muted: 0 });
  });
});

describe("isGroupNotificationMode", () => {
  test("accepts each valid literal (ASVS V5)", () => {
    expect(isGroupNotificationMode("all")).toBe(true);
    expect(isGroupNotificationMode("mentions")).toBe(true);
    expect(isGroupNotificationMode("muted")).toBe(true);
  });

  test("rejects any other value (ASVS V5)", () => {
    expect(isGroupNotificationMode("evil")).toBe(false);
    expect(isGroupNotificationMode("")).toBe(false);
    expect(isGroupNotificationMode(42)).toBe(false);
    expect(isGroupNotificationMode(undefined)).toBe(false);
    expect(isGroupNotificationMode(null)).toBe(false);
  });
});
