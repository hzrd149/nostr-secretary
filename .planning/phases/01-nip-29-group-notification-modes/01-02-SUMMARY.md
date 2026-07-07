---
phase: 01-nip-29-group-notification-modes
plan: 02
subsystem: config
tags: [bun-test, config-migration, rxjs, typescript, nip-29]

# Dependency graph
requires:
  - phase: 01-nip-29-group-notification-modes (plan 01)
    provides: "helpers/groups.ts single-source-of-truth exports: GroupNotificationMode, DEFAULT_GROUP_NOTIFICATION_MODE, getGroupMode, passesGroupModeGate, summarizeGroupModes, isGroupNotificationMode"
provides:
  - "AppConfig.groups.modes: Record<string, GroupNotificationMode> field, type-only imported from helpers/groups.ts"
  - "Boot-time migration backfill: parsed.groups.modes defaults to {} for every pre-Phase-1 config.json"
  - "tests/setup.ts + bunfig.toml [test] preload: global test-safety fixture pattern preventing any bun:test run from touching the real project config.json"
  - "tests/fixtures/config-pre-modes.json: reusable pre-Phase-1 config fixture"
affects: [01-03, 01-04, 01-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "bunfig.toml [test] preload for global test-process safety nets, needed because Bun shares one module cache across all bun:test files in a run"
    - "Config migration backfill inserted immediately before the existing shallow config$.next({ ...config$.value, ...parsed }) spread, mirroring the pre-existing messages migration"

key-files:
  created:
    - tests/services/config.test.ts
    - tests/fixtures/config-pre-modes.json
    - tests/setup.ts
    - bunfig.toml
  modified:
    - services/config.ts
    - pages/groups.tsx
    - CHANGELOG.md

key-decisions:
  - "GroupNotificationMode imported type-only from helpers/groups.ts into services/config.ts; no second declaration (single source of truth preserved from Plan 01)"
  - "D-07 behavior-change note is CHANGELOG.md-only for Phase 1 -- no in-app banner, no migrationNoticeShown-style AppConfig flag"
  - "Test-process config safety net implemented as a global bunfig.toml [test] preload (tests/setup.ts) rather than a per-file beforeAll, because Bun's shared module cache means the first test file (in load order) to transitively import services/config.ts determines which config file the WHOLE process loads"

patterns-established:
  - "Any future test file that imports (even transitively) services/config.ts is automatically protected from touching the real config.json by tests/setup.ts -- no per-file setup needed"

requirements-completed: [D-06, D-07, D-10]

coverage:
  - id: D1
    description: "AppConfig.groups.modes field added, type-only imported from helpers/groups.ts, no local redeclaration (D-10)"
    requirement: "D-10"
    verification:
      - kind: unit
        ref: "bun run lint (tsc --noEmit strict typecheck)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Fresh install (no config.json) boots with groups.modes === {} from the BehaviorSubject default (D-06/D-10)"
    requirement: "D-06"
    verification:
      - kind: unit
        ref: "tests/services/config.test.ts#services/config groups.modes > backfills groups.modes to {} for a pre-Phase-1 config.json with no modes key (D-10/D-06)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Existing config.json written before this phase (groups present, no modes key) loads with groups.modes backfilled to {} -- never undefined (D-10, Pitfall 1)"
    requirement: "D-10"
    verification:
      - kind: unit
        ref: "tests/services/config.test.ts#services/config groups.modes > backfills groups.modes to {} for a pre-Phase-1 config.json with no modes key (D-10/D-06)"
        status: pass
      - kind: unit
        ref: "tests/services/config.test.ts#services/config groups.modes > preserves the fixture's existing groups fields when backfilling modes"
        status: pass
    human_judgment: false
  - id: D4
    description: "Per-group modes round-trip: setting groups.modes[key] via config$ is readable back through getConfig() (D-10)"
    requirement: "D-10"
    verification:
      - kind: unit
        ref: "tests/services/config.test.ts#services/config groups.modes > round-trips a per-group mode set via config$.next() (D-10)"
        status: pass
    human_judgment: false
  - id: D5
    description: "CHANGELOG.md documents the quieter-by-default behavior change for existing users (D-07)"
    requirement: "D-07"
    verification:
      - kind: unit
        ref: "grep -qiE mention|per-group|group notification CHANGELOG.md && head -20 CHANGELOG.md | grep -qiE default|all messages|@mention"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-07-07
status: complete
---

# Phase 01 Plan 02: Config Storage for Per-Group Notification Modes Summary

**AppConfig.groups.modes persisted field with a boot-time migration backfill that survives the existing shallow-merge config loader, proven by a bun:test suite that (after a discovered cross-test-file contamination bug) is now globally guarded from ever touching the real project config.json.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-07T22:00Z (approx.)
- **Completed:** 2026-07-07T22:07:10Z
- **Tasks:** 3 completed
- **Files modified:** 7 (4 created: tests/services/config.test.ts, tests/fixtures/config-pre-modes.json, tests/setup.ts, bunfig.toml; 3 modified: services/config.ts, pages/groups.tsx, CHANGELOG.md)

## Accomplishments
- Added `AppConfig.groups.modes: Record<string, GroupNotificationMode>` to `services/config.ts`, type-only imported from `helpers/groups.ts` (single source of truth from Plan 01, no redeclaration)
- Added `modes: {}` to the `BehaviorSubject` `groups` default for fresh installs
- Added the mandatory migration backfill (`parsed.groups.modes = {}` when undefined) immediately before the existing shallow `config$.next({ ...config$.value, ...parsed })` spread -- mirrors the existing `messages` migration pattern exactly
- Wrote `tests/fixtures/config-pre-modes.json`, a valid pre-Phase-1 config with `groups` present but no `modes` key
- Wrote `tests/services/config.test.ts` proving: (1) post-load `groups.modes === {}` (backfill), (2) sibling `groups` fields (`enabled`/`whitelists`/`blacklists`/`groupLink`) survive the backfill unclobbered, (3) `config$.next()` mode writes round-trip through `getConfig()`
- Recorded the D-07 quieter-by-default behavior change in `CHANGELOG.md` under a new `## Unreleased` heading -- CHANGELOG-only, no in-app banner, no new `AppConfig` flag

## Task Commits

Each task was committed atomically:

1. **Task 1: Add groups.modes to AppConfig, its default, and the migration backfill** - `7d2c483` (feat)
2. **Task 2: Config round-trip + migration-backfill test with a pre-modes fixture** - `a293fd2` (test)
3. **Task 3: Record the D-07 behavior-change note in CHANGELOG.md** - `1ba7624` (docs)

_Task 2 is a single commit rather than a RED->GREEN pair: the field/migration under test was implemented in Task 1 per the plan's own task ordering (implementation task before test task), so there was no failing-test state to commit separately -- see TDD Gate Compliance below._

## Files Created/Modified
- `services/config.ts` - `AppConfig.groups.modes` field, `modes: {}` default, boot-time backfill before the shallow-merge spread, type-only `GroupNotificationMode` import from `../helpers/groups`
- `pages/groups.tsx` - PATCH handler now preserves `currentConfig.groups.modes` when rebuilding the `groups` object (Rule 3 blocking fix, see Deviations)
- `tests/services/config.test.ts` - proves backfill, field preservation, and round-trip
- `tests/fixtures/config-pre-modes.json` - pre-Phase-1 config fixture (groups present, no modes key)
- `tests/setup.ts` - global `bun:test` preload; copies the pre-modes fixture to a temp path and points `Bun.env.CONFIG`/`process.env.CONFIG` at it before any test file's imports run
- `bunfig.toml` - new file; wires `tests/setup.ts` as `[test] preload`
- `CHANGELOG.md` - new `## Unreleased` entry documenting per-group modes and the D-07 mentions-only default behavior change

## Decisions Made
- `GroupNotificationMode` stays declared only in `helpers/groups.ts`; `services/config.ts` imports it `import type` for zero runtime coupling to `services/nostr.ts`
- D-07 behavior-change messaging is CHANGELOG.md-only for Phase 1, per the plan's explicit objective (no in-app banner, no new `AppConfig` flag)
- Test-process config safety is implemented as a shared `bunfig.toml` `[test]` preload rather than each test file managing its own temp-config lifecycle, because Bun's module cache is shared across all files in one `bun test` run (see Deviations for why the plan's literal per-file approach was insufficient)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `pages/groups.tsx` PATCH handler failed strict typecheck once `groups.modes` became required**
- **Found during:** Task 1 verification (`bun run lint`)
- **Issue:** `pages/groups.tsx`'s existing PATCH handler rebuilds `newConfig.groups` from scratch (`{ enabled, groupLink, whitelists, blacklists }`) without a `modes` field. Once `modes` became a required field on `AppConfig.groups`, this object literal no longer satisfied the `AppConfig` type, breaking `tsc --noEmit`.
- **Fix:** Added `modes: currentConfig.groups.modes` to the rebuilt object so the PATCH handler preserves whatever modes were already stored (per-group mode editing UI itself is out of scope for this plan -- it lands in a later plan per the phase's pattern map).
- **Files modified:** `pages/groups.tsx`
- **Verification:** `bun run lint` passes; no behavior change to the existing enabled/groupLink/whitelists/blacklists PATCH flow.
- **Committed in:** `7d2c483` (Task 1 commit)

**2. [Rule 1 - Bug] Task 2's literal per-file beforeAll/dynamic-import approach corrupted the real project `config.json` when run as part of the full test suite**
- **Found during:** Task 2, after writing the test per the plan's literal instructions and running `bun test` (full suite) as required by the plan's top-level `<verification>` block
- **Issue:** `services/config.ts` reads `Bun.env.CONFIG` at import time, and Bun shares ONE module cache across every file in a `bun test` run. `tests/helpers/groups.test.ts` (from Plan 01, unmodified) transitively imports `services/config.ts` via `helpers/groups.ts -> services/nostr.ts`, with no config-related test of its own. Because that file loads (alphabetically) before `tests/services/config.test.ts`, its import chain triggered `services/config.ts`'s top-level `await fs.exists(CONFIG_PATH)` against the *real* project `config.json` (`CONFIG_PATH` defaults to `"config.json"` in cwd) BEFORE this plan's test file's own `beforeAll` had a chance to set `Bun.env.CONFIG`. The subsequent round-trip assertion (`config$.next(...)`) then persisted test data (`"wss://groups.example.com'abc123": "muted"`) into the real, gitignored `config.json` via the existing save-on-change subscription. Verified via `md5sum` before/after and by inspecting the file's contents directly; the corrupted key was manually removed and the file's original content restored (the file is gitignored/untracked, so no git history was affected).
- **Fix:** Replaced the per-file `beforeAll`/dynamic-import/temp-file dance with a global `bunfig.toml` `[test] preload` (`tests/setup.ts`) that copies the pre-modes fixture to a process-unique temp path and sets `Bun.env.CONFIG` BEFORE any test file's imports run -- the only hook Bun guarantees runs first regardless of file load order. `tests/services/config.test.ts` was simplified to a plain static import, since the module is now guaranteed to load from the safe fixture copy by the time any test file's code executes.
- **Files modified:** `tests/setup.ts` (new), `bunfig.toml` (new), `tests/services/config.test.ts` (simplified)
- **Verification:** Ran `bun test tests/services/config.test.ts` and full `bun test` three times each; all 18 tests pass consistently in both modes. Confirmed via `md5sum` that the real `config.json` is byte-for-byte unchanged across repeated runs.
- **Committed in:** `a293fd2` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking typecheck fix, 1 critical test-isolation bug)
**Impact on plan:** No scope creep beyond what was necessary for correctness (Rule 3) and to prevent test-induced data corruption of a real, non-test file (Rule 1). Both fixes are additive infrastructure/safety, not behavior changes to the plan's stated deliverables.

