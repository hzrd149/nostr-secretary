import { describe, test, expect } from "bun:test";
import { PrivateKeySigner } from "applesauce-signers";
import { GiftWrapFactory } from "applesauce-common/factories";
import { kinds } from "nostr-tools";
import { unlockPrivateDirectMessage } from "../../notifications/gift-wrap-messages";

// notifications/gift-wrap-messages.ts has no top-level singleton imports or
// side effects (unlike the self-subscribing notification-listener/service
// modules, which subscribe to the live RelayPool/EventStore at import
// time), so it is safe to import directly here -- these tests build a real
// gift wrap in memory via GiftWrapFactory/PrivateKeySigner (no relays) and
// exercise the unwrap-and-classify unit directly, without any network I/O.

describe("unlockPrivateDirectMessage (D4-09)", () => {
  test("unwraps a real gift wrap and returns the rumor for a PrivateDirectMessage", async () => {
    const senderSigner = new PrivateKeySigner();
    const senderPubkey = await senderSigner.getPublicKey();
    const receiverSigner = new PrivateKeySigner();
    const receiverPubkey = await receiverSigner.getPublicKey();

    const gift = await GiftWrapFactory.create(senderSigner, receiverPubkey, {
      kind: kinds.PrivateDirectMessage,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", receiverPubkey]],
      content: "hello from a test",
    });

    const rumor = await unlockPrivateDirectMessage(gift, receiverSigner);

    expect(rumor?.content).toBe("hello from a test");
    expect(rumor?.pubkey).toBe(senderPubkey); // the REAL sender, not the gift wrap's random pubkey
    expect(gift.pubkey).not.toBe(senderPubkey); // confirms NIP-59 anonymization occurred
  });

  test("returns undefined for a rumor kind that is not PrivateDirectMessage", async () => {
    const senderSigner = new PrivateKeySigner();
    const receiverSigner = new PrivateKeySigner();
    const receiverPubkey = await receiverSigner.getPublicKey();

    const gift = await GiftWrapFactory.create(senderSigner, receiverPubkey, {
      kind: 9, // e.g. a group-chat message rumor, not a DM
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: "not a dm",
    });

    const rumor = await unlockPrivateDirectMessage(gift, receiverSigner);
    expect(rumor).toBeUndefined();
  });
});
