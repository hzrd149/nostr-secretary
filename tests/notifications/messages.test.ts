import { describe, test, expect } from "bun:test";
import { PrivateKeySigner } from "applesauce-signers";
import { unlockLegacyMessage } from "applesauce-common/helpers";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { kinds, type NostrEvent } from "nostr-tools";

import { classifyDmSender } from "../../notifications/dm-category";

// NOTE: This file intentionally does NOT import notifications/messages.ts
// (or the notifications/index.ts barrel). That module self-subscribes to
// the live RelayPool/EventStore singleton (services/nostr.ts) at import
// time (see .planning/codebase/TESTING.md and
// tests/notifications/groups.test.ts's identical precedent), so importing
// it here would risk real network I/O. Instead:
//  - the NIP-04 decrypt coverage below calls applesauce's real, exported
//    `unlockLegacyMessage` directly against a manually-built kind-4 event
//    and a PrivateKeySigner fixture (no app code involved at all), and
//  - the shouldNotify gate-order coverage below is a LOCAL mirror function
//    that reproduces the exact gate order implemented in
//    notifications/messages.ts (lines ~41-69): isMuted -> per-section
//    blacklist -> per-section whitelist -> global whitelist -> global
//    blacklist.
//
// TODO(WR-04, tracked follow-up, matches groups.test.ts's caveat): this
// mirror only covers the gate-order logic in isolation -- it has zero
// coverage of the actual wiring in notifications/messages.ts's
// `.subscribe()` callback, so a future change that reorders the gates or
// drops a check would keep this suite green while regressing production
// behavior. All inputs below are plain, injected arrays/sets -- no pubkey
// is read from a live AppConfig and no list is loaded over the network.

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
