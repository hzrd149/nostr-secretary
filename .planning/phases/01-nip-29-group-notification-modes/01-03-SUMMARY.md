---
phase: 01-nip-29-group-notification-modes
plan: 03
subsystem: notifications
tags: [rxjs, nip-29, bun-test, notification-gating]

requires:
  - phase: 01-nip-29-group-notification-modes (plan 01)
    provides: pure helpers passesGroupModeGate/getGroupMode/messageMentionsPubkey in helpers/groups.ts
  - phase: 01-nip-29-group-notification-modes (plan 02)
    provides: AppConfig.groups.modes field with migration backfill in services/config.ts
provides:
  - Live wiring of the per-group mode gate into notifications/groups.ts's subscribe callback
  - D-09 truth-table test proving master switch -> mode gate -> sender gate -> send ordering
affects: [01-04 (pages/groups.tsx PATCH), 01-05 (pages/notifications.tsx summary)]

tech-stack:
  added: []
  patterns:
    - "Sequential gate composition: enabled$ (structural) -> mode gate (pure, sync) -> shouldNotify (async sender gate) -> send, never merged"
    - "Pure-function decision testing: notification modules with top-level RelayPool subscriptions are tested via a local decide() helper composed from real exported pure helpers, not via importing the module"

key-files:
  created:
    - tests/notifications/groups.test.ts
  modified:
    - notifications/groups.ts

key-decisions:
  - "Inserted the mode gate as the first statements in the existing .subscribe() callback, reading groups.modes and pubkey from getConfig(), guarding on missing pubkey with an early return"
  - "Kept shouldNotify (lines 41-69) and the three sibling notification modules completely untouched, per Pitfall 5 / out-of-scope tech debt"

patterns-established:
  - "D-09 layering: master switch (structural, enabled$) -> per-group mode gate (pure, synchronous) -> existing sender gate (async, unchanged) -> send"

requirements-completed: [D-01, D-02, D-06, D-08, D-09]

coverage:
  - id: D1
    description: "notifications/groups.ts subscribe callback evaluates master switch -> mode gate -> sender gate -> send, using getGroupMode/passesGroupModeGate from helpers/groups.ts"
    requirement: "D-01"
    verification:
      - kind: unit
        ref: "tests/notifications/groups.test.ts#D-09 group notification decision truth table"
        status: pass
      - kind: other
        ref: "bun run lint (tsc --noEmit)"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-09 full decision truth table (7 rows: master off, muted, mentions match/no-match, sender blacklist interaction in both mentions and all modes) is automated and green"
    requirement: "D-09"
    verification:
      - kind: unit
        ref: "tests/notifications/groups.test.ts#D-09 group notification decision truth table"
        status: pass
    human_judgment: false
  - id: D3
    description: "shouldNotify and the three sibling notification modules (messages.ts, replies.ts, zaps.ts) remain byte-for-byte unchanged"
    verification:
      - kind: other
        ref: "git diff notifications/messages.ts notifications/replies.ts notifications/zaps.ts (empty)"
        status: pass
    human_judgment: false

duration: 4min
completed: 2026-07-07
status: complete
---

# Phase 01 Plan 03: Wire per-group mode gate into live notification pipeline Summary

**Inserted the pure per-group mode gate (getGroupMode + passesGroupModeGate) into notifications/groups.ts's subscribe callback, strictly before the existing shouldNotify sender gate, and proved the full D-09 decision truth table with a 7-row bun:test suite.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-07T22:09:12Z
- **Completed:** 2026-07-07T22:12:19Z
- **Tasks:** 2
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments
- `notifications/groups.ts` now evaluates master switch (enabled$, structural) -> per-group mode gate (new) -> existing sender gate (shouldNotify, unchanged) -> send, realizing D-01/D-02/D-06/D-08/D-09 as live behavior
- `tests/notifications/groups.test.ts` proves all seven rows of the D-09 truth table using a local `decide()` composition built on the real `passesGroupModeGate` export, without importing the self-subscribing `notifications/groups.ts` module
- Verified `shouldNotify` (lines 41-69) and the three sibling notification modules (`messages.ts`, `replies.ts`, `zaps.ts`) are byte-for-byte unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Insert the per-group mode gate into the subscribe callback** - `351cfbf` (feat)
2. **Task 2: D-09 truth-table test via the composed pure gate** - `621e1e2` (test)

**Plan metadata:** (pending final docs commit)

## Files Created/Modified
- `notifications/groups.ts` - Imports `getGroupMode`/`passesGroupModeGate` from `helpers/groups`; subscribe callback now reads `groups.modes` and `pubkey` from `getConfig()`, computes `mode`, and returns early (with a log) when the mode gate fails, before the existing `shouldNotify` check
- `tests/notifications/groups.test.ts` - New test file; local `decide(enabled, mode, message, user, senderAllowed)` helper mirrors the production callback order using the real `passesGroupModeGate`; asserts all 7 truth-table rows

## Decisions Made
- Guarded on missing `pubkey` with an early return (no log) before computing the mode, since there's nothing to compare a mention against and this mirrors the plan's exact instruction
- Kept the "Skipping reply notification..." log message text for the sender-gate branch unchanged (pre-existing, out of scope) and used a new distinct log message ("Skipping group notification: muted or non-matching mode") for the new mode-gate branch, per the plan's action step

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The live notification path now respects per-group modes end-to-end; `pages/groups.tsx` (plan 04) can wire the PATCH handler to write `config.groups.modes` and this plan's gate will pick up changes automatically via `getConfig()`
- `pages/notifications.tsx` (plan 05) can use `summarizeGroupModes` (already exported from `helpers/groups.ts` in plan 01) independent of this plan's changes
- No blockers identified

## Self-Check: PASSED

All created/modified files verified present on disk; all task and summary commits (351cfbf, 621e1e2, d68c6d1) verified in git log.

---
*Phase: 01-nip-29-group-notification-modes*
*Completed: 2026-07-07*
