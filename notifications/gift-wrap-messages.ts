import { unlockGiftWrap, type Rumor } from "applesauce-common/helpers";
import type { NostrEvent } from "nostr-tools";
import { kinds } from "nostr-tools";

export type UnwrapGiftWrapDeps = {
  unlock: typeof unlockGiftWrap;
};

/**
 * Unwraps a gift-wrap `event` and returns the inner rumor IF it is a
 * NIP-17 private direct message (kind 14); returns `undefined` for any
 * other rumor kind (e.g. a group-chat rumor this app does not notify on).
 * Callers are expected to wrap this in their own error handling (a failed
 * unwrap is common/expected -- spam/malformed/not-for-this-key wraps --
 * and must never be conflated with a signer-permission problem, D4-05).
 */
export async function unlockPrivateDirectMessage(
  event: NostrEvent,
  signer: Parameters<typeof unlockGiftWrap>[1],
  deps: UnwrapGiftWrapDeps = { unlock: unlockGiftWrap },
): Promise<Rumor | undefined> {
  const rumor = await deps.unlock(event, signer);
  if (rumor.kind !== kinds.PrivateDirectMessage) return undefined;
  return rumor;
}
