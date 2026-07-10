import { describe, test, expect } from "bun:test";
import { PrivateKeySigner } from "applesauce-signers";
import { unlockLegacyMessage } from "applesauce-common/helpers";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { kinds, type NostrEvent } from "nostr-tools";

import { classifyDmSender } from "../../notifications/dm-category";
import { evaluateDmNotificationGates } from "../../notifications/dm-notification-gate";

// NOTE: This file intentionally does NOT import notifications/messages.ts
// (or the notifications/index.ts barrel). That module self-subscribes to
// the live RelayPool/EventStore singleton (services/nostr.ts) at import
// time (see .planning/codebase/TESTING.md and
// tests/notifications/groups.test.ts's identical precedent), so importing
// it here would risk real network I/O. Instead:
//  - the NIP-04 decrypt coverage below calls applesauce's real, exported
//    `unlockLegacyMessage` directly against a manually-built kind-4 event
//    and a PrivateKeySigner fixture (no app code involved at all),
//  - the shouldNotify gate-order coverage below is a LOCAL mirror function
//    that reproduces the exact gate order implemented in
//    notifications/messages.ts (lines ~41-69): isMuted -> per-section
//    blacklist -> per-section whitelist -> global whitelist -> global
//    blacklist, and
//  - the D5-07 category-gate-then-shouldNotify ORDERING (which stage runs
//    first) is now covered against the REAL production function, not a
//    mirror (WR-02): `evaluateDmNotificationGates`
//    (notifications/dm-notification-gate.ts) is the exact function both DM
//    listeners in notifications/messages.ts call. It has zero runtime
//    dependency on services/nostr.ts (only a type-only AppConfig import,
//    erased at compile time), and takes `shouldNotify` as an injected
//    argument, so importing and calling it directly here is network-safe
//    while still exercising the real wiring instead of a hand-written copy.
//
// TODO(WR-04, tracked follow-up, matches groups.test.ts's caveat): the
// `shouldNotify` function itself (isMuted -> blacklist -> whitelist gate
// internals) still only has mirror coverage below -- it reads from
// services/nostr.ts singletons and getConfig(), so it cannot be imported
// directly without the same self-subscription risk as notifications/
// messages.ts itself. Only the D5-07 gate ORDER around it (category gate,
// then shouldNotify) has been upgraded to real-function coverage via
// evaluateDmNotificationGates above. All inputs below are plain, injected
// arrays/sets/stubs -- no pubkey is read from a live AppConfig and no list
// is loaded over the network.

describe("unlockLegacyMessage (NIP-04)", () => {
  test("decrypts a kind-4 event addressed to self via a PrivateKeySigner round-trip", async () => {
    const senderSigner = new PrivateKeySigner();
    const senderPubkey = await senderSigner.getPublicKey();

    const receiverSecretKey = generateSecretKey();
    const receiverPubkey = getPublicKey(receiverSecretKey);
    const receiverSigner = new PrivateKeySigner(receiverSecretKey);

    const plaintext = "hello from a test";
    const ciphertext = await senderSigner.nip04.encrypt(
      receiverPubkey,
      plaintext,
    );

    const event: NostrEvent = {
      id: "id",
      pubkey: senderPubkey,
      created_at: 0,
      kind: kinds.EncryptedDirectMessage,
      tags: [["p", receiverPubkey]],
      content: ciphertext,
      sig: "sig",
    };

    const decrypted = await unlockLegacyMessage(
      event,
      receiverPubkey,
      receiverSigner,
    );

    expect(decrypted).toBe(plaintext);
  });

  test("rejects a garbage/non-ciphertext content value (the exact failure Task 2's catchError must absorb)", async () => {
    const senderSecretKey = generateSecretKey();
    const senderPubkey = getPublicKey(senderSecretKey);

    const receiverSecretKey = generateSecretKey();
    const receiverPubkey = getPublicKey(receiverSecretKey);
    const receiverSigner = new PrivateKeySigner(receiverSecretKey);

    const event: NostrEvent = {
      id: "id",
      pubkey: senderPubkey,
      created_at: 0,
      kind: kinds.EncryptedDirectMessage,
      tags: [["p", receiverPubkey]],
      content: "this is not valid nip-04 ciphertext",
      sig: "sig",
    };

    await expect(
      unlockLegacyMessage(event, receiverPubkey, receiverSigner),
    ).rejects.toBeTruthy();
  });
});

