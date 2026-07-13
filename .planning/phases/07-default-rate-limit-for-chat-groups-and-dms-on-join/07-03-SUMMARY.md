---
phase: 07-default-rate-limit-for-chat-groups-and-dms-on-join
plan: 03
subsystem: notifications
tags: [rate-limiting, rxjs, bun-test, context-threading]

# Dependency graph
requires:
  - phase: 07-default-rate-limit-for-chat-groups-and-dms-on-join
    provides: "evaluate()'s pure, clock-injectable 5th `context?` argument and RateLimitConfig.perGroup/.perDm (Plan 01); AppConfig.rateLimit.perGroup/.perDm defaults + sync (Plan 02)."
provides:
  - "InjectedDeps.context?: string on services/rate-limit.ts's rateLimitedNotify options bag, threaded straight into evaluate()'s 5th argument."
  - "The group notification site (notifications/groups.ts) passes { context: encodeGroupPointer(group) }."
  - "Both DM notification sites (notifications/messages.ts, NIP-04 + NIP-17) pass { context: sender } -- the raw counterparty pubkey, no transport prefix, sharing one bucket per counterparty."
  - "Per-context isolation + no-context regression + flush-timer no-restart test coverage in tests/services/rate-limit.test.ts."
affects: [07-04-ui-fields]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Options-bag extension (not a new positional param) for threading context through rateLimitedNotify -- keeps all 4 non-chat call sites and every existing test call source-compatible."
    - "TDD RED/GREEN split for the choke-point change: failing per-context-isolation test committed first (context accepted but silently discarded), then the one-line evaluate() call change that makes it pass."

key-files:
  created: []
  modified:
    - services/rate-limit.ts
    - notifications/groups.ts
    - notifications/messages.ts
    - tests/services/rate-limit.test.ts

key-decisions:
  - "Both DM transports (NIP-04 sender, NIP-17 rumor.pubkey) pass the identical raw pubkey with zero transport decoration -- deliberate single messages:<pubkey> bucket per counterparty (Pitfall 4), matching Plan 01's evaluate() composite-key design."
  - "The flush-timer no-restart test asserts the invariant the RxJS pipeline actually keys on (clampWindowSeconds(cfg.window) projection unchanged after a perGroup/perDm-only write) rather than waiting on real timers -- deterministic, matches the plan's own stated acceptance approach."

patterns-established: []

requirements-completed: [D7-01, D7-03, D7-04, D7-09]

coverage:
  - id: D1
    description: "rateLimitedNotify accepts an optional context on its existing options bag and threads it into evaluate()'s 5th argument (D7-03)"
    requirement: "D7-03"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit.test.ts#rateLimitedNotify -- context threading (D7-01/D7-03) > per-context isolation: one group hitting perGroup does not block a DIFFERENT group's first notification in the same window"
        status: pass
    human_judgment: false
  - id: D2
    description: "The group notification site passes encodeGroupPointer(group); both DM sites pass the raw counterparty pubkey (D7-01/D7-03)"
    requirement: "D7-01"
    verification:
      - kind: unit
        ref: "grep -q 'context: encodeGroupPointer(group)' notifications/groups.ts && grep -c 'context: sender' notifications/messages.ts == 2"
        status: pass
    human_judgment: false
  - id: D3
    description: "A NIP-04 and a NIP-17 message from the same counterparty share ONE messages:<pubkey> bucket -- no transport-specific prefix (Pitfall 4)"
    requirement: "D7-01"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit-accounting.test.ts#evaluate -- DM counterparty sharing (D7-01, Pitfall 4) (Plan 01) + source review confirming both messages.ts sites pass raw `sender`"
        status: pass
    human_judgment: false
  - id: D4
    description: "The 4 non-chat call sites (replies/zaps) are unchanged and pass no context (D7-01)"
    requirement: "D7-01"
    verification:
      - kind: unit
        ref: "grep -L 'context:' notifications/replies.ts notifications/zaps.ts (both listed -- no match, unchanged)"
        status: pass
    human_judgment: false
  - id: D5
    description: "rateLimitedNotify never logs the raw context value -- log parity with the existing type-only line (Information Disclosure, T-07-06)"
    requirement: "D7-03"
    verification:
      - kind: unit
        ref: "grep -n 'log(\"Notification accumulated' services/rate-limit.ts shows only { type } logged"
        status: pass
    human_judgment: false
  - id: D6
    description: "The flush-timer pipeline (distinctUntilChanged on clampWindowSeconds(window)) is untouched -- a perGroup/perDm-only config write does NOT restart the flush interval (D7-09)"
    requirement: "D7-09"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit.test.ts#rateLimitedNotify -- flush-timer no-restart on perGroup/perDm-only write (D7-09) > a config write that changes ONLY perGroup/perDm leaves the flush timer's clampWindowSeconds(window) projection unchanged"
        status: pass
    human_judgment: false

# Metrics
duration: 3min
completed: 2026-07-13
status: complete
---

# Phase 7 Plan 03: Rate-Limit Shell Threading Summary

