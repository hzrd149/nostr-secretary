---
phase: 06-notification-rate-limiting-per-type-and-global-with-grouped
plan: 04
subsystem: ui
tags: [datastar, tsx, bun, rate-limit, config-ui]

# Dependency graph
requires:
  - phase: 06-notification-rate-limiting-per-type-and-global-with-grouped
    provides: "config.rateLimit shape (AppConfig.rateLimit + DEFAULT_RATE_LIMIT_CONFIG) from Plan 02"
provides:
  - "Per-type rate-limit number input (0=unlimited) on pages/replies.tsx, zaps.tsx, messages.tsx, groups.tsx"
  - "notifications.tsx's first-ever PATCH route plus global-limit and window number inputs"
affects: [06-verify-work, 07-per-context-rate-limiting]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Page-local non-negative-integer clamp (finite >= 0, Math.floor) inline in each PATCH handler, mirroring the asNonNegativeInt discipline without importing it"
    - "Sibling-preserving merge: spread currentConfig.rateLimit (and .perType for per-type pages) so a single-field save never clobbers other rateLimit fields"

key-files:
  created: []
  modified:
    - pages/replies.tsx
    - pages/zaps.tsx
    - pages/messages.tsx
    - pages/groups.tsx
    - pages/notifications.tsx

key-decisions:
  - "notifications.tsx's PATCH handler and message divs were copied verbatim from pages/replies.tsx's shape (per plan instruction), since notifications.tsx had no prior PATCH/data-bind/data-show surface"
  - "Input value attributes use String(...) around the numeric config field, matching the JSX runtime's expectation that <input value> be a string (tsc caught this; not called out separately as a deviation since it's a mechanical type-fit, not a behavior change)"

patterns-established:
  - "0=unlimited rate-limit number input: type=\"number\" min=\"0\" + flat Datastar signal + '0 = unlimited' help text, clamped server-side before merge"

requirements-completed: [D6-08]

coverage:
  - id: D1
    description: "Per-type rate-limit number input (0=unlimited) added to pages/replies.tsx, zaps.tsx, messages.tsx, groups.tsx, wired to config.rateLimit.perType.<type> with sibling-preserving clamped PATCH merge"
    requirement: "D6-08"
    verification:
      - kind: unit
        ref: "bun test (full suite, no regression)"
        status: pass
      - kind: other
        ref: "bun run lint (tsc --noEmit strict + noUncheckedIndexedAccess) -- field paths match AppConfig.rateLimit"
        status: pass
    human_judgment: true
    rationale: "Rendering, saving, persistence across reload, and sibling-preservation across 4 live pages require a human to visit each page in a browser and observe the Datastar round-trip -- not covered by the existing automated suite (no route-level HTTP test harness in this repo)."
  - id: D2
    description: "pages/notifications.tsx gains its first-ever PATCH route plus global-limit and window number inputs (0=unlimited), clamped and merged at the rateLimit top level while preserving per-type limits and the existing GET view"
    requirement: "D6-08"
    verification:
      - kind: unit
        ref: "bun test (full suite, no regression)"
        status: pass
      - kind: other
        ref: "bun run lint (tsc --noEmit) -- confirms rateLimit.global/.window field paths"
        status: pass
    human_judgment: true
    rationale: "Confirming the new PATCH doesn't break the existing GET/dashboard view, and that the saved indicator + persistence work end-to-end, requires a human to load /notifications in a browser."

duration: 25min
completed: 2026-07-10
status: complete
---

# Phase 6 Plan 04: Minimal Rate-Limit UI Summary

**Added 0=unlimited rate-limit number inputs to all five notification config pages, including notifications.tsx's first-ever PATCH route, each clamping to a non-negative integer server-side and sibling-preserving on save.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-10T20:54:00Z
- **Completed:** 2026-07-10T21:19:42Z
- **Tasks:** 2 completed
- **Files modified:** 5

## Accomplishments
- Added a per-type rate-limit number input (min=0, "0 = unlimited" help text) to pages/replies.tsx, zaps.tsx, messages.tsx, groups.tsx, each bound to a flat `rateLimitPerType` Datastar signal.
- Extended each of those four pages' existing PATCH handler to clamp the incoming signal to a non-negative integer and merge it into `rateLimit.perType.<type>`, spreading the rest of `rateLimit` + `perType` so sibling limits are never dropped.
- Gave pages/notifications.tsx its first-ever PATCH route (templated from pages/replies.tsx), plus a global-limit input and a window input (both min=0, "0 = unlimited" help text) and the saved/error message divs it previously lacked.
- notifications.tsx's new PATCH merges `rateLimit.global` / `rateLimit.window` at the top level, spreading the rest of `currentConfig.rateLimit` so the four per-type limits survive a global/window-only save.

## Task Commits

Each task was committed atomically:

1. **Task 1: Per-type rate-limit number input on the four type pages (D6-08)** - `6191242` (feat)
2. **Task 2: First PATCH route + global & window inputs on pages/notifications.tsx (D6-08, RESEARCH Pitfall 7)** - `7c5520c` (feat)

_No TDD tasks in this plan (UI-only, type="auto")._

## Files Created/Modified
- `pages/replies.tsx` - Adds `rateLimitPerType` number input + PATCH-side clamp/merge into `rateLimit.perType.replies`
- `pages/zaps.tsx` - Adds `rateLimitPerType` number input + PATCH-side clamp/merge into `rateLimit.perType.zaps`
- `pages/messages.tsx` - Adds `rateLimitPerType` number input + PATCH-side clamp/merge into `rateLimit.perType.messages`
- `pages/groups.tsx` - Adds `rateLimitPerType` number input + PATCH-side clamp/merge into `rateLimit.perType.groups`
- `pages/notifications.tsx` - Adds first-ever PATCH route + `rateLimitGlobal`/`rateLimitWindow` inputs + saved/error message divs; merges into `rateLimit.global`/`rateLimit.window` at the top level

## Decisions Made
- Followed the plan's explicit instruction to template notifications.tsx's new PATCH handler verbatim from pages/replies.tsx's shape rather than inventing a new pattern, since notifications.tsx had no prior mutating route.
- Wrapped each `<input value={...}>` in `String(...)` around the numeric config field -- the project's JSX runtime types `value` as a string (confirmed by `tsc` during lint), matching the existing `groupLink` text-input precedent in groups.tsx. This is a mechanical type-fit, not a behavior or scope change.

## Deviations from Plan

None - plan executed exactly as written. The `String(...)` wrapper on `value=` was required by tsc's existing JSX typing (an implementation detail of matching the plan's "min=0 number input... initial value read from config" instruction) and is not a functional deviation.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All five pages now expose the minimal D6-08 rate-limit controls; `bun run lint` and `bun test` are green.
- Human verification of render/save/persist/sibling-preservation across all five pages (recorded above as coverage D1/D2, `human_judgment: true`) is outstanding and should be captured as UAT items by `/gsd-verify-work`.
- Phase 7 (per-context rate limiting) can build on the `rateLimit.perType`/`.global`/`.window` shape without further changes to these pages.

---
*Phase: 06-notification-rate-limiting-per-type-and-global-with-grouped*
*Completed: 2026-07-10*
