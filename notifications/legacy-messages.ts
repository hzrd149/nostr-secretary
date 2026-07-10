import {
  getDisplayName,
  npubEncode,
  type ProfileContent,
} from "applesauce-core/helpers";
import { unlockLegacyMessage } from "applesauce-common/helpers";
import type { NostrEvent } from "nostr-tools";

import { log } from "../services/logs";

/** The subset of `unlockLegacyMessage`'s signer parameter this module needs. */
type LegacySigner = Parameters<typeof unlockLegacyMessage>[2] & {
  pubkey: string;
};

export type DecryptedLegacyMessage = {
  sender: string;
  profile: ProfileContent | undefined;
  content: string;
  event: NostrEvent;
};

export type DecryptLegacyMessageDeps = {
  /** Looks up a sender's profile. Rejections are swallowed by this module --
   *  a profile-lookup failure must never be conflated with a decrypt
   *  failure (WR-01). */
  getProfile: (sender: string) => Promise<ProfileContent | undefined>;
  unlock: typeof unlockLegacyMessage;
  log: typeof log;
};

/**
 * Decrypts a single NIP-04 kind-4 `event` addressed to `pubkey` from
 * `sender`, looking up the sender's profile first via `deps.getProfile`.
 *
 * Extracted out of notifications/messages.ts's mergeMap body (WR-04) so the
 * profile-lookup-vs-decrypt-failure distinction (WR-01) can be unit tested
 * with mocked `deps`, without importing notifications/messages.ts (or
 * services/nostr.ts, which it depends on) -- those modules self-subscribe
 * to the live RelayPool/EventStore singleton at import time (see
 * tests/notifications/messages.test.ts's precedent), so importing them in a
 * test would risk real network I/O. This module deliberately has no
 * top-level singleton imports or side effects: `deps` must be supplied
 * explicitly by the caller (see notifications/messages.ts, which wires the
 * real `eventStore`/`getValue`-backed `getProfile`), so it is always safe to
 * import directly in tests.
 *
 * A `deps.getProfile` rejection (e.g. a profile-lookup timeout) is swallowed
 * here and yields `profile: undefined` -- it is NOT a decrypt failure and
 * must never propagate to the caller. Only `deps.unlock` rejecting/throwing
 * is a genuine decrypt failure; callers are expected to catch that
 * separately (e.g. via a `catchError` around the returned promise) and
 * treat it as decrypt-permission-hint-worthy.
 *
 * Returns `undefined` if `deps.unlock` resolves to empty content.
 */
export async function decryptLegacyDirectMessage(
  event: NostrEvent,
  pubkey: string,
  sender: string,
  signer: LegacySigner,
  deps: DecryptLegacyMessageDeps,
): Promise<DecryptedLegacyMessage | undefined> {
  const profile = await deps.getProfile(sender).catch(() => undefined);

  deps.log("Unlocking legacy message", {
    event: event.id,
    sender,
    signer: signer.pubkey,
  });

  // Only this await should be treated as a decrypt failure by the caller --
  // the profile lookup above has already absorbed its own failures.
  const content = await deps.unlock(event, pubkey, signer);
  if (!content) return undefined;

  return { sender, profile, content, event };
}

/**
 * Builds the display name used for a NIP-04 legacy-DM notification title,
 * falling back to a shortened npub of `sender` when `profile` is
 * `undefined` (WR-01: a swallowed profile-lookup timeout in
 * `decryptLegacyDirectMessage` yields `profile: undefined` on purpose, so
 * this must never be conflated with a decrypt failure).
 *
 * `getDisplayName`'s own auto-fallback-to-npub logic only triggers when
 * given a full signed `NostrEvent` (it checks for `pubkey`/`id`/`sig`
 * fields) -- since `profile` here is a bare `ProfileContent | undefined`,
 * calling `getDisplayName(profile)` alone would return `undefined` with no
 * fallback whenever `profile` is `undefined`, rendering the literal string
 * "undefined" in a user-facing notification title. Building the fallback
 * npub explicitly here (matching applesauce's own
 * `npub.slice(0, 5 + 4) + "…" + npub.slice(-4)` convention) avoids that.
 */
export function getMessageDisplayName(
  profile: ProfileContent | undefined,
  sender: string,
): string {
  const npub = npubEncode(sender);
  const fallback = npub.slice(0, 5 + 4) + "…" + npub.slice(-4);
  return getDisplayName(profile, fallback) ?? fallback;
}
