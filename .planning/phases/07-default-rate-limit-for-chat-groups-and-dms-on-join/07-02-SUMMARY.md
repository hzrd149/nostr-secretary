---
phase: 07-default-rate-limit-for-chat-groups-and-dms-on-join
plan: 02
subsystem: config
tags: [config, nip-78, sync, rate-limiting, bun-test]

# Dependency graph
requires:
  - phase: 07-default-rate-limit-for-chat-groups-and-dms-on-join
    provides: "The pure evaluate()/RateLimitConfig.perGroup/.perDm accounting core in services/rate-limit-accounting.ts (Plan 01)."
provides:
  - "AppConfig.rateLimit.perGroup/.perDm -- top-level scalar defaults (3/5), migrated defensively (explicit 0 preserved, invalid backfilled)."
  - "SyncedPrefs.rateLimit.perGroup/.perDm -- serialized field-by-field, sanitized via per-field asNonNegativeInt, absent -> local defaults never 0."
  - "PREFS_VERSION bumped 3 -> 4 as a forward-compat marker."
  - "CHANGELOG entry documenting the new defaults, the additive behavior change, and the 0 = unlimited escape hatch."
affects: [07-03-rate-limit-shell-threading, 07-04-ui-fields]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "perGroup/perDm reuse the EXACT existing global/perType migration + sync patterns verbatim -- no new clamp constant (0 is a safe unlimited sentinel for these fields, unlike window)"
    - "asRateLimit's absent-key fallback (Pitfall 6) now also covers perGroup/perDm: a pre-Phase-7 peer's rateLimit object (present but missing these two keys) falls back to local defaults, never 0"

key-files:
  created: []
  modified:
    - services/config.ts
    - helpers/preferences.ts
    - tests/services/config.test.ts
    - tests/helpers/preferences.test.ts
    - tests/services/rate-limit.test.ts
    - CHANGELOG.md

key-decisions:
  - "perGroup/perDm defaults (3/5) live on DEFAULT_RATE_LIMIT_CONFIG as the single source of truth consumed by config seed, migrateConfig, and asRateLimit's fallback (per plan's key_links)."
  - "No new clamp-bounds constant for perGroup/perDm (unlike window) -- 0 has no arithmetic hazard for these fields, matching Plan 01's rate-limit-accounting.ts decision."
  - "mergePrefs' existing rateLimit: { ...current, ...incoming } spread required no change -- it propagates perGroup/perDm for free once SyncedPrefs and asRateLimit carry them."

patterns-established: []

requirements-completed: [D7-05, D7-06, D7-09]

