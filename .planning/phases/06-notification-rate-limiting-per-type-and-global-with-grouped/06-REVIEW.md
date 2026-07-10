---
phase: 06-notification-rate-limiting-per-type-and-global-with-grouped
reviewed: 2026-07-10T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - services/rate-limit-accounting.ts
  - services/rate-limit.ts
  - services/config.ts
  - helpers/preferences.ts
  - tests/services/rate-limit.test.ts
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Phase 06: Code Review Report (Final Re-Review, Iteration 3)

**Reviewed:** 2026-07-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** clean

## Summary

This is a targeted final re-review verifying the iteration-2 Critical fix (commit `1a9272a`): a degenerate `rateLimit.window` (0/negative/NaN/excessive) reaching `evaluate()` unclamped and silently disabling rate limiting. `clampWindowSeconds`/`MIN_WINDOW_SECONDS`/`MAX_WINDOW_SECONDS` now live in the zero-dependency `services/rate-limit-accounting.ts` and are applied at all window-bearing input surfaces. `bun test` (154 pass, 0 fail) and `bun run lint` (`tsc --noEmit`, clean) were both run directly and are green.

**Entry-point audit** — traced every path that can populate `config.rateLimit.window` or that reads it before `evaluate()`:

1. **Disk config load / migration** (`services/config.ts#migrateConfig`, lines 300-334): a present-but-invalid (NaN/negative/non-number) `window` falls back to `DEFAULT_RATE_LIMIT_CONFIG.window` (60s, already in-range); a present-and-valid-but-degenerate `window` (including exactly `0`, or an excessively large value) is passed through `clampWindowSeconds`. Correct and idempotent — verified against `tests/services/config.test.ts`'s CR-01-iteration-2 tests, which drive 10 sequential `evaluate()` calls through the migrated config and assert `delivered === 1`, not merely that the field equals `MIN_WINDOW_SECONDS`.
2. **NIP-78 sync** (`helpers/preferences.ts#asRateLimit`, lines 219-251): `window` is coerced via `asNonNegativeInt` then `clampWindowSeconds`. Confirmed the actual sync consumer (`services/preferences.ts` lines 233-251) always calls `sanitizeSyncedPrefs` (which invokes `asRateLimit`) *before* `mergePrefs` — there is no code path where a raw/unsanitized sync payload reaches `mergePrefs` directly, so this clamp cannot be bypassed on the sync surface.
3. **Direct `rateLimitedNotify` call site** (`services/rate-limit.ts` lines 108-113): defensively re-clamps `rateLimit.window` immediately before `evaluate()`, belt-and-suspenders per the file's own comment, so this choke point is correct even against a hypothetical future input surface that forgets to clamp.
4. **Flush timer** (`services/rate-limit.ts` lines 163-168): keys `switchMap`/`distinctUntilChanged` on `clampWindowSeconds(cfg.window)`, so the effective (never raw) window drives the interval, and an unrelated config write or a merely-invalid-but-unchanged raw window never spuriously restarts the timer.
5. **Fresh-install default** (`services/config.ts`'s `config$` `BehaviorSubject` seed, line 146): uses `DEFAULT_RATE_LIMIT_CONFIG` (`window: 60`) directly — a hardcoded, already in-range literal that is never user-controlled and never passes through `migrateConfig`, so it correctly requires no clamp.
6. **PATCH `/notifications`** (`pages/notifications.tsx`, outside this iteration's reviewed file list but traced for completeness since it's a real input surface): manually clamps the submitted window into `[MIN_WINDOW_SECONDS, MAX_WINDOW_SECONDS]` using the same bounds constants (re-exported from `services/rate-limit.ts`) before merging into `config$`. Functionally equivalent to `clampWindowSeconds`, just duplicated inline rather than calling the shared function directly — a minor DRY observation, not a correctness gap, and since the file is outside this review's scope it is not filed as a numbered/counted finding.

No unclamped path to `evaluate()`/`rollIfExpired()` was found in the reviewed files.

**Circular-import check:** `services/rate-limit-accounting.ts` has zero imports (confirmed by reading the full file — no imports at all). `services/config.ts` imports only `clampWindowSeconds` from it. `helpers/preferences.ts` imports only `clampWindowSeconds` from it (plus types/`DEFAULT_RATE_LIMIT_CONFIG` from `services/config.ts`, unrelated to this concern). `services/rate-limit.ts` imports from both `services/config.ts` (`configValue`/`getConfig`) and `services/rate-limit-accounting.ts`, and re-exports the clamp/bounds for its own existing callers. This is a clean one-way dependency graph (`rate-limit-accounting.ts` ← `config.ts` / `preferences.ts` / `rate-limit.ts`) with no cycle and no top-level-execution-order hazard: `config.ts`'s top-level `await fs.exists`/`migrateConfig` work fully completes before `rate-limit.ts`'s module body (which depends on `config.ts`'s exports) begins executing, per normal ES module load-order guarantees — moving the clamp into the zero-dependency module avoided the circularity cleanly.

**Invariants re-verified untouched:**
- **D6-06** (flush bypasses `rateLimitedNotify`): `runFlush` calls `effectiveSend` directly (services/rate-limit.ts:147), never `rateLimitedNotify`. The test `runFlush -- bypasses rateLimitedNotify entirely (D6-06)` (rate-limit.test.ts:243-276) proves the summary still fires while the per-type bucket remains saturated.
- **D6-10** (counts-only summary): `RateLimitState.overflow` / `formatOverflowSummary` in rate-limit-accounting.ts remain structurally `Record<NotificationType, number>` plus static `TYPE_LABELS` — no path for event/DM plaintext to enter the summary. Unchanged by this fix.
- **Single-summary-per-window + reset:** `flushOverflow` unconditionally calls `createRateLimitState(now)` regardless of whether anything overflowed. Unchanged.
- **5 call-site swaps / `shouldNotify` / `sendContent`:** confirmed via grep that `notifications/{replies,zaps,messages(x2),groups}.ts` all still call `rateLimitedNotify`; none reverted to a direct `sendNotification` call. `shouldNotify`/`sendContent` logic lives entirely outside the 5 files touched by this fix and was not modified.

**Test quality check:** the CR-01-iteration-2 regression tests are not merely assertions against `clampWindowSeconds` in isolation. Each of the three surface-specific tests (`tests/services/rate-limit.test.ts:210-241`, `tests/services/config.test.ts`'s "migrateConfig's clamped window:0 config actually prevents evaluate() from resetting state on every call" test, and `tests/helpers/preferences.test.ts`'s "after mergePrefs applies a synced window:0 payload, evaluate() still rate-limits" test) drives 10 sequential `evaluate()`/`rateLimitedNotify()` calls through the actual clamped config produced by that surface (a directly-mutated `config$.rateLimit.window: 0`, `migrateConfig({...})`, and `mergePrefs(makeConfig(), sanitizeSyncedPrefs({...}))` respectively) and asserts `delivered === 1` (not `10`) — a genuine behavioral proof that the clamp takes effect end-to-end at each surface, not a unit test of the clamp function alone.

No Critical or Warning findings remain in the reviewed file set. All reviewed files meet quality standards.

---

_Reviewed: 2026-07-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