describe("shouldNotify gate order mirror (D3-09)", () => {
  // Mirrors the exact gate order implemented in notifications/messages.ts's
  // `shouldNotify(pubkey)`: isMuted -> per-section blacklist -> per-section
  // whitelist -> global whitelist -> global blacklist. This is a pure,
  // synchronous local mirror -- it does not call services/nostr.ts,
  // helpers/lists.ts, or helpers/observable.ts, and takes every input as an
  // injected argument so no real list-loading or network I/O occurs.
  function decide(
    pubkey: string,
    opts: {
      muted?: Set<string>;
      perSectionBlacklist?: string[];
      perSectionWhitelist?: string[];
      globalWhitelist?: string[];
      globalBlacklist?: string[];
    },
  ): boolean {
    const muted = opts.muted ?? new Set<string>();
    const perSectionBlacklist = opts.perSectionBlacklist ?? [];
    const perSectionWhitelist = opts.perSectionWhitelist ?? [];
    const globalWhitelist = opts.globalWhitelist ?? [];
    const globalBlacklist = opts.globalBlacklist ?? [];

    // Never notify for pubkeys the user has muted (NIP-51 kind 10000)
    if (muted.has(pubkey)) return false;

    // If there are per-section blacklists, check if sender is blacklisted
    if (perSectionBlacklist.length > 0 && perSectionBlacklist.includes(pubkey))
      return false;

    // If there are per-section whitelists, only allow whitelisted senders
    if (perSectionWhitelist.length > 0)
      return perSectionWhitelist.includes(pubkey);

    // if they are not on the global whitelist
    if (globalWhitelist.length > 0 && !globalWhitelist.includes(pubkey))
      return false;

    // if they are on the global blacklist
    if (globalBlacklist.length > 0 && globalBlacklist.includes(pubkey))
      return false;

    // If no whitelists, allow everyone (except blacklisted)
    return true;
  }

  const senderSecretKey = generateSecretKey();
  const sender = getPublicKey(senderSecretKey);

  test("muted sender is rejected regardless of any list", () => {
    expect(
      decide(sender, {
        muted: new Set([sender]),
        globalWhitelist: [sender],
      }),
    ).toBe(false);
  });

  test("per-section blacklist rejects a listed sender", () => {
    expect(
      decide(sender, {
        perSectionBlacklist: [sender],
      }),
    ).toBe(false);
  });

  test("per-section whitelist allows only listed senders", () => {
    expect(
      decide(sender, {
        perSectionWhitelist: [sender],
      }),
    ).toBe(true);

    const otherSecretKey = generateSecretKey();
    const other = getPublicKey(otherSecretKey);
    expect(
      decide(other, {
        perSectionWhitelist: [sender],
      }),
    ).toBe(false);
  });

  test("global whitelist excludes senders not on the list", () => {
    expect(
      decide(sender, {
        globalWhitelist: [sender],
      }),
    ).toBe(true);

    const otherSecretKey = generateSecretKey();
    const other = getPublicKey(otherSecretKey);
    expect(
      decide(other, {
        globalWhitelist: [sender],
      }),
    ).toBe(false);
  });

  test("global blacklist rejects a listed sender", () => {
    expect(
      decide(sender, {
        globalBlacklist: [sender],
      }),
    ).toBe(false);
  });

  test("no lists configured allows everyone", () => {
    expect(decide(sender, {})).toBe(true);
  });
});

