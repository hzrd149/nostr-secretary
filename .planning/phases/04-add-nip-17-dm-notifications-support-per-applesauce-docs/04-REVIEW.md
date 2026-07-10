---
phase: 04-add-nip-17-dm-notifications-support-per-applesauce-docs
reviewed: 2026-07-10T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - helpers/gift-wrap-subscription.ts
  - notifications/gift-wrap-messages.ts
  - notifications/messages.ts
  - services/nostr.ts
  - tests/helpers/gift-wrap-subscription.test.ts
  - tests/notifications/gift-wrap-messages.test.ts
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-07-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the D4-02 seed+live dedup combinator (`notifyNewGiftWraps`), the extracted `unlockPrivateDirectMessage` unwrap/classify unit, the rewritten `giftWraps$` in `services/nostr.ts`, and the rewired NIP-17 block in `notifications/messages.ts`, plus their unit tests. `bun test` (74 pass) and `tsc --noEmit` are both green.

The pure combinator itself (`notifyNewGiftWraps`) is correct and well-tested for the happy path: a historical wrap seen during seeding is never re-emitted even if the relay resends it on the live REQ, a genuinely-new wrap after seeding completes is emitted exactly once, and an empty seed still notifies correctly (the original `limit:1`/`skip(1)` bug is fixed). D4-05 (no reconnect/degraded hint on gift-wrap decrypt failure), the `sendContent` gate, and the untouched NIP-04 path all check out against the diff.

However, the way `services/nostr.ts` wires the combinator's `seed$` input reintroduces the exact historical-backlog-notification bug D4-02 was meant to fix, under a realistic failure condition (a slow/unresponsive DM relay) — this is the headline finding below. There is also unbounded growth of the `seen` id set over long process uptime, and a test-coverage gap for the seed-failure path that is precisely the scenario flagged as a risk for this phase.

## Critical Issues

### CR-01: A failed/timed-out seed request silently disables all backlog dedup, causing a mass re-notification of every historical gift-wrapped DM

**File:** `services/nostr.ts:235-246`
**Issue:**

```ts
const seedRequest$ = pool.request(messageInboxes, giftWrapFilter, {
  eventStore,
  timeout: 10_000,
});
const seed$ = seedRequest$.pipe(catchError(() => EMPTY));

const live$ = pool.subscription(messageInboxes, giftWrapFilter, {
  reconnect: Infinity,
});

return notifyNewGiftWraps(seed$, live$);
```

