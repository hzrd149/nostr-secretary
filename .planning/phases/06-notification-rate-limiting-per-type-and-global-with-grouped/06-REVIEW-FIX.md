---
phase: 06-notification-rate-limiting-per-type-and-global-with-grouped
fixed_at: 2026-07-10T21:52:00Z
review_path: .planning/phases/06-notification-rate-limiting-per-type-and-global-with-grouped/06-REVIEW.md
iteration: 2
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 06: Code Review Fix Report (iteration 2)

**Fixed at:** 2026-07-10T21:52:00Z
**Source review:** .planning/phases/06-notification-rate-limiting-per-type-and-global-with-grouped/06-REVIEW.md
**Iteration:** 2

**Summary:**
- Findings in scope: 1 (CR-01, iteration 2)
- Fixed: 1
- Skipped: 0

`bun test` (154 pass, 0 fail -- 149 pre-existing + 5 new) and `bun run lint` (`tsc --noEmit`, 0 errors) both green after the fix.

## Fixed Issues

### CR-01 (iteration 2): `rateLimit.window = 0` still fully defeats per-notification rate limiting -- `evaluate()` reads the raw, unclamped `config.rateLimit.window`

**Files modified:** `services/rate-limit-accounting.ts`, `services/rate-limit.ts`, `services/config.ts`, `helpers/preferences.ts`, `tests/services/rate-limit.test.ts`, `tests/services/config.test.ts`, `tests/helpers/preferences.test.ts`
**Commit:** `1a9272a`
**Applied fix:**

The iteration-1 fix (`ea47774`) applied `clampWindowSeconds` only inside the flush-timer's RxJS pipe. `rateLimitedNotify` -- the actual per-notification gate on all 5 call sites -- read `config.rateLimit` raw from `getConfig()`, so a `window: 0` reaching config from *any* surface silently disabled rate limiting entirely (`rollIfExpired`'s `now - windowStart < windowSeconds` is false on essentially every call at `windowSeconds === 0`, resetting state to all-zero before every check).

Per the review's required fix, the window is now clamped at the **config-normalization source** so a degenerate value can never enter `config$` in the first place, plus a defensive belt-and-suspenders clamp at the call site:

- **Moved `MIN_WINDOW_SECONDS`/`MAX_WINDOW_SECONDS`/`clampWindowSeconds` from `services/rate-limit.ts` into the zero-dependency `services/rate-limit-accounting.ts`.** `services/rate-limit.ts` re-exports them for its existing callers (the flush timer, `pages/notifications.tsx`, tests) unchanged. This relocation was necessary (not cosmetic): `services/rate-limit.ts` imports `configValue`/`getConfig` from `services/config.ts` and runs a top-level flush-timer subscription at import time that reads `config$` -- if `services/config.ts` imported `clampWindowSeconds` back from `services/rate-limit.ts`, it would create a circular module dependency that crashes at startup (`config$` would still be in its temporal-dead-zone when `rate-limit.ts`'s top-level subscription tries to read it). `rate-limit-accounting.ts` has zero imports, so both `config.ts` and `helpers/preferences.ts` can safely import the clamp from there.
- **`services/config.ts#migrateConfig`:** an accepted numeric `rateLimit.window` (including an explicit `0`, one that already passes the existing `isValidNonNegativeNumber` guard) is now additionally passed through `clampWindowSeconds`, so `0`/negative-already-rejected/excessively-large values can never survive a hand-edited or legacy `config.json`. A missing/invalid window still falls back to `DEFAULT_RATE_LIMIT_CONFIG.window` (60s, already in-range) -- this is a no-op for that path, so all pre-existing WR-03 tests (NaN/negative -> default) needed no changes.
- **`helpers/preferences.ts#asRateLimit`:** `window: clampWindowSeconds(asNonNegativeInt(source.window, DEFAULT_RATE_LIMIT_CONFIG.window))` -- the synced/NIP-78 surface (explicitly documented as untrusted/interop-facing) now clamps on top of the existing `asNonNegativeInt` coercion, so a peer device or third-party app publishing `rateLimit.window: 0` can no longer disable this device's rate limiting via `mergePrefs`/`updateConfig`. All pre-existing tests needed no changes (fallback default and in-range values are unaffected by the added clamp).
- **`services/rate-limit.ts#rateLimitedNotify`:** defensive (belt-and-suspenders, per the review's "MAY") re-clamp immediately before `evaluate()`: `evaluate(state, type, effectiveNow, { ...rateLimit, window: clampWindowSeconds(rateLimit.window) })`. Not required for correctness given the source-level fixes above, but keeps this choke point correct even against a hypothetical future input surface that forgets to clamp.

**New regression tests (WR-04-style, this iteration's requirement):**
- `tests/services/config.test.ts`: `migrateConfig({ rateLimit: { window: 0, ... } })` clamps to `MIN_WINDOW_SECONDS`, plus an end-to-end `evaluate()` loop proving 1-of-10 delivered (not 10-of-10) using the migrated config.
- `tests/helpers/preferences.test.ts`: `sanitizeSyncedPrefs`/`mergePrefs` with a synced `rateLimit.window: 0` payload clamps to `MIN_WINDOW_SECONDS`, plus the same 1-of-10 `evaluate()` proof against the merged config.
- `tests/services/rate-limit.test.ts`: a direct `rateLimitedNotify` test that writes `window: 0` straight to `config$` (bypassing both source-level clamps, to exercise `rateLimitedNotify`'s own defensive clamp) and confirms 1-of-10 delivered.

All three "still works" tests reproduce the review's exact repro shape (10 sequential calls at `window: 0`, `global: 1`/`perType.replies: 1`) and assert `delivered === 1`, `!== 10`.

`bun test`: 154 pass / 0 fail (149 pre-existing + 5 new). `bun run lint` (`tsc --noEmit`): 0 errors.

## Skipped Issues

None -- the single in-scope Critical finding was fixed.

---

_Fixed: 2026-07-10T21:52:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