describe("evaluateDmNotificationGates -- REAL production gate ordering (D5-07, WR-02)", () => {
  // Unlike the mirror-based describe blocks in this file, this block
  // imports and directly exercises `evaluateDmNotificationGates`, the exact
  // function both notifications/messages.ts DM listeners call to decide
  // "category gate, then shouldNotify" (see notifications/dm-notification-
  // gate.ts). It is safe to import here because that module has zero
  // runtime dependency on services/nostr.ts's self-subscribing singletons
  // (only a type-only import of AppConfig) -- `shouldNotify` itself is
  // injected as a plain stub below, so no network I/O or live config is
  // ever touched. A future change that reorders the gates, drops the
  // category check, or short-circuits shouldNotify would fail the tests
  // below (WR-02) -- unlike the hand-written mirrors, this is the actual
  // production code path.
  const senderSecretKey = generateSecretKey();
  const sender = getPublicKey(senderSecretKey);

  const messages = (contactsEnabled: boolean, othersEnabled: boolean) => ({
    contacts: { enabled: contactsEnabled },
    others: { enabled: othersEnabled },
  });

  test("category-disabled short-circuits BEFORE shouldNotify is even called", async () => {
    let shouldNotifyCalled = false;
    const shouldNotify = async () => {
      shouldNotifyCalled = true;
      return true;
    };

    const result = await evaluateDmNotificationGates(
      "contacts",
      messages(false, true),
      sender,
      shouldNotify,
    );

    expect(result).toEqual({ pass: false, reason: "category-disabled" });
    // Proves the ORDER, not just the outcome: shouldNotify must never run
    // once the category gate has already rejected the sender.
    expect(shouldNotifyCalled).toBe(false);
  });

  test("category enabled + shouldNotify true -> passes", async () => {
    const result = await evaluateDmNotificationGates(
      "contacts",
      messages(true, false),
      sender,
      async () => true,
    );

    expect(result).toEqual({ pass: true });
  });

  test("category enabled + shouldNotify false -> blocked with not-whitelisted reason", async () => {
    const result = await evaluateDmNotificationGates(
      "others",
      messages(false, true),
      sender,
      async () => false,
    );

    expect(result).toEqual({ pass: false, reason: "not-whitelisted" });
  });

  test("shouldNotify receives the exact sender pubkey passed in", async () => {
    let receivedPubkey: string | undefined;
    await evaluateDmNotificationGates(
      "others",
      messages(true, true),
      sender,
      async (pubkey) => {
        receivedPubkey = pubkey;
        return true;
      },
    );

    expect(receivedPubkey).toBe(sender);
  });
});

describe("layered category gate mirror (D5-07)", () => {
  // Mirrors the exact messages[category].enabled lookup implemented in both
  // notifications/messages.ts DM listeners: classify the real sender via the
  // REAL (pure, network-safe) classifyDmSender, then look up that category's
  // enabled flag. This mirror only covers the category-gate decision in
  // isolation -- it does not import notifications/messages.ts or
  // services/nostr.ts (see the top-of-file note). The layering itself (the
  // category gate running BEFORE the unchanged shouldNotify decide() mirror
  // above) is asserted structurally by both describe blocks passing: this
  // block proves the category decision, the sibling block above proves
  // shouldNotify is untouched -- together they document the two-statement
  // gate order without either test importing the self-subscribing module.
  function passesCategoryGate(
    isFollowed: boolean,
    flags: { contactsEnabled: boolean; othersEnabled: boolean },
  ): boolean {
    return {
      contacts: { enabled: flags.contactsEnabled },
      others: { enabled: flags.othersEnabled },
    }[classifyDmSender(isFollowed)].enabled;
  }

  test("followed sender + contacts enabled -> passes", () => {
    expect(
      passesCategoryGate(true, { contactsEnabled: true, othersEnabled: false }),
    ).toBe(true);
  });

  test("followed sender + contacts disabled -> blocked before shouldNotify", () => {
    expect(
      passesCategoryGate(true, { contactsEnabled: false, othersEnabled: true }),
    ).toBe(false);
  });

  test("not-followed sender + others enabled -> passes", () => {
    expect(
      passesCategoryGate(false, { contactsEnabled: true, othersEnabled: true }),
    ).toBe(true);
  });

  test("not-followed sender + others disabled -> blocked before shouldNotify", () => {
    expect(
      passesCategoryGate(false, {
        contactsEnabled: true,
        othersEnabled: false,
      }),
    ).toBe(false);
  });

  test("unavailable follow list (isFollowed=false) is gated by othersEnabled, identical to a genuine non-follow (D5-02)", () => {
    // isContact falls back to `false` when the follow list can't load in
    // time -- classifyDmSender treats that identically to a real non-follow,
    // so the gate here is indistinguishable from the "not-followed" cases
    // above by design.
    expect(
      passesCategoryGate(false, {
        contactsEnabled: true,
        othersEnabled: false,
      }),
    ).toBe(false);
    expect(
      passesCategoryGate(false, {
        contactsEnabled: false,
        othersEnabled: true,
      }),
    ).toBe(true);
  });
});
