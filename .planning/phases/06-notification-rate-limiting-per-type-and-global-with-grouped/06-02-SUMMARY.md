---
phase: 06-notification-rate-limiting-per-type-and-global-with-grouped
plan: 02
subsystem: notifications
tags: [config, sync, migration, kind-30078, nip-44, rate-limiting]

requires:
  - phase: 05-dm-notification-category-split
    provides: migrateConfig defensive-backfill pattern (groups.modes / messages split) and the SyncedPrefs sync-extension pattern this plan mirrors
provides:
  - AppConfig.rateLimit field (window/global/perType) + exported DEFAULT_RATE_LIMIT_CONFIG anti-spam defaults
  - migrateConfig defensive, idempotent rateLimit backfill (absent/null/malformed/partial)
  - SyncedPrefs.rateLimit synced via kind-30078, PREFS_VERSION bumped 2 -> 3
  - asNonNegativeInt untrusted-numeric coercer (ASVS V5)
  - sanitizeSyncedPrefs absent-key fallback to local safe defaults (never 0/unlimited) -- RESEARCH Pitfall 6
  - CHANGELOG.md Unreleased entry documenting the new rate-limiting defaults + 0=unlimited escape hatch
affects: [06-03 (rate-limit-evaluate call-site swaps), 06-04 (per-type + global rate-limit UI)]

tech-stack:
  added: []
  patterns:
    - "Config default-constant + migrateConfig per-sub-field backfill (mirrors DEFAULT_MESSAGES_CONFIG / groups.modes guard)"
    - "Sync coercer with untrusted-input fallback (asNonNegativeInt mirrors asStringArray/asBoolean/asModes)"
    - "Inverse-of-legacy-seed absent-key fallback: absent synced field maps to local safe defaults, not to a zeroed/disabled state"

key-files:
  created: []
  modified:
    - services/config.ts
    - helpers/preferences.ts
    - CHANGELOG.md
    - tests/services/config.test.ts
    - tests/helpers/preferences.test.ts

key-decisions:
  - "DEFAULT_RATE_LIMIT_CONFIG = { window:60, global:20, perType:{replies:5,zaps:5,messages:5,groups:5} } -- literal reading of D6-09's 'per-type ~5/min, global ~20/min, 60s window'"
  - "migrateConfig backfill preserves explicit 0 (0 = unlimited is a valid stored value, never treated as missing)"
  - "sanitizeSyncedPrefs treats an ABSENT rateLimit key as 'apply this device's local DEFAULT_RATE_LIMIT_CONFIG', deliberately the OPPOSITE fallback direction from asMessagesCategories' legacy-seed pattern, since rate limiting has no legacy predecessor field (RESEARCH Pitfall 6 / T-6-04)"
  - "PREFS_VERSION bumped 2 -> 3 for the rateLimit addition, following the existing bump-per-schema-change convention"

requirements-completed: [D6-07, D6-09]

