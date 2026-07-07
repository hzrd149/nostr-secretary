---
phase: 01-nip-29-group-notification-modes
plan: 05
subsystem: ui
tags: [datastar, kitajs-html, notifications, nip-29]

requires:
  - phase: 01-nip-29-group-notification-modes
    provides: summarizeGroupModes/getGroupMode helpers (Plan 01) and per-group mode controls persisted to config.groups.modes (Plans 02-04)
provides:
  - Read-only per-group mode summary on the /notifications Groups card (D-05)
affects: []

tech-stack:
  added: []
  patterns:
    - "Server-rendered summary counts computed at render time via config$.getValue() + a pure helper (summarizeGroupModes), no new client signal or observable"

key-files:
  created: []
  modified:
    - pages/notifications.tsx

key-decisions:
  - "Zero-groups empty state ('No groups joined yet') is derived purely from the sum of summarizeGroupModes' three counts being zero, matching the plan's explicit 'no new observable' constraint — it does not cross-check the live groups$ join list."

patterns-established: []

requirements-completed: [D-05]

coverage:
  - id: D1
    description: "Groups card on /notifications shows per-mode counts (all/mentions/muted) derived from summarizeGroupModes(config.groups.modes), color-coded per UI-SPEC (All=#667eea, mentions=#856404, muted=#721c24)"
    requirement: "D-05"
    verification:
      - kind: manual_procedural
        ref: "curl http://localhost:8080/notifications with config.groups.modes = {g1:all, g2:mentions, g3:mentions, g4:mentions, g5:muted} rendered '1 all messages · 3 mentions only · 1 muted' with mode-count.all/mentions/muted spans present"
        status: pass
      - kind: other
        ref: "bun run lint (tsc --noEmit)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Zero-groups empty state shows 'No groups joined yet' instead of a 0 · 0 · 0 line"
    requirement: "D-05"
    verification:
      - kind: manual_procedural
        ref: "curl http://localhost:8080/notifications against the unmodified config.json (no groups.modes key) rendered 'No groups joined yet' in the Groups card notification-description"
        status: pass
    human_judgment: false
  - id: D3
    description: "Existing enabled/disabled status span and the /groups Configure link are unchanged; no PATCH/signal added"
    requirement: "D-05"
    verification:
      - kind: unit
        ref: "bun test (full suite, 25 pass) — no regressions in existing helpers/config/notifications tests"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-07
status: complete
---

# Phase 01 Plan 05: Groups card mode summary Summary

**The /notifications Groups card now shows a color-coded "N all messages · N mentions only · N muted" summary computed from `summarizeGroupModes(config.groups.modes)`, with a "No groups joined yet" empty state, while keeping its existing enabled/disabled status and /groups Configure link unchanged.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-07T22:24:00Z
- **Completed:** 2026-07-07T22:32:00Z
- **Tasks:** 1 completed
- **Files modified:** 1

## Accomplishments
- Imported `config$` (default export) and `summarizeGroupModes` from `helpers/groups.ts` into `pages/notifications.tsx`
- Added a second `.notification-description` line inside the existing Groups card computing `summarizeGroupModes(config$.getValue().groups.modes ?? {})` and rendering "{all} all messages · {mentions} mentions only · {muted} muted", or "No groups joined yet" when the three counts sum to zero
- Color-coded the three counts with three new CSS classes (`.mode-count.all` #667eea, `.mode-count.mentions` #856404, `.mode-count.muted` #721c24) matching the UI-SPEC's per-group mode status colors, reusing the existing light-badge convention's text colors rather than introducing new hues
- Verified against a live `bun run dev` server: the empty state renders correctly against the real (pre-migration) `config.json`, and a synthetic `config.groups.modes` with 1 all/3 mentions/1 muted produced the exact expected color-coded markup

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the per-group mode summary to the Groups card (D-05)** - `3b2e228` (feat)

**Plan metadata:** (this commit, see below)

## Files Created/Modified
- `pages/notifications.tsx` - Added `config$`/`summarizeGroupModes` imports, three `.mode-count` CSS classes, and a summary line inside the Groups card's `notification-info` block with a zero-groups empty state

## Decisions Made
- The "zero groups" check uses only the sum of `summarizeGroupModes`' three counts (no new `groups$` fetch), per the plan's explicit constraint to avoid a new observable — consistent with `key_links` in the plan frontmatter.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Manual verification required temporarily editing the local `config.json` (not part of the plan's `files_modified`) to inject a `groups.modes` map for testing the non-empty-state rendering; the file was restored to its original contents before committing.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 05 was the last plan (wave 3) of Phase 01 (nip-29-group-notification-modes). All 5 plans (01-01 through 01-05) are now complete: per-group notification modes are modeled in config, gated in the group notification pipeline (D-01/D-06/D-09), editable per-group on `/groups` (D-03/D-04), persisted via a validated PATCH (Plan 04), and now surfaced as a read-only summary on `/notifications` (D-05). No blockers for closing out Phase 01.

---
*Phase: 01-nip-29-group-notification-modes*
*Completed: 2026-07-07*

## Self-Check: PASSED

- FOUND: pages/notifications.tsx
- FOUND: 3b2e228 (task commit)
