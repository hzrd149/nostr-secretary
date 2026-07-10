---
phase: 03-review-and-add-nip-04-dm-support-per-applesauce-docs
fixed_at: 2026-07-10T04:00:58Z
review_path: .planning/phases/03-review-and-add-nip-04-dm-support-per-applesauce-docs/03-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report

**Fixed at:** 2026-07-10T04:00:58Z
**Source review:** .planning/phases/03-review-and-add-nip-04-dm-support-per-applesauce-docs/03-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (WR-01, WR-02, WR-03, WR-04 -- `fix_scope: critical_warning`; there are 0 Critical/Blocker findings in this review, and Info findings IN-01..IN-04 were out of scope for this run)
- Fixed: 4
- Skipped: 0

`bun test` (65 pass / 0 fail, up from 58 pass at baseline) and `bun run lint` (`tsc --noEmit`, clean) were re-run after every individual fix and pass at the end of the run.

## Fixed Issues

### WR-01: Profile-lookup failures are misreported as NIP-04 decrypt-permission failures

**Files modified:** `notifications/messages.ts`
**Commit:** `b247484`
**Applied fix:** Scoped the shared `catchError` so it can only ever fire for an actual `unlockLegacyMessage` failure. The profile lookup (`getValue(eventStore.profile(sender).pipe(defined()))`) now has its own `.catch(() => undefined)`, so a profile-lookup timeout resolves to `profile: undefined` instead of throwing into the shared `catchError` -- it no longer sets `nip04DecryptDegraded$.next(true)` or triggers the "reconnect your signer" hint. Per-message isolation (one bad DM can't kill the subscription) and the reset-to-`false`-on-success behavior are both preserved. This logic was later relocated into the new `decryptLegacyDirectMessage` function as part of the WR-04 fix (commit `21ed3bb`), which is where the fix ultimately lives; the `.catch(() => undefined)` guard on the profile lookup was carried over unchanged into that extraction.

### WR-02: `catchError` handler itself can throw on a non-`Error` rejection, defeating the subscription-lifetime fix

**Files modified:** `notifications/messages.ts`
**Commit:** `597487e`
**Applied fix:** Replaced both `Reflect.get(error, "message") || "Unknown error"` call sites (the NIP-04 block and the NIP-17/gift-wrap block) with `error instanceof Error ? error.message : String(error)`, which can never itself throw regardless of what shape the rejection value is (object, string, `undefined`, etc.).

### WR-03: `migrateConfig()` doesn't guard a `null`/non-object top-level `groups` key

**Files modified:** `services/config.ts`, `tests/services/config.test.ts`
**Commit:** `cfbaedf`
**Applied fix:** Added a normalization step before the existing `groups.modes` backfill: `if (parsed.groups == null || typeof parsed.groups !== "object") parsed.groups = {};`. This guarantees `parsed.groups` is always an object before the `.modes` backfill runs, closing the path where a hand-edited `"groups": null` survived migration and later crashed on `groups.modes` indexing (e.g. `pages/notifications.tsx`). Added two regression tests to `tests/services/config.test.ts`'s `migrateConfig` describe block: one asserting a top-level `groups: null` normalizes to `{ modes: {} }`, and one asserting a fully-absent `groups` key backfills the same way. (Note: the `Array.isArray(parsed.groups.modes)` edge case from IN-04 was intentionally left as-is -- that finding is Info-severity and out of scope for this `critical_warning`-scoped run.)

### WR-04: New tests never exercise the actual wired subscription behavior added this phase

**Files modified:** `notifications/legacy-messages.ts` (new), `notifications/messages.ts`, `tests/notifications/legacy-messages.test.ts` (new)
**Commit:** `21ed3bb`
**Applied fix:** Followed the review's suggested approach: extracted the per-event decrypt-and-classify logic out of `notifications/messages.ts`'s inline `mergeMap` IIFE into a standalone, injectable function `decryptLegacyDirectMessage(event, pubkey, sender, signer, deps)` in a new module, `notifications/legacy-messages.ts`. This new module has **no top-level imports of any live singleton** (no `services/nostr`, no `eventStore`) -- `deps.getProfile` / `deps.unlock` / `deps.log` are always supplied explicitly by the caller, so importing this module in a test cannot trigger the network-side-effect-on-import problem that `tests/notifications/messages.test.ts`'s own precedent explicitly avoids (self-subscription happens in `services/nostr.ts` and `notifications/messages.ts`, neither of which this new module touches).

`notifications/messages.ts`'s NIP-04 `mergeMap` body now calls `decryptLegacyDirectMessage(...)` with the real `eventStore`/`getValue`-backed `getProfile`, and the `nip04DecryptDegraded$` set/reset side effects moved into a `.pipe(map(...), catchError(...))` immediately around the call, preserving identical externally-observable behavior (verified by the full `bun test` suite staying green with zero regressions, 60->65 passing as new tests were added incrementally across commits).

Added `tests/notifications/legacy-messages.test.ts` with 5 new tests exercising `decryptLegacyDirectMessage` directly with mocked `deps`, specifically targeting the exact WR-01 distinction the review called out:
- happy path (profile + content both resolve)
- a profile-lookup rejection resolves successfully with `profile: undefined` rather than throwing (the core WR-01 regression test)
- an actual decrypt failure (`deps.unlock` rejecting) does reject/propagate, so the caller's `catchError` is what should set `nip04DecryptDegraded$`
- both `getProfile` and `unlock` failing simultaneously still rejects with the *unlock* error specifically (proving the profile failure never masks or gets confused with a real decrypt failure)
- `unlock` resolving to empty content returns `undefined` without throwing

This directly closes the coverage gap WR-04 identified and would have caught WR-01 had it existed beforehand, per the review's own framing.

## Skipped Issues

None -- all 4 in-scope findings (WR-01 through WR-04) were fixed.

---

_Fixed: 2026-07-10T04:00:58Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
