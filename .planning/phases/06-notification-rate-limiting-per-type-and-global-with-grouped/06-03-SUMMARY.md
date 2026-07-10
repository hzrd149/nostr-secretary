---
phase: 06-notification-rate-limiting-per-type-and-global-with-grouped
plan: 03
subsystem: notifications
tags: [rxjs, rate-limiting, ntfy, bun-test]

# Dependency graph
requires:
  - phase: 06-notification-rate-limiting-per-type-and-global-with-grouped (Plan 01)
    provides: "services/rate-limit-accounting.ts -- pure evaluate/flushOverflow/formatOverflowSummary/createRateLimitState"
  - phase: 06-notification-rate-limiting-per-type-and-global-with-grouped (Plan 02)
    provides: "AppConfig.rateLimit shape + migrateConfig defaults, configValue('rateLimit')/getConfig().rateLimit"
provides:
  - "services/rate-limit.ts -- rateLimitedNotify(type, options) choke point + config-driven RxJS flush that bypasses the limiter for the grouped summary"
  - "All 5 sendNotification call sites now route through rateLimitedNotify with coarse types"
affects: [06-04 (UI plan, no code dependency but shares the phase), phase-07 (per-context rate limits build on this choke point)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Impure module-level-state service wrapping a pure accounting unit (mirrors services/logs.ts's module-level `let` + notifications/dm-notification-gate.ts's injected-dependency style)"
    - "configValue(key).pipe(switchMap(cfg => interval(cfg.window * 1000))) for a config-driven, auto-restarting periodic flush"
    - "Optional trailing { now?, send? } dependency-injection seam on impure async functions, purely for test determinism"

key-files:
  created:
    - services/rate-limit.ts
    - tests/services/rate-limit.test.ts
  modified:
    - notifications/replies.ts
    - notifications/zaps.ts
    - notifications/messages.ts
    - notifications/groups.ts

key-decisions:
  - "rateLimitedNotify and runFlush both take an optional trailing { now?, send? } deps param (never a required 3rd arg) so the 5 call-site swaps stay pure 2-arg drop-ins while the test file can still inject a fake clock/send"
  - "The flush timer subscribes at module load time (not lazily) via configValue('rateLimit').pipe(switchMap(interval)), matching the RESEARCH Pattern 3 reference implementation exactly"
  - "tests/services/rate-limit.test.ts mutates the shared config$ singleton's rateLimit field per-case via config$.next(...) (same technique as tests/services/config.test.ts's groups.modes round-trip) and restores DEFAULT_RATE_LIMIT_CONFIG in an afterAll hook so it never leaks into other test files in the same bun test process"

patterns-established:
  - "Rate-limit choke point: sendNotification(opts) -> rateLimitedNotify(type, opts); the type is always one of the 4 coarse categories, never a per-context refinement (that's Phase 7)"

requirements-completed: [D6-01, D6-03, D6-06, D6-10]

coverage:
  - id: D1
    description: "rateLimitedNotify(type, options) is the single choke point: delivers via sendNotification only when evaluate() returns deliver:true, else accumulates overflow without sending (D6-01/D6-04)"
    requirement: "D6-01"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit.test.ts#rateLimitedNotify -- under-limit delivery"
        status: pass
      - kind: unit
        ref: "tests/services/rate-limit.test.ts#rateLimitedNotify -- over-limit accumulation (D6-04)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Config-driven RxJS flush timer emits ONE combined counts-only grouped summary per window via sendNotification directly, bypassing rateLimitedNotify even while the bucket is saturated, and is skipped when nothing overflowed (D6-05/D6-06/D6-10)"
    requirement: "D6-06"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit.test.ts#runFlush -- one combined counts-only summary (D6-05)"
        status: pass
      - kind: unit
        ref: "tests/services/rate-limit.test.ts#runFlush -- bypasses rateLimitedNotify entirely (D6-06)"
        status: pass
      - kind: unit
        ref: "tests/services/rate-limit.test.ts#runFlush -- is skipped entirely when nothing overflowed"
        status: pass
    human_judgment: false
  - id: D3
    description: "All 5 existing sendNotification call sites (replies, zaps, messages x2, groups) route through rateLimitedNotify with the correct coarse type, both DM sites sharing 'messages'; shouldNotify + Phase-5 category gates untouched (D6-03/D6-10)"
    requirement: "D6-03"
    verification:
      - kind: unit
        ref: "bun run lint (tsc --noEmit) -- confirms every swapped call typechecks and no unused sendNotification import remains"
        status: pass
      - kind: unit
        ref: "grep-based positive check: rateLimitedNotify(\"replies\"|\"zaps\"|\"groups\") x1 each, rateLimitedNotify(\"messages\") x2 in messages.ts"
        status: pass
      - kind: unit
        ref: "bun test (full suite, 140 tests) -- no regression in the four listeners or elsewhere"
        status: pass
    human_judgment: false

# Metrics
duration: ~20min
completed: 2026-07-10
status: complete
---

# Phase 6 Plan 3: Rate limiter wiring Summary

**services/rate-limit.ts's rateLimitedNotify choke point wraps all 5 sendNotification call sites (replies/zaps/messages x2/groups), with a config-driven RxJS flush that bypasses the limiter to deliver one counts-only grouped summary per window**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-10T21:21:06Z
- **Tasks:** 2
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- `services/rate-limit.ts`: `rateLimitedNotify(type, options)` reads the live `config.rateLimit`, calls the pure `evaluate()` (Plan 01) against module-level state, and delivers via `sendNotification` only when under both the per-type and global limits; otherwise the notification is silently accumulated into per-type overflow (D6-01/D6-04)
- A `configValue("rateLimit").pipe(switchMap(cfg => interval(cfg.window * 1000)))` flush timer calls `runFlush`, which formats any accumulated overflow into one combined summary via `flushOverflow` and delivers it via `sendNotification` DIRECTLY -- never through `rateLimitedNotify` -- so the grouped summary can never itself be suppressed (D6-05/D6-06), and is skipped entirely when nothing overflowed
- The summary body is derived only from `formatOverflowSummary`'s counts-only output (e.g. `"2 new replies"`) -- structurally incapable of carrying DM plaintext regardless of `messages.sendContent` (D6-10)
- All 5 existing `sendNotification(...)` call sites (`notifications/replies.ts:102`, `zaps.ts:107`, `messages.ts:224` NIP-04 + `:318` NIP-17, `groups.ts:143`) now route through `rateLimitedNotify` with their coarse type; both DM sites intentionally share the single `"messages"` type (D6-03) -- the surrounding `shouldNotify` + Phase-5 category gates are byte-for-byte unchanged
- `tests/services/rate-limit.test.ts` drives the impure module directly (unlike the Plan 01 pure-unit test) through an injected `{ now, send }` seam plus a `resetRateLimitState` test hook, proving under-limit delivery, over-limit accumulation, the one-combined-summary flush, the flush-skipped-when-nothing-overflowed case, and the D6-06 bypass (the flush's own injected send still fires while the per-type bucket remains saturated)

## Task Commits

Each task was committed atomically:

1. **Task 1: services/rate-limit.ts choke point + config-driven flush timer + bypass/accumulate test** - `65dd485` (feat)
2. **Task 2: Swap all 5 sendNotification call sites to rateLimitedNotify with coarse types** - `560e8e0` (feat)

_No plan-metadata commit -- per orchestrator instructions this plan does NOT update STATE.md/ROADMAP.md; the wave orchestrator handles that after merge._

## Files Created/Modified
- `services/rate-limit.ts` - `rateLimitedNotify(type, options)` choke point, `runFlush`/`resetRateLimitState` exports, module-level state, and the config-driven flush subscription
- `tests/services/rate-limit.test.ts` - injected-send/clock test suite covering delivery, accumulation, flush, and bypass
- `notifications/replies.ts` - `sendNotification` -> `rateLimitedNotify("replies", ...)`, import swapped
- `notifications/zaps.ts` - `sendNotification` -> `rateLimitedNotify("zaps", ...)`, import swapped
- `notifications/messages.ts` - both the NIP-04 (:224) and NIP-17 (:318) send sites -> `rateLimitedNotify("messages", ...)`, import swapped
- `notifications/groups.ts` - `sendNotification` -> `rateLimitedNotify("groups", ...)`, import swapped

## Decisions Made
- `rateLimitedNotify`/`runFlush` accept an optional trailing `{ now?, send? }` deps object (not required positional args) so all 5 call-site swaps remain simple 2-arg drop-ins, exactly per the plan's `<action>` instructions.
- The test file mutates the shared `config$` singleton's `rateLimit` field per-case (same technique `tests/services/config.test.ts` already uses for `groups.modes`) and restores `DEFAULT_RATE_LIMIT_CONFIG` in an `afterAll` hook so no state leaks into other test files sharing the same `bun test` module cache.
- Verified the module-level RxJS flush subscription (default 60s window) does not hang `bun test` -- the full suite (140 tests) completes in ~170-320ms with no forced-exit needed.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched the plan's `<action>`/`<behavior>` specs; all automated `<verify>` gates (`bun test tests/services/rate-limit.test.ts`, `bun run lint`, the grep checks, and the full `bun test` suite) passed without needing any Rule 1-3 fixes.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The rate limiter is live end-to-end: all 5 notification listeners route through `rateLimitedNotify`, and the grouped-summary bypass is proven by test.
- Plan 04 (UI) can proceed independently -- it reads/writes `config.rateLimit` directly via existing PATCH patterns and has no code dependency on `services/rate-limit.ts`.
- Phase 7 (per-context rate limits) can build on `rateLimitedNotify` as the established choke point without needing to touch the 5 call sites again.

---
*Phase: 06-notification-rate-limiting-per-type-and-global-with-grouped*
*Completed: 2026-07-10*

## Self-Check: PASSED

- FOUND: services/rate-limit.ts
- FOUND: tests/services/rate-limit.test.ts
- FOUND: .planning/phases/06-notification-rate-limiting-per-type-and-global-with-grouped/06-03-SUMMARY.md
- FOUND: 65dd485
- FOUND: 560e8e0
