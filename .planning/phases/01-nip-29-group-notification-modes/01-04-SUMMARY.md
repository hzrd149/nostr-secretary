---
phase: 01-nip-29-group-notification-modes
plan: 04
subsystem: ui
tags: [datastar, kitajs-html, applesauce, nip-29, asvs-v5]

# Dependency graph
requires:
  - phase: 01-nip-29-group-notification-modes (plan 01)
    provides: "helpers/groups.ts pure exports: GroupNotificationMode, getGroupMode, isGroupNotificationMode"
  - phase: 01-nip-29-group-notification-modes (plan 02)
    provides: "AppConfig.groups.modes field with migration backfill; PATCH already preserved modes as a placeholder"
provides:
  - "pages/groups.tsx: async GroupsConfigView rendering a per-group mode list (D-03/D-04)"
  - "pages/groups.tsx: getJoinedGroups() shared server-side helper reused by both GET and PATCH"
  - "pages/groups.tsx PATCH: validated per-group mode persistence into config.groups.modes (D-01/D-06, ASVS V5/T-01-01)"
affects: [01-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared local async helper (getJoinedGroups) extracted once and called from both GET and PATCH, guaranteeing the filter/map chain is byte-identical rather than duplicated (Pitfall 2)"
    - "Aliased dual-purpose applesauce imports (fetchGroupMetadataEvent + parseGroupMetadata) to resolve a same-name export collision (Pitfall 4)"
    - "Index-based Datastar data-bind names (mode_0, mode_1, ...) re-keyed to encodeGroupPointer server-side, never bound directly to signal-unsafe pointer strings (Pitfall 2)"

key-files:
  created: []
  modified:
    - pages/groups.tsx

key-decisions:
  - "getJoinedGroups() extracted as a single shared function (not copy-pasted in GET and PATCH) so the 'same filter/map chain' invariant required by the plan is structurally guaranteed, not just conventionally followed"
  - "groups$.pipe(defined(), timeout({first: 5000, with: () => of(undefined)})) added around the joined-groups list derivation so a user with no kind 10009 list at all (defined() would otherwise wait forever) still renders the empty state instead of hanging the request"
  - "PATCH seeds the new modes map from the existing config.groups.modes (not an empty object) before overwriting entries for currently-joined groups, so modes for groups the user has since left survive across saves (D-10) instead of being silently pruned every time Save is clicked"
  - "Mode status badge implemented as inline styles (not a new CSS class) since pages/groups.tsx has no page-level <style> block like pages/notifications.tsx's notificationStyles; the exact UI-SPEC color triples are still followed verbatim"

requirements-completed: [D-01, D-03, D-04, D-06]

coverage:
  - id: D1
    description: "The /groups page renders one row per joined group with avatar/placeholder, name/fallback, and a mode dropdown preset to the group's current effective mode (D-03/D-04)"
    requirement: "D-03"
    verification:
      - kind: unit
        ref: "bun run lint (tsc --noEmit strict typecheck)"
        status: pass
      - kind: manual_procedural
        ref: "curl smoke test against a running `bun run --watch index.ts` instance confirmed the empty-state path renders (200 OK, 'No groups joined yet'); no signer/joined-group fixture was exercised for the non-empty row path in this session"
        status: pass
    human_judgment: true
    rationale: "Full non-empty-list rendering (avatar/name/dropdown per real joined group) requires a live signer with an actual NIP-29 group membership; no Playwright config exists this phase per RESEARCH Validation Architecture, so the multi-row visual layout needs a human `bun run dev` check per the plan's human-check instructions."
  - id: D2
    description: "Each row's mode badge is colored per the UI-SPEC per-group mode triples (All #d4edda/#155724/#c3e6cb, mentions #fff3cd/#856404/#ffeaa7, muted #f8d7da/#721c24/#f5c6cb)"
    requirement: "D-03"
    verification:
      - kind: unit
        ref: "bun run lint (tsc --noEmit); grep-verified exact hex triples present in pages/groups.tsx MODE_BADGE constant"
        status: pass
    human_judgment: false
  - id: D3
    description: "isGroupNotificationMode aliased imports resolve without a duplicate-identifier compile error; the two getGroupMetadata functions are aliased (fetchGroupMetadataEvent, parseGroupMetadata)"
    verification:
      - kind: unit
        ref: "bun run lint (tsc --noEmit strict typecheck)"
        status: pass
    human_judgment: false
  - id: D4
    description: "PATCH validates every submitted mode_N signal with isGroupNotificationMode before writing to config.groups.modes; unrecognized values are ignored (ASVS V5, T-01-01)"
    requirement: "D-01"
    verification:
      - kind: unit
        ref: "bun test tests/helpers/groups.test.ts#isGroupNotificationMode (validator proven by Plan 01's suite, reused unchanged by this PATCH handler)"
        status: pass
      - kind: manual_procedural
        ref: "curl PATCH smoke test with mode_0=\"evil-mode\" against a running dev instance confirmed no invalid key was written to config.json"
        status: pass
    human_judgment: false
  - id: D5
    description: "Saving persists each group's mode into config.groups.modes keyed by encodeGroupPointer, preserving enabled/groupLink/whitelists/blacklists and orphaned entries for left groups (D-01/D-06/D-10)"
    requirement: "D-06"
    verification:
      - kind: unit
        ref: "bun run lint (tsc --noEmit)"
        status: pass
      - kind: manual_procedural
        ref: "curl PATCH smoke test against a temp config fixture with a pre-existing orphaned groups.modes entry confirmed the entry survived the save unmodified"
        status: pass
    human_judgment: false
  - id: D6
    description: "Full existing test suite and full-page reload persistence (dropdown retains saved value) still work"
    verification:
      - kind: unit
        ref: "bun test (full suite): 25 pass, 0 fail"
        status: pass
      - kind: manual_procedural
        ref: "Reload-persistence UAT (change a dropdown, Save, reload /groups, confirm value retained) requires a live signer with joined groups"
        status: unknown
    human_judgment: true
    rationale: "This exact reload-round-trip check needs a real signer session with at least one joined NIP-29 group; not exercised in this execution session since no such fixture/signer was available, and no Playwright harness exists this phase."

duration: ~35min
completed: 2026-07-07
status: complete
---

# Phase 01 Plan 04: Per-Group Notification Mode Controls on /groups Summary

**Async /groups GET rendering a per-group mode dropdown list (with avatar/name fallbacks and UI-SPEC-colored status badges) plus an extended PATCH that validates every submitted mode with `isGroupNotificationMode` before persisting it into `config.groups.modes`, never trusting the client-submitted string verbatim.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-07T22:14:52Z (approx., per STATE.md prior session marker)
- **Completed:** 2026-07-07T22:23:24Z
- **Tasks:** 2 completed
- **Files modified:** 1 (pages/groups.tsx)

## Accomplishments
- Made `GroupsConfigView` async and added a shared `getJoinedGroups()` helper that derives the joined-groups list from `groups$` using the exact `.filter((t) => t[0] === "group" && t[1]).map(getGroupPointerFromGroupTag)` chain used by `services/nostr.ts` and `notifications/groups.ts` — extracted once so GET and PATCH cannot drift out of lockstep (Pitfall 2)
- Rendered a "Joined Groups" section (inserted between the existing Group Link Template block and `<WhitelistBlacklist>`) with one row per group: 40px avatar or a 👥 placeholder circle, name or an italic muted-gray "Unnamed group" fallback, a colocated mode status badge using the exact UI-SPEC hex triples, and an index-based `<select data-bind={`mode_${index}`}>` preset via `getGroupMode`
- Aliased the two same-named `getGroupMetadata` functions on import (`fetchGroupMetadataEvent` from `helpers/groups.ts`, `parseGroupMetadata` from `applesauce-common/helpers`), resolving Pitfall 4 with zero duplicate-identifier errors
- Rendered the UI-SPEC empty-state copy ("No groups joined yet" + body) when there are zero joined groups, including the edge case where the user has no kind 10009 list at all (handled via a `defined()` + 5s `timeout` fallback so the request never hangs)
- Extended the existing PATCH handler to re-derive `joinedGroups` via the same shared `getJoinedGroups()`, validate each `mode_N` signal with `isGroupNotificationMode` (ASVS V5 / T-01-01), and merge validated modes into a copy of the existing `config.groups.modes` map (preserving orphaned entries for groups the user has since left, per D-10) rather than rebuilding it from scratch
- Kept the existing `readSignals` / try-catch / `stream.patchSignals({saved:true})` success and error shapes completely unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Render the joined-groups list with mode dropdowns (GET)** - `78675fd` (feat)
2. **Task 2: Persist and validate per-group modes on save (PATCH + ASVS V5)** - `ff7be8c` (feat)

## Files Created/Modified
- `pages/groups.tsx` - Async `GroupsConfigView` with a shared `getJoinedGroups()` helper; new "Joined Groups" per-row list section with avatar/name/badge/dropdown and empty-state; extended PATCH handler validating and persisting per-group modes with orphan-preserving merge semantics

## Decisions Made
- `getJoinedGroups()` extracted as one shared function called by both GET and PATCH instead of duplicating the filter/map chain in two places — makes the plan's "same chain" requirement structurally true rather than something that could silently drift
- Added a `timeout({ first: 5000, with: () => of(undefined) })` fallback around the `defined()`-filtered `groups$` subscription so a user with no kind 10009 list at all (a case where `defined()` would otherwise never emit) still renders the empty state within a bounded time, instead of hanging the GET request indefinitely — this directly serves the plan's explicit "zero joined groups" empty-state requirement, which cannot be satisfied by a request that never resolves
- PATCH seeds the new `modes` map from `currentConfig.groups.modes` (spread first, then overwrite entries for currently-joined groups) rather than building an empty object from scratch, so a group's mode setting isn't silently deleted from `config.json` the next time the user clicks Save after leaving that group — matches RESEARCH.md's D-10 guidance that orphaned entries should persist harmlessly, not be pruned
- The mode status badge uses inline styles rather than a new CSS class, since `pages/groups.tsx` has no page-level `<style>` block (unlike `pages/notifications.tsx`'s `notificationStyles`); the exact UI-SPEC background/text/border hex triples are reproduced verbatim either way

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added a bounded timeout fallback around the joined-groups list derivation**
- **Found during:** Task 1, while implementing `getJoinedGroups()`
- **Issue:** The plan's illustrative pattern (`01-PATTERNS.md`/`01-RESEARCH.md` Pattern 3) uses `firstValueFrom(groups$.pipe(defined(), map(...)))` with no timeout. `groups$`'s underlying `eventStore.replaceable(...)` can legitimately never emit a defined value for a user who has published no kind 10009 group list at all (as opposed to one with a list containing zero group tags) — in that case `defined()` filters everything out forever and the GET request would hang indefinitely, directly preventing the plan's own must-have ("When the user has joined zero groups, an empty-state message is shown instead of the list") from ever being satisfiable for that specific case.
- **Fix:** Wrapped the `defined()`-filtered subscription in `timeout({ first: 5000, with: () => of(undefined) })`, mirroring the exact timeout-with-fallback idiom already used elsewhere in this codebase (`helpers/groups.ts`'s `getGroupMetadata`, `components/WhitelistBlacklist.tsx`, `services/nostr.ts`'s `isMuted`) rather than inventing a new pattern.
- **Files modified:** `pages/groups.tsx`
- **Verification:** Live smoke test against a config fixture with no `pubkey` set (so `groups$` never emits a defined value) confirmed the GET request returns `200` with the "No groups joined yet" empty-state copy within a few seconds rather than hanging.
- **Committed in:** `78675fd` (Task 1 commit)

**2. [Rule 1 - Bug] PATCH rebuilding `modes` from scratch would have silently pruned orphaned entries on every save**
- **Found during:** Task 2, while extending the PATCH handler
- **Issue:** A literal reading of the plan's PATCH pseudocode (`const modes: Record<string, GroupNotificationMode> = {}` built fresh from `joinedGroups.forEach(...)`) would replace the entire `config.groups.modes` map with only entries for currently-joined groups on every Save click — silently deleting any previously-set mode for a group the user has since left. This contradicts `01-RESEARCH.md`'s explicit D-10 guidance: "If a user leaves a group, its entry simply becomes orphaned (harmless...). No explicit garbage collection is required for Phase 1."
- **Fix:** Seeded the `modes` object from `{ ...currentConfig.groups.modes }` before overwriting entries for currently-joined groups with their validated submitted value, so orphaned entries survive untouched across saves.
- **Files modified:** `pages/groups.tsx`
- **Verification:** Live smoke test with a config fixture pre-seeded with an orphaned `groups.modes` entry (for a group not in the empty joined-groups list) confirmed the entry was still present, byte-identical, in `config.json` after a PATCH round-trip.
- **Committed in:** `ff7be8c` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 missing-critical-functionality fix, 1 data-loss bug fix)
**Impact on plan:** Both fixes are corrections that make the plan's own stated requirements (empty-state must render; D-10 orphan survival) actually hold, not scope additions. No new files, no new dependencies, no behavior beyond what the plan's must-haves already specified.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `pages/groups.tsx` now fully implements D-01/D-03/D-04/D-06: per-group mode list rendering, validated persistence, and D-10 orphan-preserving merge semantics.
- Full-page visual verification with a real signer that has joined ≥1 NIP-29 group (avatar, name, dropdown, badge rendering side-by-side; reload-persistence check) was not exercised in this session — no live signer/group fixture was available and no Playwright harness exists this phase (per RESEARCH Validation Architecture). Flagged as `human_judgment: true` coverage items (D1, D6) for a manual `bun run dev` pass.
- No blockers for Plan 05.

---
*Phase: 01-nip-29-group-notification-modes*
*Completed: 2026-07-07*

## Self-Check: PASSED

- FOUND: pages/groups.tsx
- FOUND: 78675fd (Task 1 commit)
- FOUND: ff7be8c (Task 2 commit)