coverage:
  - id: D1
    description: "A fresh config seeds rateLimit.perGroup === 3 and rateLimit.perDm === 5 (D7-06)"
    requirement: "D7-06"
    verification:
      - kind: unit
        ref: "tests/services/config.test.ts#services/config DEFAULT_RATE_LIMIT_CONFIG (D6-07/D6-09) > a fresh config$ value seeds rateLimit.perGroup === 3 and rateLimit.perDm === 5 (D7-05/D7-06)"
        status: pass
    human_judgment: false
  - id: D2
    description: "migrateConfig backfills a missing/null/malformed perGroup/perDm with the local default, is idempotent, and preserves an explicit 0 (D7-05)"
    requirement: "D7-05"
    verification:
      - kind: unit
        ref: "tests/services/config.test.ts#services/config migrateConfig rateLimit backfill (D6-07/D6-09) > D7-05/D7-06: migrateConfig backfills missing perGroup/perDm with the defaults"
        status: pass
      - kind: unit
        ref: "tests/services/config.test.ts#services/config migrateConfig rateLimit backfill (D6-07/D6-09) > D7-05/D7-06: migrateConfig coerces a negative/NaN/string perGroup/perDm to the default"
        status: pass
      - kind: unit
        ref: "tests/services/config.test.ts#services/config migrateConfig rateLimit backfill (D6-07/D6-09) > preserves an explicit 0 in a stored rateLimit -- 0 is valid 'unlimited', not missing"
        status: pass
    human_judgment: false
  - id: D3
    description: "perGroup/perDm serialize into the kind-30078 SyncedPrefs payload and round-trip back through asRateLimit/sanitize/merge (D7-05)"
    requirement: "D7-05"
    verification:
      - kind: unit
        ref: "tests/helpers/preferences.test.ts#sanitizeSyncedPrefs rateLimit (D6-07 / RESEARCH Pitfall 6) > serialize -> sanitize -> merge round-trips rateLimit, including perGroup/perDm (D7-05)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A pre-Phase-7 peer's synced payload (no perGroup/perDm keys) falls back to the LOCAL defaults, never 0 (Pitfall 6, D7-05)"
    requirement: "D7-05"
    verification:
      - kind: unit
        ref: "tests/helpers/preferences.test.ts#sanitizeSyncedPrefs rateLimit (D6-07 / RESEARCH Pitfall 6) > a pre-Phase-7 peer's rateLimit (present, but no perGroup/perDm keys) falls back to LOCAL defaults, never 0 (Pitfall 6, D7-05)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A malformed decrypted perGroup/perDm (negative/NaN/string) is coerced per-field via asNonNegativeInt, never passed through a wholesale spread (ASVS V5)"
    requirement: "D7-05"
    verification:
      - kind: unit
        ref: "tests/helpers/preferences.test.ts#sanitizeSyncedPrefs rateLimit (D6-07 / RESEARCH Pitfall 6) > D7-05: coerces a malformed perGroup/perDm (negative/NaN/string) per-field, preserving an explicit 0"
        status: pass
    human_judgment: false
  - id: D6
    description: "PREFS_VERSION is bumped to 4 as a forward-compat marker (D7-05)"
    requirement: "D7-05"
    verification:
      - kind: unit
        ref: "tests/helpers/preferences.test.ts#sanitizeSyncedPrefs > sets version === PREFS_VERSION on a payload with no version field"
        status: pass
    human_judgment: false
  - id: D7
    description: "CHANGELOG documents the new per-group (3) / per-DM (5) default limits, the additive behavior change, and the 0 = unlimited escape hatch (Pitfall 5)"
    requirement: "D7-09"
    verification:
      - kind: other
        ref: "grep -iq 'per-group' CHANGELOG.md && grep -iq 'per-dm' CHANGELOG.md && grep -iq '0.*unlimited' CHANGELOG.md"
        status: pass
    human_judgment: false

# Metrics
duration: 10min
completed: 2026-07-13
status: complete
---

# Phase 7 Plan 02: Config + NIP-78 Sync for Default Per-Context Rate Limits Summary

**Extended `AppConfig.rateLimit`/`DEFAULT_RATE_LIMIT_CONFIG`/`migrateConfig` and `SyncedPrefs`/`serializePrefs`/`asRateLimit` with top-level `perGroup`(3)/`perDm`(5) scalar defaults, bumped `PREFS_VERSION` to 4, and documented the additive behavior change in CHANGELOG.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-07-13T21:42:32Z
- **Completed:** 2026-07-13T21:52:00Z
- **Tasks:** 3
- **Files modified:** 6 (5 planned + 1 deviation)

## Accomplishments
- `AppConfig.rateLimit.perGroup`/`.perDm` -- top-level scalar siblings of `perType` (NOT nested inside it), default 3/5, documented "0 = unlimited."
- `DEFAULT_RATE_LIMIT_CONFIG.perGroup = 3`/`.perDm = 5` -- the single source of truth consumed by config seed, `migrateConfig`, and `asRateLimit`'s absent-key fallback.
- `migrateConfig`'s existing rateLimit backfill block gained two lines mirroring the `global` backfill exactly (reusing `isValidNonNegativeNumber`, no new clamp constant) -- defensively backfills missing/invalid `perGroup`/`perDm`, preserves an explicit `0`.
- `SyncedPrefs.rateLimit.perGroup`/`.perDm` -- serialized field-by-field in `serializePrefs` (no wholesale spread), coerced field-by-field in `asRateLimit` via `asNonNegativeInt(source.X, DEFAULT_RATE_LIMIT_CONFIG.X)` -- absent (pre-Phase-7 peer payload) falls back to local defaults, never 0 (Pitfall 6). `mergePrefs`'s existing `{ ...current.rateLimit, ...incoming.rateLimit }` spread required no change.
- `PREFS_VERSION` bumped 3 -> 4, extending the existing forward-compat-marker comment convention.
- CHANGELOG `## Unreleased` documents the new 3/min-per-group, 5/min-per-DM defaults, layered on the existing per-type/global limits, with a Behavior-change note and the `0 = unlimited` escape hatch.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add perGroup/perDm to AppConfig.rateLimit + defaults + migration** - `1b12b9b` (feat)
2. **Task 2: Sync perGroup/perDm through SyncedPrefs + serialize + asRateLimit + PREFS_VERSION bump** - `a7bca23` (feat)
3. **Task 3: Document the per-context default limits in CHANGELOG** - `61434ed` (docs)