## TDD Gate Compliance

Task 2 has `tdd="true"` but no separate RED commit: per this plan's own task ordering, Task 1 (implementation: field, default, migration) was completed and committed before Task 2 (test-writing). By the time the test file was authored, the feature it verifies already existed, so there was no failing-test state to commit -- writing the test and immediately observing it pass (after fixing the cross-file contamination bug in Deviation 2) is the expected outcome given the plan's task sequence, not a skipped RED gate. `git log` shows `feat` (`7d2c483`) before `test` (`a293fd2`), consistent with this plan's explicit Task 1 -> Task 2 ordering rather than a violated RED->GREEN sequence.

## Issues Encountered
See Deviations above -- both issues were discovered and resolved during execution, no unresolved issues remain.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `services/config.ts` now exposes `AppConfig.groups.modes` with a proven default and migration backfill; Plan 03 (notification gate) and Plans 04/05 (pages) can read/write `config.groups.modes` directly via the existing `getConfig()`/`config$.next()`/`updateConfig()` helpers, unchanged.
- `tests/setup.ts` + `bunfig.toml` now provide a project-wide safety net: any future test file that imports `services/config.ts` (even transitively) is automatically protected from touching the real `config.json`, with no per-file setup required. Plan 03's `tests/notifications/groups.test.ts` benefits from this automatically if it needs config state.
- `pages/groups.tsx`'s PATCH handler currently passes `modes` through unchanged; Plan 04 will extend it to actually accept and validate per-group mode signals from the UI (per `isGroupNotificationMode` from Plan 01 and the PATCH extension pattern documented in `01-PATTERNS.md`).
- No blockers for Plan 03.

---
*Phase: 01-nip-29-group-notification-modes*
*Completed: 2026-07-07*

## Self-Check: PASSED

- FOUND: services/config.ts
- FOUND: pages/groups.tsx
- FOUND: tests/services/config.test.ts
- FOUND: tests/fixtures/config-pre-modes.json
- FOUND: tests/setup.ts
- FOUND: bunfig.toml
- FOUND: CHANGELOG.md
- FOUND: 7d2c483 (Task 1 commit)
- FOUND: a293fd2 (Task 2 commit)
- FOUND: 1ba7624 (Task 3 commit)