coverage:
  - id: D1
    description: "AppConfig.rateLimit + exported DEFAULT_RATE_LIMIT_CONFIG seed new installs with anti-spam defaults (window:60, global:20, perType:5 each), 0=unlimited"
    requirement: "D6-09"
    verification:
      - kind: unit
        ref: "tests/services/config.test.ts#services/config DEFAULT_RATE_LIMIT_CONFIG (D6-07/D6-09)"
        status: pass
    human_judgment: false
  - id: D2
    description: "migrateConfig defensively and idempotently backfills absent/null/malformed/partial rateLimit from structuredClone(DEFAULT_RATE_LIMIT_CONFIG), preserving explicit values including 0"
    requirement: "D6-07"
    verification:
      - kind: unit
        ref: "tests/services/config.test.ts#services/config migrateConfig rateLimit backfill (D6-07/D6-09)"
        status: pass
    human_judgment: false
  - id: D3
    description: "kind-30078 SyncedPrefs carries rateLimit; PREFS_VERSION bumped to 3; serializePrefs emits it field-by-field; sanitizeSyncedPrefs coerces every numeric field via asNonNegativeInt"
    requirement: "D6-07"
    verification:
      - kind: unit
        ref: "tests/helpers/preferences.test.ts#serializePrefs / sanitizeSyncedPrefs rateLimit (D6-07 / RESEARCH Pitfall 6)"
        status: pass
    human_judgment: false
  - id: D4
    description: "An inbound payload with NO rateLimit key (pre-Phase-6 peer) falls back to this device's local DEFAULT_RATE_LIMIT_CONFIG, never to 0/unlimited (RESEARCH Pitfall 6)"
    requirement: "D6-07"
    verification:
      - kind: unit
        ref: "tests/helpers/preferences.test.ts#sanitizeSyncedPrefs rateLimit (D6-07 / RESEARCH Pitfall 6) - absent rateLimit key ... falls back to local DEFAULT_RATE_LIMIT_CONFIG"
        status: pass
    human_judgment: false
  - id: D5
    description: "CHANGELOG.md documents the new default rate-limiting behavior change and the 0=unlimited escape hatch"
    requirement: "D6-09"
    verification:
      - kind: other
        ref: "grep -qi 'rate' CHANGELOG.md"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-10
status: complete
---

# Phase 6 Plan 2: Rate-limit config + kind-30078 sync + migration Summary

**Adds `AppConfig.rateLimit` (global + per-type + window) with anti-spam defaults, a defensive `migrateConfig` backfill, and extends the Phase-2 kind-30078 sync (`SyncedPrefs.rateLimit`, `PREFS_VERSION` 2->3) with untrusted-number coercion and a Pitfall-6 absent-key fallback to local safe defaults.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-10
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- `AppConfig.rateLimit` type field + exported `DEFAULT_RATE_LIMIT_CONFIG` (window:60, global:20, perType:{replies,zaps,messages,groups}:5) seeding `config$` for new installs
- `migrateConfig` defensively and idempotently backfills absent/null/non-object/partial `rateLimit`, per-sub-field, preserving any explicit value including `0` (unlimited)
- `SyncedPrefs.rateLimit` synced via the existing kind-30078 NIP-44-encrypted app-data event; `PREFS_VERSION` bumped 2 -> 3
- `serializePrefs` builds the `rateLimit` block field-by-field (never a whole-object spread)
- New `asNonNegativeInt(value, fallback)` coercer: finite && >=0 else fallback, floors floats, preserves `0` -- guards every synced rate-limit number against tampering (ASVS V5)
- `sanitizeSyncedPrefs`'s rateLimit branch coerces a present payload field-by-field AND falls back to a `structuredClone` of this device's own `DEFAULT_RATE_LIMIT_CONFIG` when the key is entirely absent (a pre-Phase-6 peer) -- explicitly NOT to `0`/unlimited (RESEARCH Pitfall 6 / T-6-04)
- `mergePrefs` carries `rateLimit` from the sanitized incoming payload
- CHANGELOG.md Unreleased entry documents the new default anti-spam rate limiting and the `0` = unlimited escape hatch

## Task Commits

Each task was committed atomically:

1. **Task 1: AppConfig.rateLimit + DEFAULT_RATE_LIMIT_CONFIG + migrateConfig backfill + config tests + CHANGELOG (D6-07/D6-09)** - `8bf0a1d` (feat)
2. **Task 2: Sync rateLimit via kind-30078 + PREFS_VERSION 3 + asNonNegativeInt + absent-key local-defaults fallback (D6-07 / RESEARCH Pitfall 6)** - `66ab129` (feat)

_Plan metadata commit follows this SUMMARY._

