---
phase: 02-save-notification-preferences-as-encrypted-1xxxx-nostr-event
plan: 04
subsystem: ui
tags: [rxjs, kitajs-html, notifications, nostr, applesauce]

# Dependency graph
requires:
  - phase: 02-save-notification-preferences-as-encrypted-1xxxx-nostr-event
    provides: "services/preferences.ts enabled$ (Plan 02-03) — sync-active signal derived from config$ + signer$"
provides:
  - "Non-blocking sync-status hint on /notifications, gated on signer presence"
affects: [notifications-ui, signer-onboarding]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Async server component (SyncStatusHint) reading a shared enabled$ observable via firstValueFrom(...).catch(() => false), matching the existing per-type enabled$ reads in the same file"

key-files:
  created: []
  modified:
    - "pages/notifications.tsx"

key-decisions:
  - "Aliased the imported enabled$ as prefsSyncEnabled$ to avoid name collision with the per-notification-type enabled$ observables already imported (messages/replies/zaps/groups)"
  - "When sync is active, render a subtle confirmation message rather than nothing, per D2-12's open item on sync-status UI (Claude's discretion, called out explicitly in the plan)"
  - "Added .sync-hint / .sync-hint.sync-enabled CSS rules directly to the existing notificationStyles template string rather than a new stylesheet, per CONVENTIONS.md and the plan's explicit constraint"

patterns-established:
  - "Cross-service UI signal reads: import an aliased observable from a services/ module and read via firstValueFrom(...).catch(() => false) inside an async page component, so the UI and background listeners agree on the same signal without duplicating logic"

requirements-completed: [D2-12]

coverage:
  - id: D1
    description: "Non-blocking no-signer hint on /notifications linking to /signer, gated on the same enabled$ signal used by the sync listener"
    requirement: "D2-12"
    verification:
      - kind: unit
        ref: "bun test (full suite, 45 pass / 0 fail) — no regression; no test imports the live page module"
        status: pass
      - kind: other
        ref: "bun run lint (tsc --noEmit) — clean"
        status: pass
      - kind: other
        ref: "grep -qF 'href=\"/signer\"' pages/notifications.tsx; grep -qF 'prefsSyncEnabled$' pages/notifications.tsx; grep -qi sync pages/notifications.tsx"
        status: pass
    human_judgment: true
    rationale: "Automated checks confirm the code compiles, tests pass, and the expected markers (signer link, aliased import, sync copy) are present, but visually confirming the hint appears/disappears correctly with and without a live signer connection requires a human (carried to /gsd-verify-work per the plan's own verification section)."

# Metrics
duration: 12min
completed: 2026-07-09
status: complete
---

# Phase 02 Plan 04: No-Signer Sync Hint Summary

**Added a non-blocking sync-status hint to /notifications that reads services/preferences.enabled$ and links read-only (no-signer) users to /signer to enable cross-device settings sync.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-09T23:33:00Z
- **Completed:** 2026-07-09T23:45:01Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- `pages/notifications.tsx` imports `enabled$` from `services/preferences` aliased as `prefsSyncEnabled$` to avoid colliding with the existing per-type `enabled$` imports (messages/replies/zaps/groups)
- New async `SyncStatusHint()` component reads the shared sync-active signal via `firstValueFrom(prefsSyncEnabled$).catch(() => false)`, matching the file's existing read pattern
- When no signer is connected, renders a non-blocking `.sync-hint` card: "Connect a signer to sync your settings across devices." with a link to `/signer`
- When a signer is connected, renders a subtle "Settings sync is enabled" confirmation instead (no error state, no blocking element)
- Composed into `NotificationsView` above `NotificationOverview` so it's visible without scrolling
- Added `.sync-hint` / `.sync-hint.sync-enabled` rules to the existing `notificationStyles` template string (no new stylesheet)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the non-blocking no-signer sync hint to /notifications** - `c3755b9` (feat)

**Plan metadata:** committed separately per worktree protocol (SUMMARY.md only; STATE.md/ROADMAP.md owned by orchestrator)

## Files Created/Modified
- `pages/notifications.tsx` - Added `prefsSyncEnabled$` import, `SyncStatusHint` async component, its composition into `NotificationsView`, and `.sync-hint` CSS rules

## Decisions Made
- Aliased the import as `prefsSyncEnabled$` to avoid ambiguity with the per-type `enabled$` observables already in scope in this file
- Rendered a subtle confirmation ("Settings sync is enabled.") when sync is active, rather than nothing, per the plan's discretion note on D2-12's open sync-status-UI question
- Followed the file's existing async-component + `firstValueFrom(...).catch(() => false)` pattern exactly rather than introducing a new data-fetching approach

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. The `bun run lint`, `bun test`, and all four grep acceptance checks passed on first implementation. (Note: the plan's literal verify command `grep -q "prefsSyncEnabled\$"` is a shell/regex quoting artifact — `$` is a regex end-of-line anchor in unescaped `grep -q`, so a plain `grep -q` invocation of that exact string will report "not found" even though the identifier is present; `grep -qF` or an escaped `\$` correctly confirms the match. Verified with `grep -qF 'prefsSyncEnabled$'`.)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- D2-12's user-facing loop is closed: no-signer users now have a discoverable path to /signer, and the hint agrees with the same `enabled$` signal the sync listener uses.
- This was the last plan in Phase 02 (wave 3, depends_on 02-03). Manual/UAT verification of the hint's visual show/hide behavior with a live signer connection is deferred to `/gsd-verify-work`, per the plan's own `<verification>` section (server-render + signal boolean logic is unit/typecheck-verifiable; the live signer round trip is not).

---
*Phase: 02-save-notification-preferences-as-encrypted-1xxxx-nostr-event*
*Completed: 2026-07-09*
