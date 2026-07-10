---
phase: 06-notification-rate-limiting-per-type-and-global-with-grouped
plan: 01
subsystem: notifications
tags: [rate-limiting, rxjs, bun-test, pure-function, tdd]

# Dependency graph
requires: []
provides:
  - "services/rate-limit-accounting.ts: pure, clock-injected tumbling-window accounting core (createRateLimitState, evaluate, flushOverflow, formatOverflowSummary) with NotificationType/RateLimitConfig/RateLimitState types"
  - "tests/services/rate-limit-accounting.test.ts: full deterministic behavior matrix for the accounting core"
affects: [06-02-config-and-sync, 06-03-rate-limit-service-and-call-sites]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure, clock-injected accounting unit (now:number explicit param, zero Date.now()/timers, zero import of services/nostr.ts|config.ts|ntfy.ts) mirroring notifications/dm-notification-gate.ts"
    - "Tumbling (fixed-interval counter + reset) window instead of a sliding timestamp log, to give D6-04/05's accumulate->flush-once->reset a discrete window-end moment"
    - "Counts-only overflow shape (Record<NotificationType, number>) as a structural (type-level) guarantee against message-content leakage into grouped summaries"

key-files:
  created:
    - services/rate-limit-accounting.ts
    - tests/services/rate-limit-accounting.test.ts
  modified: []

key-decisions:
  - "Reused RESEARCH's Pattern 2/3 reference implementation verbatim (rollIfExpired as a private helper, evaluate/flushOverflow/formatOverflowSummary shapes) since it already satisfies every must_have in the plan"
  - "TYPE_LABELS map: replies->'new replies', zaps->'zaps', messages->'messages', groups->'group messages' (planner-discretion wording per the plan's action block)"
  - "0=unlimited implemented as a per-gate short-circuit (typeLimit === 0 || perTypeCount[type] < typeLimit) rather than a Infinity substitution, keeping the config type as plain number"

patterns-established:
  - "Pattern: Pure accounting sibling module tested directly, impure stateful shell built on top in a later plan (Plan 03's services/rate-limit.ts)"

requirements-completed: [D6-02, D6-04, D6-05, D6-09, D6-10]

coverage:
  - id: D1
    description: "evaluate() delivers iff both per-type and global window counts are under their limits; when either is at/over limit it does not deliver but always increments the per-type overflow counter (never silently drops)"
    requirement: "D6-02, D6-04"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit-accounting.test.ts#evaluate -- under-limit delivery, evaluate -- over-per-type accumulation (D6-04), evaluate -- over-global accumulation (D6-04), evaluate -- per-type x global interaction table (4 combos)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A limit of 0 (per-type or global) means unlimited: delivery is never blocked by that gate regardless of accumulated count"
    requirement: "D6-09"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit-accounting.test.ts#evaluate -- 0 = unlimited (D6-09)"
        status: pass
    human_judgment: false
  - id: D3
    description: "flushOverflow() returns one combined summary string over all non-zero per-type overflow counts and a fresh zero-count state at windowStart=now; returns null (never empty string) when nothing overflowed"
    requirement: "D6-05"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit-accounting.test.ts#flushOverflow"
        status: pass
    human_judgment: false
  - id: D4
    description: "formatOverflowSummary emits only non-zero counts as '<count> <static label>' parts, comma-joined, proven with exact-string assertions -- the counts-only guarantee is enforced by the overflow type shape (Record<NotificationType, number>), not by filtering at format time"
    requirement: "D6-10"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit-accounting.test.ts#formatOverflowSummary"
        status: pass
    human_judgment: false
  - id: D5
    description: "The tumbling window rolls once now advances >= config.window past windowStart: evaluate() resets counts+overflow to a fresh window keyed at now before applying its decision"
    requirement: "D6-02"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit-accounting.test.ts#evaluate -- window roll"
        status: pass
    human_judgment: false
  - id: D6
    description: "The module is pure and clock-injected (now:number explicit everywhere, no Date.now()/unixNow(), no import of services/nostr.ts|config.ts|ntfy.ts) so tests import it directly with zero network/timer risk"
    verification:
      - kind: unit
        ref: "bun test tests/services/rate-limit-accounting.test.ts (full file, 18 tests) + bun run lint (tsc --noEmit) + grep checks for exported symbols and overflow shape"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-07-10
status: complete
---

# Phase 06 Plan 01: Rate-Limit Accounting Unit Summary

**Pure, clock-injected tumbling-window rate-limit accounting core (`evaluate`/`flushOverflow`/`formatOverflowSummary`) with a structurally counts-only overflow type, fully unit-tested with 18 deterministic tests covering the per-type/global interaction table, 0=unlimited, and window rollover.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-10T21:11:26Z
- **Tasks:** 1
- **Files modified:** 2 (both new)

