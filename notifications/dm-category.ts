/**
 * The two DM notification categories a sender can classify into: a followed
 * sender is "contacts", anything else is "others". This is exactly a
 * two-state union -- there is no third "unknown"/"pending" state.
 */
export type DmCategory = "contacts" | "others";

/**
 * Classifies a DM sender into a notification category given whether the user
 * follows them (D5-01). This is a pure, synchronous, network-free function
 * with no top-level singleton imports -- callers resolve `isFollowed` first
 * (e.g. via services/nostr.ts#isContact) before calling this.
 *
 * Anything other than a confirmed follow classifies as "others" -- including
 * when `isFollowed` is `false` because the follow list could not be loaded
 * in time (isContact's 2s-timeout fallback). An unresolved follow list and a
 * genuine non-follow are indistinguishable by design: both are `false`, and
 * both classify as "others" (D5-02). This mirrors
 * notifications/legacy-messages.ts's extract-for-testability precedent.
 */
export function classifyDmSender(isFollowed: boolean): DmCategory {
  return isFollowed ? "contacts" : "others";
}
