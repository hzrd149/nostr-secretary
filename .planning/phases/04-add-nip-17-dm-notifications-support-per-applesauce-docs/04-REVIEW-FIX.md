---
phase: 04-add-nip-17-dm-notifications-support-per-applesauce-docs
fixed_at: 2026-07-10T17:20:00Z
review_path: .planning/phases/04-add-nip-17-dm-notifications-support-per-applesauce-docs/04-REVIEW.md
iteration: 2
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 04: Code Review Fix Report (Iteration 2)

**Fixed at:** 2026-07-10T17:20:00Z
**Source review:** .planning/phases/04-add-nip-17-dm-notifications-support-per-applesauce-docs/04-REVIEW.md
**Iteration:** 2

**Summary:**
- Findings in scope (critical + warning): 1 (CR-01)
- Fixed: 1
- Skipped: 0

CR-01 was the only Critical/Warning finding in this iteration's re-review (iteration 1's CR-01/WR-01/WR-02/WR-03 were already fixed and committed as `34dcf04`). It was fixed in a single atomic commit `d677930`, which also folds in both Info-tier items (IN-01, IN-02) because they are inseparable from the CR-01 change: IN-01 (misleading "backoff" doc comment) describes the exact retry mechanism CR-01 replaced, and IN-02 (flaky wall-clock test) is the same test file/scenario being rewritten to cover CR-01's new self-healing contract. Splitting these into separate commits would have left an intermediate commit with either a still-inaccurate doc comment describing the *new* retry code, or a test that doesn't yet exist to be made deterministic.

## Fixed Issues

### CR-01: Seed-failure fail-closed state has no self-healing recovery path — a transient relay hiccup can permanently silence NIP-17 DM notifications for the rest of the session

**Files modified:** `helpers/gift-wrap-subscription.ts`, `services/nostr.ts`, `tests/helpers/gift-wrap-subscription.test.ts`
**Commit:** `d677930`
**Applied fix:**

Replaced the iteration-1 "bounded retry then latch `seedFailed` forever" design with a self-healing one in `seededGiftWraps`:

1. **Unbounded retry, capped exponential backoff.** The seed pipeline no longer has a `catchError`/give-up path. `retry({ delay: (error, attempt) => timer(min(retryDelay * 2**(attempt-1), maxRetryDelay)) })` retries forever; a failing seed just keeps backing off (2s, 4s, 8s, ... capped at 60s by default) instead of terminating after a fixed count. This also fixes IN-01: the backoff is now real (exponential-with-cap), matching the doc comment, instead of a fixed delay mislabeled as "backoff."
2. **Latch on success, not on failure.** A `seeded` flag (default `false`) is flipped to `true` only inside a `tap({ complete: ... })` attached directly to `seedRequest$`, which fires exclusively when a seed attempt completes without erroring. The final `filter(() => seeded)` (replacing the old `filter(() => !seedFailed)`) suppresses every `live$` emission — including its un-deduped historical-backlog burst (Pitfall 1) — until `seeded` flips true, and it can only flip once (RxJS `concat` never resubscribes to `seed$` after it completes), after which it stays true for the rest of the subscription.
3. **Self-healing, no switchMap dependency.** Because `seeded` is driven purely by the seed's own success/failure, not by any external re-subscription signal, the pipeline recovers automatically the instant a retry succeeds — whether that's because a slow relay responded on attempt 2, or because a fully-down relay set came back after several minutes of capped backoff. `services/nostr.ts`'s `giftWraps$` wiring is unchanged in structure (still calls `seededGiftWraps(seedRequest$, live$, { onSeedFailure })`) but the doc comment there was rewritten to describe the new self-healing contract instead of the old "fails closed until the next switchMap re-fire" one.
4. **Per-attempt failure callback with caller-side throttling.** `onSeedFailure` now receives `(error, attempt)` on every failed attempt (previously only once, on final give-up, since there was no "final" anymore). `services/nostr.ts` throttles its own `log(...)` call to attempt 1 and every 5th attempt after that, so a persistently down relay logs periodically rather than once per (now-unbounded) retry.

**Preserved, unchanged:** the bounded-FIFO `seen` cap (`DEFAULT_MAX_SEEN = 5_000`, `remember()`'s oldest-eviction logic) and D4-05 (no `nip04DecryptDegraded$`-style reconnect hint was added for the NIP-17 path — `notifications/messages.ts` was not touched).

**Tests:**
- Rewrote the `seededGiftWraps` describe block (`tests/helpers/gift-wrap-subscription.test.ts`) for the new contract:
  - `"while the seed keeps failing, live$'s backlog burst is NOT emitted -- no mass re-notification"` — a permanently-failing seed never lets `live$`'s resent historical wrap through, and the failure callback fires with the underlying error.
  - `"after repeated seed failures, a later success does NOT mass-notify the backlog AND live notifications resume -- self-healing"` — a seed that fails 4 times then succeeds on the 5th attempt: (a) suppresses `live$`'s resent historical backlog while still failing, (b) once the seed succeeds, dedups that same historical wrap on a later resend, and (c) still notifies a genuinely new wrap — proving both "no mass re-notification" and "self-healing resumption" in one deterministic test.
- Fixed IN-02: the new tests use `retryDelay: 0, maxRetryDelay: 0` (fast, no real backoff wait) and, instead of the old fixed `setTimeout(resolve, 20)` wall-clock guess, the recovery test awaits a `Promise` that is resolved from inside the seed's own success-branch `tap({ complete })` callback — i.e. it waits for the exact event ("the seed just succeeded"), not an assumed elapsed duration. This removes the CI-flakiness risk the wall-clock wait could have introduced under a slow runner.

**Verification:**
- `bun test`: 77 pass, 0 fail (same count as before — 2 iteration-1 `seededGiftWraps` tests were rewritten in place rather than added alongside, since they tested the now-removed bounded-retry contract)
- `bun run lint` (`tsc --noEmit`): clean, no errors
- Manually re-read both modified source files in full after editing to confirm no corruption and that the fail-closed/self-heal invariants hold as designed (concat ordering, tap-before-retry placement so `seeded` only latches on a true success, filter placement downstream of `notifyNewGiftWraps`)

## Info items (both fixed, bundled into the CR-01 commit — see rationale above)

### IN-01: "Retries the seed with backoff" is inaccurate — the retry delay is fixed, not exponential

**Status:** Fixed as part of `d677930`. `retryDelay` now doubles per attempt (`retryDelay * 2 ** (attempt - 1)`), capped at `maxRetryDelay` (default 60s) — real exponential backoff, matching the doc comment, which was also reworded to be precise about the doubling/cap behavior.

### IN-02: Transient-recovery test relies on a real 20ms `setTimeout` wall-clock wait

**Status:** Fixed as part of `d677930`. The rewritten recovery test awaits a promise resolved from the seed's own successful-completion callback rather than a fixed wall-clock delay guess (see Tests section above).

## Verification (overall)

- `bun test`: 77 pass, 0 fail
- `bun run lint` (`tsc --noEmit`): clean
- D4-05 untouched — `notifications/messages.ts` not modified
- NIP-04 path and `const.ts` untouched, per instructions
- All work performed in an isolated git worktree (`gsd-reviewfix/04-*`), fast-forward-merged into `master` after the fix commit, then cleaned up (worktree removed, temp branch deleted, recovery sentinel removed)

---

_Fixed: 2026-07-10T17:20:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