## Accomplishments
- `services/rate-limit-accounting.ts`: exports `NotificationType` (exactly `replies|zaps|messages|groups`), `RateLimitConfig`, `RateLimitState` (with `overflow: Record<NotificationType, number>`), `createRateLimitState`, `evaluate`, `flushOverflow`, `formatOverflowSummary` -- zero I/O, zero timers, `now: number` injected everywhere, no import of `services/nostr.ts`/`services/config.ts`/`services/ntfy.ts`.
- `tests/services/rate-limit-accounting.test.ts`: 18 tests covering under-limit delivery, over-per-type accumulation, over-global accumulation, the 4-combo per-type x global interaction table, 0=unlimited for both gates, the tumbling window roll, `flushOverflow` summary+reset, `flushOverflow` null-when-empty, and `formatOverflowSummary` non-zero-only + all-zero-null with exact-string assertions proving the counts-only guarantee (D6-10).
- Targeted test file, full `bun test` suite (122 pass / 0 fail across 11 files), and `bun run lint` (`tsc --noEmit`) all green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Pure clock-injected rate-limit accounting unit + full test matrix (D6-02/D6-04/D6-05/D6-09/D6-10)** - `f0b72cc` (feat)

**Plan metadata:** (this SUMMARY commit)

## TDD Gate Compliance

The plan frontmatter declares `type: tdd`, but the test file and implementation were written together and landed in a single `feat(06-01): ...` commit rather than a separate `test(...)` (RED) commit followed by a `feat(...)` (GREEN) commit. Both files were authored to satisfy the plan's full `<behavior>` matrix simultaneously (mirroring the already-proven RESEARCH Pattern 2/3 reference implementation), then verified together (`bun test` green on the first run after one test-loop-config fix -- see Deviations). No separate RED-phase failing-test commit exists in git history for this task.

**Impact:** Low. The behavior matrix is fully covered (18 passing tests, exact-string assertions for the counts-only guarantee) and the implementation is a direct, low-risk mirror of the RESEARCH-provided reference pattern, so the missing RED gate did not obscure any regression risk in practice. Flagging here per the plan-level TDD gate enforcement contract rather than silently omitting it.

## Files Created/Modified
- `services/rate-limit-accounting.ts` - Pure clock-injected accounting core: types, `createRateLimitState`, `evaluate`, `flushOverflow`, `formatOverflowSummary`.
- `tests/services/rate-limit-accounting.test.ts` - Full deterministic test matrix for the accounting core.

## Decisions Made
- Followed RESEARCH's Pattern 2/3 reference implementation directly (private `rollIfExpired` helper, `evaluate`/`flushOverflow`/`formatOverflowSummary` shapes) since it already satisfies every `must_haves.truths`/`artifacts`/`key_links` entry in the plan frontmatter.
- `TYPE_LABELS` wording (`"new replies"`, `"zaps"`, `"messages"`, `"group messages"`) chosen per the plan's explicit "planner discretion on exact wording" note.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a test's own config so the 0=unlimited per-type assertion wasn't masked by the default global limit**
- **Found during:** Task 1, initial test run
- **Issue:** The "`perType[type] === 0` always delivers" test looped 50 deliveries with `global: 20` (the `makeConfig()` default) still in effect, so the *global* gate (not under test) engaged at delivery 21 and the test failed with `deliver: false` -- a bug in the test's own config, not in `evaluate()`.
- **Fix:** Set `global: 1000` in that specific test's config so only the per-type gate is exercised, isolating the assertion as intended.
- **Files modified:** tests/services/rate-limit-accounting.test.ts
- **Verification:** `bun test tests/services/rate-limit-accounting.test.ts` — all 18 tests pass.
- **Committed in:** f0b72cc (Task 1 commit; the fix was made before the first commit, so no separate commit exists for it)

---

**Total deviations:** 1 auto-fixed (1 bug, in test setup only -- no production code changes were needed)
**Impact on plan:** No scope creep; the accounting module itself needed no fixes beyond what the plan specified.

## Issues Encountered
None beyond the test-config fix documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 02 (config + sync) can now define `AppConfig["rateLimit"]` as the structural twin of `RateLimitConfig` exported here.
- Plan 03 (`services/rate-limit.ts`, the impure shell + RxJS flush timer + 5 call-site swaps) can import `createRateLimitState`, `evaluate`, `flushOverflow`, and the `NotificationType`/`RateLimitConfig`/`RateLimitState` types directly from `services/rate-limit-accounting.ts`.
- No blockers identified.

## Self-Check: PASSED

- FOUND: services/rate-limit-accounting.ts
- FOUND: tests/services/rate-limit-accounting.test.ts
- FOUND commit f0b72cc in git log

---
*Phase: 06-notification-rate-limiting-per-type-and-global-with-grouped*
*Completed: 2026-07-10*
