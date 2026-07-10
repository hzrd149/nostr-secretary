---
phase: 04-add-nip-17-dm-notifications-support-per-applesauce-docs
fixed_at: 2026-07-10T16:36:00Z
review_path: .planning/phases/04-add-nip-17-dm-notifications-support-per-applesauce-docs/04-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 4: Code Review Fix Report

**Fixed at:** 2026-07-10T16:36:00Z
**Source review:** .planning/phases/04-add-nip-17-dm-notifications-support-per-applesauce-docs/04-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope (critical + warning): 4 (CR-01, WR-01, WR-02, WR-03)
- Fixed: 4
- Skipped: 0

CR-01, WR-01, WR-02, and WR-03 were fixed together in a single atomic commit. They are interdependent changes to the same two functions in `helpers/gift-wrap-subscription.ts` (the `seen`-set bounding logic and the new retry/fail-closed seeding wrapper both live inside/beside `notifyNewGiftWraps`), plus the caller wiring in `services/nostr.ts` and the tests that exercise both. Splitting them into separate commits would have produced intermediate commits that either didn't compile or didn't actually fix the headline bug (e.g. a WR-01-only commit still leaves CR-01's mass-renotify bug live). One commit was chosen so every commit in the history is a complete, working, test-passing state.

## Fixed Issues

### CR-01: A failed/timed-out seed request silently disables all backlog dedup, causing a mass re-notification of every historical gift-wrapped DM

**Files modified:** `helpers/gift-wrap-subscription.ts`, `services/nostr.ts`, `tests/helpers/gift-wrap-subscription.test.ts`
**Commit:** `34dcf04`
**Applied fix:** Added a new exported `seededGiftWraps(seedRequest$, live$, options)` helper in `helpers/gift-wrap-subscription.ts` that:
1. Retries the seed request with backoff (`retry({ count: 2, delay: 2_000 })` by default) to absorb a single transient timeout/slow-relay hiccup — the common case — without ever touching `live$`.
2. On final failure (retries exhausted), invokes an `onSeedFailure` callback (used for logging — also fixes WR-03) and then **fails closed**: a module-scoped `seedFailed` flag is set, and a `filter(() => !seedFailed)` downstream of `notifyNewGiftWraps` suppresses every emission for the remainder of that subscription's lifetime, rather than letting `live$`'s un-deduped historical backlog burst (Pitfall 1) flow through with an empty `seen` set.

`services/nostr.ts`'s `giftWraps$` now builds `seedRequest$` and `live$` exactly as before but composes them via `seededGiftWraps(seedRequest$, live$, { onSeedFailure: (error) => log(...) })` instead of the old `seedRequest$.pipe(catchError(() => EMPTY))` + `notifyNewGiftWraps(seed$, live$)`. The invariant now holds: a historical wrap present at startup is never notified, even when the seed request ultimately fails (this cycle goes silent and logs instead of storming), and a genuinely new wrap is still notified in the normal (seed-succeeds, possibly after a retry) case. Unused `catchError` import removed from `services/nostr.ts` (no longer used there after the change).

**Trade-off (documented in code comments):** if the seed fails persistently (all retries exhausted), the process suppresses gift-wrap notifications entirely until the next natural resubscribe (`messageInboxes$`/`user$` re-emitting) rather than guessing at a partial `seen` set. This was the "fail closed" option the review itself proposed as the required property to preserve, given `messageInboxes$`/`user$` rarely change during normal operation.

### WR-01: `seen` set in `notifyNewGiftWraps` grows without bound

**Files modified:** `helpers/gift-wrap-subscription.ts`, `tests/helpers/gift-wrap-subscription.test.ts`
**Commit:** `34dcf04`
**Applied fix:** Added a `remember(seen, id, maxSeen)` helper used by both the seed-phase `tap` and the live-phase `filter` inside `notifyNewGiftWraps`. It inserts into `seen` and evicts the oldest entry (relying on `Set`'s insertion-order iteration) once `seen.size` exceeds `maxSeen` (default `DEFAULT_MAX_SEEN = 5_000`, configurable via a new optional 4th parameter, and forwarded through `seededGiftWraps`'s `maxSeen` option). Documented trade-off: an id evicted for being old could theoretically be re-notified if a relay resends it much later, which is an acceptable and strictly-better-than-unbounded-growth trade-off given the 5,000-entry default cap. Added test `"WR-01: the seen set is bounded -- oldest ids are evicted once maxSeen is exceeded"` with a small cap (3) to verify FIFO eviction behavior deterministically.

### WR-02: No test exercises the seed-failure path

**Files modified:** `tests/helpers/gift-wrap-subscription.test.ts`
**Commit:** `34dcf04`
**Applied fix:** Added a new `describe("seededGiftWraps (CR-01 fail-closed seed contract)")` block with two tests:
1. `"if the seed request errors (even after retries), live$'s backlog burst is NOT emitted -- no mass re-notification"` — asserts the CR-01 invariant directly (a historical wrap resent on `live$` after a seed failure is never emitted) and that `onSeedFailure` receives the underlying error.
2. `"a seed that fails transiently but recovers within the retry budget still dedups the backlog normally"` — asserts that a seed which fails twice then succeeds (within `retryCount: 2`) still dedups the historical wrap normally and a genuinely new wrap still notifies, with `onSeedFailure` never invoked.

Both tests directly exercise the exact scenario CR-01 flagged and confirm it is now closed.

### WR-03: Seed failure is unlogged at the integration point

**Files modified:** `services/nostr.ts`
**Commit:** `34dcf04`
**Applied fix:** `giftWraps$` now passes an `onSeedFailure` callback to `seededGiftWraps` that calls `log(...)` with a clear message ("Gift wrap seed request failed after retries -- suppressing live gift-wrap notifications until the next resubscribe to avoid mass re-notification of historical DMs") plus the underlying error message, matching the logging pattern used elsewhere in this phase (NIP-04/NIP-17 `catchError` blocks in `notifications/messages.ts`).

## Out of Scope (not fixed, by design)

### IN-01: NIP-17 notification path does not skip empty-content rumors

**File:** `notifications/messages.ts:226-259`
**Status:** Not applied — left as-is.
**Reason:** This finding is Info-tier and outside the `critical_warning` fix scope for this run. It was also evaluated as a candidate "trivial parity fix," but the review itself flags a genuine ambiguity: an empty-content NIP-17 rumor could be a legitimate attachment-only message, in which case adding the guard would silently drop a real notification the NIP-04 path was never exposed to (NIP-04 has no attachment concept). Changing user-visible notification behavior without confirming intent first is not "safe" in the sense required to apply it opportunistically here. Left for a human/product decision as the review itself recommends ("Confirm intent first").

## Verification

- `bun test`: 77 pass, 0 fail (74 pre-existing + 3 new: 1 for WR-01 bounded eviction, 2 for WR-02/CR-01 seed-failure contract)
- `bun run lint` (`tsc --noEmit`): clean, no errors
- D4-05 (no reconnect/degraded hint on gift-wrap decrypt failure) untouched — `notifications/messages.ts`'s NIP-17 `catchError` block was not modified
- NIP-04 path and `const.ts` untouched, per instructions

---

_Fixed: 2026-07-10T16:36:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