## Files Created/Modified
- `services/config.ts` - `AppConfig.rateLimit` type; exported `DEFAULT_RATE_LIMIT_CONFIG`; `config$` seed; `migrateConfig` defensive rateLimit backfill
- `helpers/preferences.ts` - `SyncedPrefs.rateLimit`; `PREFS_VERSION = 3`; `serializePrefs` rateLimit block; `asNonNegativeInt` coercer; `asRateLimit` sanitizer helper with the Pitfall-6 absent-key fallback; `mergePrefs` rateLimit line
- `CHANGELOG.md` - Unreleased entry: new rate-limiting defaults + `0` = unlimited escape hatch
- `tests/services/config.test.ts` - `DEFAULT_RATE_LIMIT_CONFIG` default-value + fresh-config$ assertions; `migrateConfig` backfill (absent/null/non-object/partial), per-sub-field backfill, idempotency, explicit-0 preservation
- `tests/helpers/preferences.test.ts` - `makeConfig` fixture extended with `rateLimit`; `serializePrefs` includes `rateLimit`; `PREFS_VERSION === 3`; `sanitizeSyncedPrefs` rateLimit coercion cases (negative/NaN/non-number/float/zero); the critical Pitfall-6 absent-key and null-value regression tests; serialize->sanitize->merge round-trip

## Decisions Made
- Literal reading of D6-09's numeric targets: `window:60, global:20, perType:5` for each of the four types (no alternative window/limit combination considered, per RESEARCH's Open Question 1 recommendation)
- `migrateConfig`'s per-sub-field backfill treats an explicit `0` as a valid stored value (not "missing") -- uses `typeof x !== "number"` checks rather than `??`/`||`, which would incorrectly replace a user's explicit `0` (unlimited)
- `sanitizeSyncedPrefs`'s rateLimit fallback direction is the deliberate INVERSE of `asMessagesCategories`' legacy-seed pattern: absent maps to local safe defaults (rate-limiting ON), never to zeros (rate-limiting OFF), because there is no legacy predecessor field for rate limiting to seed from
- Kept the config shape flat/inline in `services/config.ts` rather than importing `RateLimitConfig` from Plan 01's `services/rate-limit-accounting.ts`, per the plan's Wave-1 independence requirement -- the two shapes are structurally identical by construction and will be verified compatible at Plan 03's `evaluate()` call site

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `<behavior>`, `<action>`, and `<acceptance_criteria>` were implemented as specified, including the Pitfall-6 absent-key fallback and the explicit-0-preservation requirement.

## Issues Encountered

None. The full project `bun test` (117 tests across 10 files) and `bun run lint` (`tsc --noEmit`) were both green after both tasks landed. Task 1 alone temporarily broke `bun run lint` because `tests/helpers/preferences.test.ts`'s `makeConfig` fixture (a Task 2 file) didn't yet satisfy the widened `AppConfig` type -- expected given the plan's two-task split within one file's type contract; resolved by Task 2's fixture update, with both tasks' own file sets committed atomically once the full suite was green.

## User Setup Required

None - no external service configuration required. No packages installed this plan (RESEARCH Package Legitimacy Audit: empty).

## Next Phase Readiness
- `config.rateLimit` + `configValue("rateLimit")` typing is ready for Plan 03's `evaluate()` call-site swaps (must structurally match Plan 01's `RateLimitConfig`)
- `config.rateLimit.global` / `.window` / `.perType.<type>` shape is ready for Plan 04's per-type + global number-input UI
- No blockers. Manual verification (encrypted kind-30078 sync round-trip across real devices) remains deferred to `/gsd-verify-work` per 06-VALIDATION.md's Manual-Only classification -- not exercisable in this automated execution context.

---
*Phase: 06-notification-rate-limiting-per-type-and-global-with-grouped*
*Completed: 2026-07-10*

## Self-Check: PASSED

- FOUND: services/config.ts
- FOUND: helpers/preferences.ts
- FOUND: .planning/phases/06-notification-rate-limiting-per-type-and-global-with-grouped/06-02-SUMMARY.md
- FOUND commit: 8bf0a1d (Task 1)
- FOUND commit: 66ab129 (Task 2)
- FOUND commit: c39e458 (SUMMARY.md)