_Note: Task 2's commit also includes a fix to `tests/services/rate-limit.test.ts` (see Deviations)._

## Files Created/Modified
- `services/config.ts` - `AppConfig["rateLimit"].perGroup`/`.perDm`, `DEFAULT_RATE_LIMIT_CONFIG.perGroup`/`.perDm`, `migrateConfig` backfill lines.
- `helpers/preferences.ts` - `SyncedPrefs["rateLimit"].perGroup`/`.perDm`, `serializePrefs` additions, `asRateLimit` coercion lines, `PREFS_VERSION = 4`.
- `tests/services/config.test.ts` - Fresh-config defaults, backfill-on-missing, coercion-on-negative/NaN/string, explicit-0-preserved, idempotency cases for perGroup/perDm.
- `tests/helpers/preferences.test.ts` - `makeConfig` fixture extended with perGroup/perDm; serialize/round-trip/old-peer-fallback/malformed-coercion/PREFS_VERSION=4 cases.
- `tests/services/rate-limit.test.ts` - `setRateLimit()` literal fixtures extended with `perGroup`/`perDm` (deviation, see below).
- `CHANGELOG.md` - New Unreleased bullet + Behavior-change note for the default per-group/per-DM rate limits.

## Decisions Made
- `perGroup`/`perDm` reuse the EXACT existing `global`/`perType.*` migration + sync patterns verbatim (D7-09) -- no new clamp constant, since 0 has no arithmetic hazard for these fields (unlike `window`).
- `PREFS_VERSION`'s bump is a forward-compat marker only -- `asRateLimit`'s fallback keys off the ABSENCE of the `perGroup`/`perDm` keys, not the version number, consistent with the 2->3 and 3->4 pattern already established.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed pre-existing type errors in tests/services/rate-limit.test.ts from AppConfig.rateLimit widening**
- **Found during:** Task 2 (running `bun run lint` after the SyncedPrefs/config type widening)
- **Issue:** `tests/services/rate-limit.test.ts`'s `setRateLimit()` helper is typed `typeof DEFAULT_RATE_LIMIT_CONFIG`. Five call sites (lines ~100, ~121, ~155, ~218, ~246) pass object literals shaped like the pre-Phase-7 `AppConfig["rateLimit"]` (window/global/perType only), which no longer satisfy the type now that `perGroup`/`perDm` are required fields. This is exactly the "existing type errors from configs missing those fields" flagged by the orchestrator as expected to be resolved by this plan.
- **Fix:** Added `perGroup: DEFAULT_RATE_LIMIT_CONFIG.perGroup, perDm: DEFAULT_RATE_LIMIT_CONFIG.perDm` to each of the 5 literals. These tests exercise `replies`-type notifications with no `context` argument, so `perGroup`/`perDm` values are inert to the tested behavior -- purely a type-completeness fix, no behavior change.
- **Files modified:** tests/services/rate-limit.test.ts
- **Verification:** `bun run lint` (tsc --noEmit) clean; `bun test` 171/171 pass.
- **Committed in:** a7bca23 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking type error)
**Impact on plan:** Required to keep `bun run lint` clean given this plan's own required `AppConfig` widening; no scope creep, no behavior change beyond type-shape completeness.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `services/config.ts` and `helpers/preferences.ts` fully carry `perGroup`/`perDm` through seed, migration, sync serialize/sanitize/merge; `bun test` (171/171) and `bun run lint` (tsc --noEmit) are both clean at the wave-merge gate with Plan 01 landed.
- Plan 03 (rate-limit shell threading) can now read `getConfig().rateLimit.perGroup`/`.perDm` directly and thread an optional `context` argument into `rateLimitedNotify`/`evaluate()` without touching config/sync again.
- Plan 04 (UI fields) can add the two default-limit form fields against the now-complete `AppConfig.rateLimit` shape.
- No blockers.

---
*Phase: 07-default-rate-limit-for-chat-groups-and-dms-on-join*
*Completed: 2026-07-13*

## Self-Check: PASSED

- FOUND: services/config.ts
- FOUND: helpers/preferences.ts
- FOUND: tests/services/config.test.ts
- FOUND: tests/helpers/preferences.test.ts
- FOUND: tests/services/rate-limit.test.ts
- FOUND: CHANGELOG.md
- FOUND: 1b12b9b
- FOUND: a7bca23
- FOUND: 61434ed
