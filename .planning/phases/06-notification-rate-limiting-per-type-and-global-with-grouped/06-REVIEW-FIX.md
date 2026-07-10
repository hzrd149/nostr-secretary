---
phase: 06-notification-rate-limiting-per-type-and-global-with-grouped
fixed_at: 2026-07-10T00:00:00Z
review_path: .planning/phases/06-notification-rate-limiting-per-type-and-global-with-grouped/06-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 06: Code Review Fix Report

**Fixed at:** 2026-07-10
**Source review:** .planning/phases/06-notification-rate-limiting-per-type-and-global-with-grouped/06-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (CR-01, CR-02, WR-01, WR-02, WR-03, WR-04)
- Fixed: 6
- Skipped: 0

`bun test` (149 pass, 0 fail -- 140 pre-existing + 9 new) and `bun run lint` (`tsc --noEmit`, 0 errors) both green after all fixes.

## Fixed Issues

### CR-01: Flush timer restarts (and can be starved indefinitely) on any unrelated config write

**Files modified:** `services/rate-limit.ts`
**Commit:** `ea47774`
**Applied fix:** The flush timer's pipe now projects `configValue("rateLimit")` through `clampWindowSeconds(cfg.window)` and `distinctUntilChanged()` before `switchMap(...interval(window * 1000))`, so `switchMap` only re-runs (restarting the interval) when the *effective* window actually changes -- not on every `config$.next()` from unrelated settings surfaces (replies/zaps/messages/groups toggles, whitelist/blacklist edits, `/config` page, NIP-78 preference sync).

Committed together with CR-02/WR-01/WR-02 (see note below) since the review's own fix snippets for all four overlap on the same ~5-line timer pipe -- shipping any one without the others leaves the busy-loop/restart-storm class of bug only half-fixed.

### CR-02: `rateLimit.window = 0` turns the flush timer into an unbounded busy loop

**Files modified:** `services/rate-limit.ts`, `pages/notifications.tsx`
**Commit:** `ea47774`
**Applied fix:**
- Added `MIN_WINDOW_SECONDS = 1`, `MAX_WINDOW_SECONDS = 86400`, and `clampWindowSeconds()` (floors/ceils, treats non-finite as MIN) to `services/rate-limit.ts`, applied at the point the flush timer's interval is constructed -- so a degenerate `window` (0, negative, NaN) from *any* input surface can never reach `interval()`.
- `pages/notifications.tsx`: PATCH handler now clamps the incoming `rateLimitWindow` into `[MIN_WINDOW_SECONDS, MAX_WINDOW_SECONDS]` instead of only checking `>= 0`.
- UI: input `min` changed from `"0"` to `MIN_WINDOW_SECONDS` (and added `max={MAX_WINDOW_SECONDS}`); help text corrected to explicitly state window does NOT support "0 = unlimited" (that semantic is preserved, unchanged, for `global`/`perType` only).

### WR-01: `runFlush()`'s real-timer invocation has no error handling

**Files modified:** `services/rate-limit.ts`
**Commit:** `ea47774`
**Applied fix:** `.subscribe(() => { void runFlush(); })` replaced with `.subscribe(() => { runFlush().catch((error) => log("Failed to deliver grouped overflow summary", { error: ... })); })` -- matches the review's suggested fix verbatim, using the project's `log()` (never `console.log`).

### WR-02: No upper bound on `rateLimit.window`

**Files modified:** `services/rate-limit.ts`, `pages/notifications.tsx`
**Commit:** `ea47774`
**Applied fix:** `clampWindowSeconds`'s ceiling (`MAX_WINDOW_SECONDS = 86400`, 1 day) is enforced both centrally (in the flush-timer pipe, defense in depth against any input surface) and in the PATCH handler directly, plus the UI `max` attribute. Prevents `window * 1000` from ever reaching a value near/above the 32-bit signed `setTimeout` delay ceiling.

### WR-03: `migrateConfig`'s rateLimit backfill doesn't validate finiteness or non-negativity

**Files modified:** `services/config.ts`
**Commit:** `66e7b09`
**Applied fix:** Replaced the bare `typeof x !== "number"` checks for `window`, `global`, and each `perType[key]` with a local `isValidNonNegativeNumber` guard (`typeof v === "number" && Number.isFinite(v) && v >= 0`) -- the same shape as `helpers/preferences.ts`'s `asNonNegativeInt` and the PATCH route's inline check, per the review's suggested fix. All three rateLimit input surfaces (config file load, NIP-78 sync, PATCH) now reject NaN/negative values identically.

### WR-04: No regression test coverage for `window = 0` / degenerate window values

**Files modified:** `tests/services/rate-limit.test.ts`, `tests/services/config.test.ts`
**Commit:** `387aa79`
**Applied fix:**
- Added a `clampWindowSeconds` describe block (7 cases: `0`, negative, `NaN`, `Infinity`, an excessively large value, an ordinary in-range value, and both inclusive bounds) testing the pure clamp function directly and deterministically -- no reliance on real `interval()`/930-tick/sec timing, per the review's own preference.
- Added two `migrateConfig` cases in `config.test.ts` asserting `NaN` and negative `window`/`global`/`perType` values are backfilled to defaults rather than passed through (WR-03 regression coverage).
- Full suite: 149 pass / 0 fail (140 pre-existing + 9 new).

## Skipped Issues

None. IN-01 (`resetRateLimitState` unguarded export) is Info-severity and out of the `critical_warning` fix scope for this iteration -- left as-is per the review's own "not blocking" assessment; no action taken.

---

_Fixed: 2026-07-10_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
