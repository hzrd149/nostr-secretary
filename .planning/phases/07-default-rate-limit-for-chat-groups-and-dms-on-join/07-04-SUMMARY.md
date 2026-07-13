---
phase: 07-default-rate-limit-for-chat-groups-and-dms-on-join
plan: 04
subsystem: ui
tags: [datastar, ui, rate-limiting, config]

# Dependency graph
requires:
  - phase: 07-default-rate-limit-for-chat-groups-and-dms-on-join
    provides: "AppConfig.rateLimit.perGroup/.perDm top-level scalar defaults (3/5), migrated + synced (Plan 02)."
provides:
  - "rateLimitPerGroup number input on pages/groups.tsx, bound to currentConfig.rateLimit.perGroup, second field alongside the existing rateLimitPerType field."
  - "rateLimitPerDm number input on pages/messages.tsx, bound to currentConfig.rateLimit.perDm, second field alongside the existing rateLimitPerType field."
  - "PATCH clamp blocks on both pages mirroring the existing rateLimitPerType clamp (finite >= 0, floored, current-value fallback)."
  - "Top-level perGroup/perDm merge into each page's newConfig.rateLimit, sibling of perType."
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Second distinctly-named Datastar signal per page (rateLimitPerGroup/rateLimitPerDm) added alongside an existing same-shape field, mirroring the existing clamp/merge logic verbatim rather than introducing new abstractions."

key-files:
  created: []
  modified:
    - pages/groups.tsx
    - pages/messages.tsx

key-decisions:
  - "Reused the exact clamp expression from the existing rateLimitPerType handler on each page (Number.isFinite(x) && x >= 0 ? Math.floor(x) : currentValue) rather than extracting a shared helper -- keeps the diff minimal and mirrors the plan's explicit 'mirroring verbatim' instruction."
  - "perGroup/perDm merged as top-level siblings of perType in newConfig.rateLimit (not nested), matching Plan 02's AppConfig shape."

patterns-established: []

requirements-completed: [D7-08, D7-06]

coverage:
  - id: D1
    description: "/groups shows a second rateLimitPerGroup number input bound to rateLimit.perGroup, alongside the existing rateLimitPerType field"
    requirement: "D7-08"
    verification:
      - kind: other
        ref: "grep -q 'data-bind=\"rateLimitPerGroup\"' pages/groups.tsx"
        status: pass
    human_judgment: false
  - id: D2
    description: "/messages shows a second rateLimitPerDm number input bound to rateLimit.perDm, alongside the existing rateLimitPerType field"
    requirement: "D7-08"
    verification:
      - kind: other
        ref: "grep -q 'data-bind=\"rateLimitPerDm\"' pages/messages.tsx"
        status: pass
    human_judgment: false
  - id: D3
    description: "Each new field's PATCH handler clamps the submitted signal to a non-negative integer (finite >= 0, floored), falling back to the current value otherwise (ASVS V5)"
    requirement: "D7-08"
    verification:
      - kind: other
        ref: "grep -q 'rawRateLimitPerGroup' pages/groups.tsx && grep -q 'rawRateLimitPerDm' pages/messages.tsx"
        status: pass
    human_judgment: false
  - id: D4
    description: "perGroup/perDm are merged into newConfig.rateLimit as top-level siblings of perType, preserving the existing perType field on save"
    requirement: "D7-08"
    verification:
      - kind: other
        ref: "grep -q 'perGroup: rateLimitPerGroup' pages/groups.tsx && grep -q 'perDm: rateLimitPerDm' pages/messages.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "Each new field's help text states 0 = unlimited"
    requirement: "D7-08"
    verification:
      - kind: other
        ref: "grep -iq '0 = unlimited' pages/groups.tsx && grep -iq '0 = unlimited' pages/messages.tsx"
        status: pass
    human_judgment: false
  - id: D6
    description: "bun run lint (tsc --noEmit) and bun test are green after both pages are extended"
    requirement: "D7-06"
    verification:
      - kind: other
        ref: "bun run lint"
        status: pass
      - kind: unit
        ref: "bun test (174/174 pass)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Manual UAT: new fields render current value, save via PATCH, persist across reload, and do not disturb the existing per-type field, on a live UI"
    verification: []
    human_judgment: true
    rationale: "Requires the running app UI and a signer for the encrypted kind-30078 sync round trip -- deferred consistent with Phase 6 (07-04-PLAN.md verification section)."

