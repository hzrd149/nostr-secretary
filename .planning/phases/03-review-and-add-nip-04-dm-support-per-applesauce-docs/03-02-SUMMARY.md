---
phase: 03-review-and-add-nip-04-dm-support-per-applesauce-docs
plan: 02
subsystem: config
tags: [bun-test, tdd, privacy, config-migration]

# Dependency graph
requires:
  - phase: 01-nip-29-group-notification-modes
    provides: the groups.modes backfill migration logic (D-10) that this plan extracts alongside the sendContent fix
provides:
  - "migrateConfig(parsed) exported pure function in services/config.ts covering both legacy migrations (directMessageNotifications reshape + groups.modes backfill)"
  - "Regression tests pinning sendContent:false on migration regardless of legacy directMessageNotifications value (D3-04)"
affects: [03-01, 03-03, notifications/messages.ts sendContent consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-function extraction of load-time config migration logic for unit-testability, without touching the config$ singleton (mirrors helpers/preferences.ts, helpers/groups.ts convention)"

key-files:
  created: []
  modified:
    - services/config.ts
    - tests/services/config.test.ts

key-decisions:
  - "sendContent is forced to false unconditionally in migrateConfig, decoupled from messages.enabled which still inherits the legacy directMessageNotifications value (D3-04)"
  - "migrateConfig kept pure (no config$ access, no fs access) so it is testable via plain object fixtures, isolated from the shared config$ singleton the existing groups.modes tests depend on"

patterns-established:
  - "Config migration logic lives in an exported, pure migrateConfig(parsed) function called once at load time — future migrations should be added inside this function, not inlined into the load-time if-block"

requirements-completed: [D3-04, D3-09]

coverage:
  - id: D1
    description: "Config migration forces messages.sendContent:false unconditionally regardless of legacy directMessageNotifications value, closing the privacy hole where upgrading users were silently opted into forwarding decrypted DM plaintext to ntfy"
    requirement: "D3-04"
    verification:
      - kind: unit
        ref: "tests/services/config.test.ts#services/config migrateConfig > legacy directMessageNotifications:true migrates to messages.enabled:true and messages.sendContent:false (D3-04)"
        status: pass
      - kind: unit
        ref: "tests/services/config.test.ts#services/config migrateConfig > legacy directMessageNotifications:false also yields messages.sendContent:false (default is unconditional) (D3-04)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Migration logic extracted into an exported pure migrateConfig(parsed) function, unit-testable without the config$ singleton or a temp fixture file"
    requirement: "D3-09"
    verification:
      - kind: unit
        ref: "tests/services/config.test.ts#services/config migrateConfig > backfills groups.modes to {} when groups has no modes key (D3-10/D-10 parity)"
        status: pass
    human_judgment: false
  - id: D3
    description: "groups.modes backfill behavior (Phase 1 D-10) preserved byte-for-byte inside the extracted migrateConfig — existing singleton tests unaffected"
    verification:
      - kind: unit
        ref: "tests/services/config.test.ts#services/config groups.modes (existing describe block, 3 tests)"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-07-10
status: complete
---

# Phase 3 Plan 2: Fix sendContent privacy migration default Summary

**Extracted services/config.ts's inline load-time migration into an exported pure `migrateConfig(parsed)` function and forced `messages.sendContent` to `false` unconditionally, closing the D3-04 privacy hole where upgrading users with `directMessageNotifications:true` were silently switched to forwarding decrypted DM plaintext to the ntfy server.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-10T03:25:00Z
- **Completed:** 2026-07-10T03:30:52Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `services/config.ts` now exports `migrateConfig(parsed)`, a pure function containing both the `directMessageNotifications`→`messages` reshape and the `groups.modes` backfill, called once at load time before merging into `config$`
- `messages.sendContent` is now forced `false` unconditionally on migration — `messages.enabled` still inherits the legacy `directMessageNotifications` value, but the privacy-sensitive `sendContent` toggle requires explicit opt-in
- Added a new `describe("services/config migrateConfig", ...)` block in `tests/services/config.test.ts` with 3 regression tests (sendContent:false for both legacy `directMessageNotifications` values, plus groups.modes backfill parity), calling `migrateConfig` directly on plain objects so the shared `config$` singleton the existing groups.modes tests depend on is never perturbed

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: Add failing sendContent-migration regression tests** - `f9e57a4` (test) — confirmed RED: `SyntaxError: Export named 'migrateConfig' not found`
2. **Task 2: Extract migrateConfig and force sendContent:false on migration** - `ee632d6` (fix) — confirmed GREEN: all 6 tests in the file pass, full suite (48 tests) green, `bun run lint` clean

## Files Created/Modified
- `services/config.ts` - Extracted `migrateConfig(parsed)` as an exported, pure, JSDoc-documented function; forces `sendContent: false` unconditionally on migration; load path now calls `migrateConfig(parsed)` before spreading into `config$.next(...)`
- `tests/services/config.test.ts` - Added `migrateConfig` import and a new describe block with 3 direct-call regression tests (D3-04 sendContent default x2, D3-10/D-10 groups.modes backfill parity)

## Decisions Made
- `sendContent` and `enabled` are decoupled in the migration: `enabled` still inherits `parsed.directMessageNotifications` (whether DM notifications were on at all), while `sendContent` is now always `false` regardless — these are genuinely different settings (notify vs. include content) and only the latter had the privacy bug.
- Kept `migrateConfig`'s parameter typed as `any` (matching the existing untyped `parsed` from `JSON.parse`) rather than introducing a new legacy-shape type, since the function's job is specifically to normalize an untrusted/unknown on-disk shape into `AppConfig`-compatible fields — over-typing the input would fight the migration's own purpose.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched their `<action>` specs precisely: Task 1 added the RED-state tests importing `migrateConfig` before it existed; Task 2 extracted the function, flipped the `sendContent` default, and preserved the `groups.modes` backfill logic identically.

## Issues Encountered

None. TDD RED state was confirmed via the exact expected `SyntaxError` (named export not found) before Task 2 began; GREEN state was confirmed via `bun test tests/services/config.test.ts` (6/6 pass), full suite `bun test` (48/48 pass), and `bun run lint` (tsc --noEmit clean).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The `sendContent` privacy hole (D3-04) is closed and regression-tested; any future reintroduction of the bug (defaulting `sendContent` to the legacy value) will fail `tests/services/config.test.ts` immediately.
- `migrateConfig` is now the single place to add future config migrations, isolated from the `config$` singleton for easy unit testing.
- This plan's scope was strictly local to `services/config.ts`/`tests/services/config.test.ts` per D3-10; the remaining phase 3 work (permission fix, catchError parity, deep-link, reconnect hint, `notifications/messages.ts` tests) is covered by sibling plans 03-01/03-03 and unaffected by this change.

---
*Phase: 03-review-and-add-nip-04-dm-support-per-applesauce-docs*
*Completed: 2026-07-10*