`notifyNewGiftWraps` only populates its `seen` set from whatever `seed$` actually emits before completing (`helpers/gift-wrap-subscription.ts:24-27`, `tap((event) => seen.add(event.id))`). `giftWrapFilter` has **no `since`** (deliberately, per the file's own comment, because NIP-59 randomizes `created_at`), so when `live$` (`pool.subscription`) opens its own REQ, the relay will resend the **entire matching history** as the initial burst of that subscription — this is explicitly called out as "Pitfall 1" in the same file's docstring, and is only safe because `seen` is expected to already contain every historical id from the seed phase.

`pool.request`'s default complete condition (`RelayGroup.completeOnAny(completeAfterFirstRelay(5_000), completeOnAllEose())`, see `node_modules/applesauce-relay/dist/group.js:150-153`) combined with the explicit `timeout: 10_000` means the seed request throws a `TimeoutError` whenever any configured DM-inbox relay is slow or unreachable — an entirely realistic production condition, not a contrived edge case. When that happens, `catchError(() => EMPTY)` swallows it **completely silently** (no `log(...)` call anywhere on this path) and `seed$` completes having added zero ids to `seen`. `live$` is then subscribed to (via `concat`) with an **empty** `seen` set, so its full-history initial burst is not deduped at all: every historical gift-wrapped DM the user has ever received passes the `filter` in `notifyNewGiftWraps` as "new" and triggers a real desktop/ntfy notification. This is the exact regression D4-02 was written to prevent, and it is silent — there's no log line, no degraded-mode signal (contrast with `nip04DecryptDegraded$` for the NIP-04 path), nothing to indicate to an operator why a user's phone just lit up with weeks of old DM notifications.

The same failure mode also applies to a *partial* seed failure (some events emitted, then an error mid-stream): only the ids seen before the error are deduped, and the rest of the backlog gets re-notified via `live$`'s burst.

**Fix:** Do not let a seed failure fall straight through to an unguarded live subscription. At minimum:
1. Log the seed failure (currently zero visibility):
```ts
const seed$ = seedRequest$.pipe(
  catchError((error) => {
    log("Gift wrap seed request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return EMPTY;
  }),
);
```
2. Add retry-with-backoff before giving up, so a single slow EOSE/transient timeout doesn't permanently disable dedup for the session:
```ts
const seed$ = seedRequest$.pipe(
  retry({ count: 2, delay: 2_000 }),
  catchError((error) => {
    log("Gift wrap seed request failed after retries — suppressing live gift-wrap notifications this cycle", {
      error: error instanceof Error ? error.message : String(error),
    });
    // Fail closed: don't open live$ ungated. Bail out of this cycle
    // entirely rather than risk a full-history notification storm.
    return EMPTY;
  }),
);
return seed$.pipe(
  ignoreElements(),
  // only proceed to live$ if seed$ actually completed via its normal path
  // (e.g. gate with a boolean flag, or use the retried seed$ directly with
  // notifyNewGiftWraps only when it succeeded).
);
```
Whatever the exact shape, the property that must hold is: **a seed failure must never result in `live$` being subscribed to with an unpopulated `seen` set.** Either retry until it succeeds, or suppress the live subscription entirely until the next `switchMap` cycle (e.g. `messageInboxes$` re-emitting), matching the "fail closed" behavior the rest of this phase's D4-05/D3-07 hint logic follows elsewhere.

## Warnings

### WR-01: `seen` set in `notifyNewGiftWraps` grows without bound for the lifetime of the subscription

**File:** `helpers/gift-wrap-subscription.ts:21-35`
**Issue:** `seen: Set<string> = new Set()` accumulates every gift-wrap id ever observed (seed + live) for as long as the `giftWraps$` inner subscription lives, which — given `messageInboxes$`/`user$` rarely change and `giftWraps$` is only re-subscribed when its sole downstream consumer (`enabledSigner` in `notifications/messages.ts`) re-fires — can be the entire process lifetime for a long-running notification service. There is no eviction, cap, or LRU behavior; on a busy account over weeks/months this is unbounded growth with no upper limit.
**Fix:** Bound the set, e.g. cap it to the last N ids (evict oldest on insert past a threshold), or swap to a small ring buffer / bounded LRU:
```ts
const MAX_SEEN = 5_000;
function remember(seen: Set<string>, id: string) {
  seen.add(id);
  if (seen.size > MAX_SEEN) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
}
```

### WR-02: No test exercises the seed-failure path, which is the exact scenario CR-01 regresses

**File:** `tests/helpers/gift-wrap-subscription.test.ts`
**Issue:** All four tests construct `seed$` with `of(...)`, which always completes successfully. None exercise `seed$` erroring (e.g. via `throwError(...)`) before `live$` delivers its own backlog resend — precisely the condition under which a historical wrap gets re-notified (CR-01). Given this was an explicit review focus for the phase ("Could a historical wrap be re-notified?"), the test suite should cover it, even if the current answer is "yes, and that's the bug."
**Fix:** Add a test like:
```ts
test("if seed$ errors, seen stays empty and a resent historical wrap on live$ IS (incorrectly) emitted — documents the current gap", () => {
  const historical = fakeEvent("historical-id");
  const seed$ = throwError(() => new Error("seed timeout"));
  const live$ = new Subject<NostrEvent>();
  // notifyNewGiftWraps itself doesn't catch seed errors -- callers must.
  // This test should catch the *caller's* seed$ (post-catchError) and
  // confirm the tradeoff is either fixed or deliberately documented.
});
```
This both documents the current gap and will force the test to be updated once CR-01 is fixed.

### WR-03: Seed failure is unlogged at the integration point

**File:** `services/nostr.ts:239`
**Issue:** `const seed$ = seedRequest$.pipe(catchError(() => EMPTY));` swallows the error with no `log(...)` call, unlike every other error path in this phase (`notifications/messages.ts`'s NIP-04 and NIP-17 `catchError` blocks both log). This makes the CR-01 failure mode invisible in production logs — an operator debugging "why did the user get 200 old-DM notifications at 3am" has no log line to find.
**Fix:** See CR-01's fix — add a `log(...)` call inside the `catchError`, at minimum.

## Info

### IN-01: NIP-17 notification path does not skip empty-content rumors, unlike the parallel NIP-04 path

**File:** `notifications/messages.ts:226-259`
**Issue:** The NIP-04 subscribe callback (`notifications/messages.ts:169-170`) has `if (!content) return;` before notifying. The NIP-17 subscribe callback has no equivalent check — `const content = rumor.content;` is used directly in the notification body with no guard. If a sender crafts (or a bug produces) a `PrivateDirectMessage` rumor with empty content, the user gets a notification with a title but an empty body, whereas the NIP-04 path would have silently skipped it. This is a minor asymmetry between the two paths rather than a crash risk.
**Fix:** For consistency, consider adding the same guard:
```ts
const content = rumor.content;
if (!content) return;
```
(Confirm intent first — an empty-content NIP-17 rumor may be a legitimate use case, e.g. an attachment-only message, in which case this asymmetry is fine and should just be documented instead.)

---

_Reviewed: 2026-07-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