**Threaded the per-context key end-to-end through `rateLimitedNotify` into `evaluate()`'s 5th argument, wiring the group + both DM notification call sites to their per-context buckets, with a TDD-driven regression suite proving isolation, no-context parity, and flush-timer stability.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-13T21:53:00Z
- **Completed:** 2026-07-13T21:55:37Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `services/rate-limit.ts`'s `InjectedDeps` gained an optional `context?: string` key on the SAME options bag `rateLimitedNotify` already accepted -- not a new positional parameter, so all 4 non-chat call sites and every pre-existing test call remain source-compatible.
- `rateLimitedNotify` now destructures `{ now, send, context }` and passes `context` as `evaluate()`'s 5th argument, alongside the unchanged `{ ...rateLimit, window: clampWindowSeconds(rateLimit.window) }` config spread -- activating the per-context gate Plan 01 built.
- `notifications/groups.ts`'s single `rateLimitedNotify("groups", …)` call site now passes `{ context: encodeGroupPointer(group) }` -- each joined group gets its own bucket.
- Both `notifications/messages.ts` DM sites (NIP-04 and NIP-17) pass `{ context: sender }` -- the identical raw counterparty pubkey with no transport prefix, so one counterparty's NIP-04 and NIP-17 traffic share a single `messages:<pubkey>` bucket (Pitfall 4).
- `replies.ts`/`zaps.ts` untouched -- verified via `grep -L 'context:'` matching both files (no occurrence).
- 3 new test cases in `tests/services/rate-limit.test.ts`: per-context isolation (one group's overflow does not block a different group), no-context regression parity (replies shape), and a flush-timer no-restart assertion on a perGroup/perDm-only config write.
- Full suite: 174/174 tests pass; `bun run lint` (tsc --noEmit) clean.

## Task Commits

Each task was committed atomically (TDD RED/GREEN for Task 1):

1. **Task 1 RED: Add failing test for context threading** - `5dd24c4` (test)
2. **Task 1 GREEN: Thread context through rateLimitedNotify into evaluate** - `69c88de` (feat)
3. **Task 2: Wire context at the group + 2 DM notification call sites** - `9c6d2d3` (feat)

## Files Created/Modified
- `services/rate-limit.ts` - `InjectedDeps.context?`, `rateLimitedNotify` destructures and forwards `context` to `evaluate()`'s 5th arg; flush-timer block untouched (verified via diff).
- `notifications/groups.ts` - `rateLimitedNotify("groups", {...}, { context: encodeGroupPointer(group) })`.
- `notifications/messages.ts` - Both DM sites pass `{ context: sender }`.
- `tests/services/rate-limit.test.ts` - Per-context isolation, no-context regression parity, and flush-timer no-restart test cases.

## Decisions Made
- Kept `context` as an options-bag key rather than a new positional parameter, per the plan's explicit instruction and Plan 03's own established pattern from Task 1's `InjectedDeps` shape -- zero call-site churn for replies/zaps.
- The flush-timer no-restart test asserts the actual RxJS-pipeline invariant (`clampWindowSeconds(cfg.window)` projection identity before/after a perGroup/perDm-only write) instead of waiting on real timers, per the plan's own stated acceptable approach ("assert via the clampWindowSeconds projection value... without waiting on real timers").

## Deviations from Plan

None - plan executed exactly as written. One clarifying note: the plan's Task 1 acceptance criterion `grep -c 'distinctUntilChanged' services/rate-limit.ts is still 1` does not match the file's actual pre-existing count (3: the import line, an explanatory comment mentioning the identifier, and the actual pipeline call) -- this was already true BEFORE this plan's changes (verified by inspecting the file as read at the start of this plan). The plan's own stated intent -- "the flush-timer pipeline is untouched" -- was independently verified via `git diff`, which shows zero lines changed in the flush-timer subscription block (lines 163-187). No fix was needed; this is a pre-existing inaccuracy in the plan's grep-count acceptance criterion, not a regression introduced by this plan.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Per-context rate limiting for groups and DMs is now live end-to-end at runtime: `services/rate-limit-accounting.ts` (Plan 01) + `services/config.ts`/`helpers/preferences.ts` (Plan 02) + `services/rate-limit.ts`/`notifications/groups.ts`/`notifications/messages.ts` (this plan) form the complete D7-01/D7-03/D7-04/D7-09 chain.
- Plan 04 (UI fields) can now add the `perGroup`/`perDm` default-limit form fields to `pages/groups.tsx`/`pages/messages.tsx` against the now-fully-wired `AppConfig.rateLimit` shape -- no further shell/accounting changes needed.
- No blockers.

---
*Phase: 07-default-rate-limit-for-chat-groups-and-dms-on-join*
*Completed: 2026-07-13*

## Self-Check: PASSED

- FOUND: services/rate-limit.ts
- FOUND: notifications/groups.ts
- FOUND: notifications/messages.ts
- FOUND: tests/services/rate-limit.test.ts
- FOUND: 5dd24c4
- FOUND: 69c88de
- FOUND: 9c6d2d3
