import { describe, expect, test } from "bun:test";
import { kinds, type NostrEvent } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import {
  decryptLegacyDirectMessage,
  getMessageDisplayName,
  type DecryptLegacyMessageDeps,
} from "../../notifications/legacy-messages";

// notifications/legacy-messages.ts has no top-level singleton imports or
// side effects (unlike notifications/messages.ts / services/nostr.ts, which
// self-subscribe to the live RelayPool/EventStore at import time -- see
// tests/notifications/messages.test.ts's precedent), so it is safe to
// import directly here. `deps` is always injected explicitly by the caller,
// which is exactly what lets these tests exercise the WR-01 fix -- the
// distinction between a profile-lookup failure and an actual decrypt
// failure -- with mocked getProfile/unlock, without any network I/O.

const noopLog: DecryptLegacyMessageDeps["log"] = () => {};

const event: NostrEvent = {
  id: "event-id",
  pubkey: "sender-pubkey",
  created_at: 0,
  kind: kinds.EncryptedDirectMessage,
  tags: [["p", "receiver-pubkey"]],
  content: "ciphertext",
  sig: "sig",
};

const signer = { pubkey: "receiver-pubkey" } as Parameters<
  typeof decryptLegacyDirectMessage
>[3];

describe("decryptLegacyDirectMessage (WR-04 coverage of the WR-01 fix)", () => {
  test("happy path: resolves with the decrypted content and looked-up profile", async () => {
    const calls: { getProfile: string[]; unlock: number } = {
      getProfile: [],
      unlock: 0,
    };

    const result = await decryptLegacyDirectMessage(
      event,
      "receiver-pubkey",
      "sender-pubkey",
      signer,
      {
        getProfile: async (sender) => {
          calls.getProfile.push(sender);
          return { name: "Alice" };
        },
        unlock: async () => {
          calls.unlock++;
          return "hello";
        },
        log: noopLog,
      },
    );

    expect(result).toEqual({
      sender: "sender-pubkey",
      profile: { name: "Alice" },
      content: "hello",
      event,
    });
    expect(calls.getProfile).toEqual(["sender-pubkey"]);
    expect(calls.unlock).toBe(1);
  });

  test("a profile-lookup failure (e.g. a getValue timeout) does NOT reject -- it resolves with profile: undefined (WR-01)", async () => {
    const result = await decryptLegacyDirectMessage(
      event,
      "receiver-pubkey",
      "sender-pubkey",
      signer,
      {
        getProfile: async () => {
          throw new Error("TimeoutError: profile lookup timed out");
        },
        unlock: async () => "hello",
        log: noopLog,
      },
    );

    // The profile lookup rejected, but that must not surface as a thrown
    // error from this function -- only an actual unlock failure should.
    expect(result).toEqual({
      sender: "sender-pubkey",
      profile: undefined,
      content: "hello",
      event,
    });
  });

  test("an actual decrypt failure rejects (distinct from a profile-lookup failure) (WR-01)", async () => {
    await expect(
      decryptLegacyDirectMessage(
        event,
        "receiver-pubkey",
        "sender-pubkey",
        signer,
        {
          getProfile: async () => ({ name: "Alice" }),
          unlock: async () => {
            throw new Error("decrypt failed: not granted nip04_decrypt");
          },
          log: noopLog,
        },
      ),
    ).rejects.toThrow("decrypt failed: not granted nip04_decrypt");
  });

  test("both getProfile and unlock failing still rejects with the unlock error, not the profile error (WR-01)", async () => {
    await expect(
      decryptLegacyDirectMessage(
        event,
        "receiver-pubkey",
        "sender-pubkey",
        signer,
        {
          getProfile: async () => {
            throw new Error("TimeoutError: profile lookup timed out");
          },
          unlock: async () => {
            throw new Error("decrypt failed: not granted nip04_decrypt");
          },
          log: noopLog,
        },
      ),
    ).rejects.toThrow("decrypt failed: not granted nip04_decrypt");
  });

  test("returns undefined (without throwing) when unlock resolves to empty content", async () => {
    const result = await decryptLegacyDirectMessage(
      event,
      "receiver-pubkey",
      "sender-pubkey",
      signer,
      {
        getProfile: async () => ({ name: "Alice" }),
        unlock: async () => "",
        log: noopLog,
      },
    );

    expect(result).toBeUndefined();
  });
});

describe("getMessageDisplayName (WR-01 regression: undefined-profile title fallback)", () => {
  // Uses a real, generated 32-byte hex pubkey (rather than the
  // "sender-pubkey" placeholder used above) so nip19.npubEncode succeeds --
  // this exercises the exact encode-and-slice logic the fallback depends on.
  const sender = getPublicKey(generateSecretKey());

  test("falls back to a shortened npub (never the literal string 'undefined') when profile is undefined", () => {
    const name = getMessageDisplayName(undefined, sender);

    expect(name).not.toBe("undefined");
    expect(name).not.toContain("undefined");

    const npub = nip19.npubEncode(sender);
    const expectedFallback = npub.slice(0, 9) + "…" + npub.slice(-4);
    expect(name).toBe(expectedFallback);
  });

  test("prefers the profile's display_name/name over the npub fallback when profile is defined", () => {
    expect(getMessageDisplayName({ name: "Alice" }, sender)).toBe("Alice");
    expect(
      getMessageDisplayName({ display_name: "Alice B" }, sender),
    ).toBe("Alice B");
  });

  test("falls back to the shortened npub when profile is defined but has no name fields", () => {
    const name = getMessageDisplayName({}, sender);
    const npub = nip19.npubEncode(sender);
    const expectedFallback = npub.slice(0, 9) + "…" + npub.slice(-4);
    expect(name).toBe(expectedFallback);
  });
});
