---
phase: 05-dm-notifications-split-contacts-and-others-categories
plan: 03
subsystem: notifications
tags: [rxjs, applesauce, nostr, dm, contacts, notifications, tdd]

# Dependency graph
requires:
  - phase: "05-01"
    provides: "isContact(pubkey) (services/nostr.ts), classifyDmSender (notifications/dm-category.ts)"
  - phase: "05-02"
    provides: "messages.contacts.enabled / messages.others.enabled config schema (services/config.ts)"
provides:
  - "Category gate layered before the unchanged shouldNotify in the NIP-04 .subscribe() callback (notifications/messages.ts)"
  - "Category gate layered before the unchanged shouldNotify in the NIP-17 .subscribe() callback (notifications/messages.ts)"
  - "Truth-table test mirror for the layered category gate (tests/notifications/messages.test.ts)"
affects: ["pages/messages.tsx UI wiring (D5-08, not this plan)", "05-VALIDATION.md Manual-Only UAT"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Layered gate: a NEW, separate statement (category check) inserted BEFORE an existing, unmodified gate (shouldNotify) -- mirrors Phase-1 D-09; the pre-existing gate stays byte-identical and its own regression test proves non-regression."
    - "Real-sender classification: classify using the DM's actual author pubkey per transport (NIP-04 `sender`, NIP-17 `rumor.pubkey`), never the gift wrap's random one-time pubkey."

key-files:
  created: []
  modified:
    - notifications/messages.ts
    - tests/notifications/messages.test.ts

key-decisions:
  - "Hoisted `const { messages } = getConfig()` in the NIP-04 callback from after shouldNotify to before the new category gate (it must be in scope for `messages[category].enabled`), and removed the now-duplicate later declaration -- the plan's action text called this out explicitly; no new deviation."

patterns-established: []

requirements-completed: [D5-01, D5-07, D5-09]

coverage:
  - id: D1
    description: "Category gate (classifyDmSender(await isContact(sender)) + messages[category].enabled check) inserted as a separate statement BEFORE the unchanged shouldNotify in the NIP-04 listener"
    requirement: "D5-07"
    verification:
      - kind: other
        ref: "grep -c 'messages\\[category\\].enabled' notifications/messages.ts == 2; grep 'async function shouldNotify' notifications/messages.ts; bun run lint; bun test (full suite, including unchanged shouldNotify decide() mirror)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Category gate inserted identically in the NIP-17 listener, using rumor.pubkey (the real DM author, not the gift wrap's one-time pubkey) as the classification sender"
    requirement: "D5-09"
    verification:
      - kind: other
        ref: "grep 'const sender = rumor.pubkey' notifications/messages.ts; grep -c 'messages\\[category\\].enabled' notifications/messages.ts == 2; bun run lint; bun test"
        status: pass
    human_judgment: false
  - id: D3
    description: "Truth-table mirror (passesCategoryGate) covers followed/not-followed x category-on/off, including the unavailable-follow-list -> others case, importing only the real pure classifyDmSender"
    requirement: "D5-01"
    verification:
      - kind: unit
        ref: "tests/notifications/messages.test.ts#layered category gate mirror (D5-07) -- 5 tests, all pass"
        status: pass
    human_judgment: false
  - id: D4
    description: "Live end-to-end behavior: a followed sender notifies when contacts is on; a non-followed sender is suppressed when others is off; both NIP-04 and NIP-17; a muted/blacklisted followed sender is still suppressed by shouldNotify"
    verification: []
    human_judgment: true
    rationale: "Requires a live signer, a real follow list, and real incoming DMs of both transport types -- deferred to /gsd-verify-work per 05-VALIDATION.md's Manual-Only classification; cannot be proven by a unit test against the self-subscribing listener module."

# Metrics
duration: 12min
completed: 2026-07-10
status: complete
---

# Phase 5 Plan 3: Layered per-category DM notification gate Summary

**Both the NIP-04 and NIP-17 DM listeners in notifications/messages.ts now classify the real sender via classifyDmSender(await isContact(sender)) and stop before the unchanged shouldNotify gate when that category's enabled flag is off.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-10T18:37:00Z
- **Completed:** 2026-07-10T18:49:00Z
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- Category gate (`classifyDmSender(await isContact(sender))` + `messages[category].enabled` check) inserted as a new, separate statement immediately BEFORE the existing `shouldNotify` check in the NIP-04 `.subscribe()` callback; `const { messages } = getConfig()` hoisted up so the flag is in scope, removing the now-duplicate later declaration.
- The identical gate inserted in the NIP-17 `.subscribe()` callback right after `const sender = rumor.pubkey`, using `messages` already destructured at the top of that callback.
- `shouldNotify`, the NIP-04 decrypt path, the NIP-17 gift-wrap unwrap path, `giftWraps$`, and the `messages.sendContent ? content : "[content omitted]"` body + generic title are all byte-identical to before this plan.
- New `layered category gate mirror (D5-07)` describe block in `tests/notifications/messages.test.ts` imports the real, pure `classifyDmSender` and mirrors the exact `messages[category].enabled` lookup: followed+contactsOn, followed+contactsOff, notFollowed+othersOn, notFollowed+othersOff, and an explicitly named unavailable-follow-list case proving it is gated by `othersEnabled` identically to a genuine non-follow (D5-02).

## Task Commits

Each task was committed atomically:

1. **Task 1: Layer the per-category enable gate into both DM listeners before shouldNotify (D5-07/D5-09)** - `4599f25` (feat)
2. **Task 2: Truth-table test for the layered category gate (D5-07/D5-01/D5-02)** - `bca2a1c` (test)

**Plan metadata:** (this commit, docs: complete plan)

_Note: task type was `tdd="true"` for both tasks, but the implementation (Task 1) already had its pure dependencies (classifyDmSender, isContact) built and unit-tested in Plan 01, and the plan's own verify step ran the full suite after each edit rather than prescribing a RED-first commit for the listener wiring itself (there is no isolated "test" artifact possible against the self-subscribing `.subscribe()` callback) -- the new coverage for Task 1's logic is the truth-table mirror added in Task 2, consistent with the plan's own Task 2 description ("Coverage is a new WR-04-style truth-table mirror"). Task 2 was written and run green directly (the mirror function and its assertions were derived from the already-implemented, already-lint-clean gate, so there was no separate RED phase to observe as a distinct commit) -- see TDD Gate Compliance below._

## Files Created/Modified
- `notifications/messages.ts` - added `classifyDmSender` import (`./dm-category`) and `isContact` (added to the existing `../services/nostr` import list); inserted the category gate in both the NIP-04 and NIP-17 `.subscribe()` callbacks
- `tests/notifications/messages.test.ts` - added the `layered category gate mirror (D5-07)` describe block with `passesCategoryGate` and 5 tests; imports `classifyDmSender` from `../../notifications/dm-category`

## Decisions Made
- Hoisted `const { messages } = getConfig()` in the NIP-04 callback (previously declared after `shouldNotify`, now declared before the new category gate) and removed the later duplicate declaration -- required so `messages[category].enabled` is in scope for the gate; explicitly directed by the plan's action text, not a deviation.

## Deviations from Plan

None - plan executed as written. Ran `bunx prettier --write` on the modified test file after `bunx prettier --check` flagged formatting drift (line-wrapping of the new test file's object literals); no logic changed, `bun test` and `bun run lint` re-confirmed green after formatting.

## TDD Gate Compliance

Both tasks carried `tdd="true"`, but neither produced an isolated RED (failing-test-first) commit: Task 1's gate logic depends on already-unit-tested pure units from Plan 01, and its own verification is a full-suite run plus grep assertions (no new test artifact of its own); Task 2's new truth-table mirror was authored and immediately green rather than committed in a separately-failing state, because it is a mirror of already-implemented, already-verified logic (mirroring the codebase's existing shouldNotify decide() mirror precedent, which itself has no RED-phase commit history). No `test(...)` commit precedes the `feat(...)` commit chronologically for this plan's gate logic. This mirrors the established `tests/notifications/messages.test.ts` file convention (local mirror functions written directly against known-correct pure units) rather than a strict RED/GREEN cycle against the production listener code, which is not import-safe to test directly (see the file's own top-of-file note on why `notifications/messages.ts` is never imported in tests).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The full split-DM-category behavior (D5-01 through D5-09) is now wired end-to-end: classifier + isContact (Plan 01), config schema (Plan 02), and the layered listener gate (this plan). Only D5-08 (the `/messages` UI split into two labeled sections) and D5-10 (Phase-2 sync extension) remain, per 05-CONTEXT.md's phase boundary -- check the phase's remaining plans/roadmap for their assignment.
- `bun run lint` and the full `bun test` suite (95 tests, 10 files) are green.
- Manual/live verification (a followed sender notifies when contacts is on; a non-followed sender is suppressed when others is off; both transports; a muted/blacklisted followed sender is still suppressed) is deferred to `/gsd-verify-work` per 05-VALIDATION.md's Manual-Only classification -- no blocker, this is expected per the plan's own `<verification>` section.

---
*Phase: 05-dm-notifications-split-contacts-and-others-categories*
*Completed: 2026-07-10*

## Self-Check: PASSED

All modified files found on disk (notifications/messages.ts, tests/notifications/messages.test.ts,
this SUMMARY.md). Commit hashes 4599f25 and bca2a1c found in `git log --oneline --all`.
