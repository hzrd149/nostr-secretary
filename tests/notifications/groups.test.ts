import { describe, test, expect } from "bun:test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";
import {
  passesGroupModeGate,
  type GroupNotificationMode,
} from "../../helpers/groups";

// NOTE: This file intentionally does NOT import notifications/groups.ts.
// That module self-subscribes to RelayPool/EventStore at import time
// (see .planning/codebase/TESTING.md), so it is not safely importable in
// a unit test without mocking services/nostr.ts. Instead, this local
// `decide` helper documents the exact D-09 layering implemented in
// notifications/groups.ts's `.subscribe()` callback: master switch ->
// mode gate (real passesGroupModeGate) -> sender gate -> notify.
//
// TODO(WR-04, tracked follow-up): this only covers `passesGroupModeGate` in
// isolation -- it has zero coverage of the actual wiring in
// notifications/groups.ts, so a future change that reorders the mode gate
// vs. the shouldNotify sender check, drops the `!pubkey` guard, or changes
// how `groups.modes` is read would keep this suite green while regressing
// production behavior. Fix: export the `.subscribe()` callback in
// notifications/groups.ts as a named, independently-callable function
// taking `{ group, metadata, message }` plus injected
// `getConfig`/`shouldNotify`/`sendNotification`, so the real code path can
// be unit tested here instead of only this parallel mirror of it.

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

/** Mirrors the production callback's order in notifications/groups.ts:
 *  master switch -> passesGroupModeGate(real) -> sender gate -> notify. */
function decide(
  enabled: boolean,
  mode: GroupNotificationMode,
  message: NostrEvent,
  user: string,
  senderAllowed: boolean,
): boolean {
  if (!enabled) return false;
  if (!passesGroupModeGate(mode, message, user)) return false;
  if (!senderAllowed) return false;
  return true;
}

describe("D-09 group notification decision truth table", () => {
  test("enabled=false, any mode => no notify (D-08)", () => {
    expect(decide(false, "all", makeMessage(), userPubkey, true)).toBe(false);
    expect(decide(false, "mentions", makeMessage(), userPubkey, true)).toBe(
      false,
    );
    expect(decide(false, "muted", makeMessage(), userPubkey, true)).toBe(
      false,
    );
  });

  test("enabled=true, mode=muted => no notify (D-01)", () => {
    expect(decide(true, "muted", makeMessage(), userPubkey, true)).toBe(
      false,
    );
  });

  test("enabled=true, mode=mentions, message does not mention user => no notify (D-02)", () => {
    const nonMentioning = makeMessage({ tags: [["p", otherPubkey]] });
    expect(
      decide(true, "mentions", nonMentioning, userPubkey, true),
    ).toBe(false);
  });

  test("enabled=true, mode=mentions, mentions user, sender blacklisted => no notify (D-09 step 3)", () => {
    const mentioning = makeMessage({ tags: [["p", userPubkey]] });
    expect(
      decide(true, "mentions", mentioning, userPubkey, false),
    ).toBe(false);
  });

  test("enabled=true, mode=mentions, mentions user, sender allowed => notify", () => {
    const mentioning = makeMessage({ tags: [["p", userPubkey]] });
    expect(decide(true, "mentions", mentioning, userPubkey, true)).toBe(true);
  });

  test("enabled=true, mode=all, sender allowed => notify (D-01)", () => {
    expect(decide(true, "all", makeMessage(), userPubkey, true)).toBe(true);
  });

  test("enabled=true, mode=all, sender blacklisted => no notify (D-09 step 3)", () => {
    expect(decide(true, "all", makeMessage(), userPubkey, false)).toBe(false);
  });
});