# Metrics
duration: 6min
completed: 2026-07-13
status: complete
---

# Phase 7 Plan 04: Default Rate-Limit UI Fields for /groups and /messages Summary

**Added `rateLimitPerGroup`/`rateLimitPerDm` number inputs to `pages/groups.tsx`/`pages/messages.tsx`, each a second field alongside the existing `rateLimitPerType` input, clamped and merged as top-level siblings of `perType` in `AppConfig.rateLimit`.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-13T21:57:17Z
- **Completed:** 2026-07-13T22:03:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `pages/groups.tsx` gained a `rateLimitPerGroup` number input (id/data-bind/min="0") bound to `currentConfig.rateLimit.perGroup`, positioned as a second `form-group` below the existing `rateLimitPerType` block, with help text describing the per-group cap and "0 = unlimited."
- `pages/messages.tsx` gained a `rateLimitPerDm` number input bound to `currentConfig.rateLimit.perDm`, mirroring the same pattern below its own existing `rateLimitPerType` block.
- Both PATCH handlers gained a clamp block (`rawRateLimitPerGroup`/`rawRateLimitPerDm` -> `Number.isFinite(x) && x >= 0 ? Math.floor(x) : currentConfig.rateLimit.perGroup/.perDm`) mirroring the existing `rateLimitPerType` clamp verbatim (ASVS V5, T-07-09).
- Both PATCH handlers merge the clamped value into `newConfig.rateLimit` as a top-level sibling of `perType` (e.g. `{ ...currentConfig.rateLimit, perGroup: rateLimitPerGroup, perType: {...} }`), preserving the existing per-type field untouched (T-07-10).
- Distinct signal names (`rateLimitPerGroup`/`rateLimitPerDm`) were used throughout so the existing `rateLimitPerType` field's PATCH read is not collided with (Pitfall 7) -- verified by an unchanged `grep -c 'rateLimitPerType'` count on both files (6 each, before and after).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the default-per-group field to /groups** - `db67124` (feat)
2. **Task 2: Add the default-per-DM field to /messages** - `b88da47` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `pages/groups.tsx` - Added `rateLimitPerGroup` form-group input + PATCH clamp/merge, second field alongside `rateLimitPerType`.
- `pages/messages.tsx` - Added `rateLimitPerDm` form-group input + PATCH clamp/merge, second field alongside `rateLimitPerType`.

## Decisions Made
- Reused the exact clamp expression from each page's existing `rateLimitPerType` handler rather than extracting a shared helper -- minimal diff, matches the plan's "mirroring verbatim" instruction.
- Merged `perGroup`/`perDm` as top-level siblings of `perType` (not nested), consistent with Plan 02's `AppConfig.rateLimit` shape.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- This is the final plan of Phase 7. All four plans (accounting core, config+sync, shell threading, UI fields) are code-complete.
- `bun run lint` (tsc --noEmit) and `bun test` (174/174) are both clean at this final gate.
- UAT for the two new fields (live render, PATCH save, reload persistence, no disturbance of the existing per-type field) is deferred to a live-UI + signer session, consistent with Phase 6's deferred UAT pattern (see 07-04-PLAN.md verification section). Resume with `/gsd-verify-work 7` when a signer/UI is available.
- No blockers.

---
*Phase: 07-default-rate-limit-for-chat-groups-and-dms-on-join*
*Completed: 2026-07-13*

## Self-Check: PASSED

- FOUND: pages/groups.tsx
- FOUND: pages/messages.tsx
- FOUND: .planning/phases/07-default-rate-limit-for-chat-groups-and-dms-on-join/07-04-SUMMARY.md
- FOUND: db67124
- FOUND: b88da47
