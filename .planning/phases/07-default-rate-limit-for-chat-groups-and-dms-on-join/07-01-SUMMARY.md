---
phase: 07-default-rate-limit-for-chat-groups-and-dms-on-join
plan: 01
subsystem: notifications
tags: [rate-limiting, accounting, bun-test, injected-clock]

# Dependency graph
requires:
  - phase: 06-per-type-and-global-notification-rate-limiting
    provides: "The pure, clock-injectable RateLimitState/RateLimitConfig/evaluate accounting core in services/rate-limit-accounting.ts, and the grouped counts-only overflow summary this phase reuses unchanged."
provides:
  - "RateLimitState.contexts: a flat, lazily-populated, window-pruned per-context bucket map keyed `${type}:${contextKey}`"
  - "RateLimitConfig.perGroup/.perDm: top-level scalar default limits (0 = unlimited), siblings of perType"
  - "evaluate()'s optional 5th `context?` parameter adding a third underContext gate (most-restrictive-wins) computed from the SAME single rollIfExpired result as underType/underGlobal"
  - "A 30-case injected-clock test suite covering lazy-create, per-context isolation, layering, window-prune, overflow-rollup, 0=unlimited, DM-counterparty-sharing, and no-context regression parity"
affects: [07-02-config-and-sync, 07-03-rate-limit-shell-threading, 07-04-ui-fields]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-context state piggy-backs on the existing tumbling-window rollover for pruning -- no new TTL/LRU/timer code (D7-02)"
    - "All three delivery gates (type/global/context) read from ONE rollIfExpired result per evaluate() call -- never a second roll"
    - "Rejection always increments overflow[type] only; contexts is never touched on rejection -- no per-context overflow substructure (D7-07)"

key-files:
  created: []
  modified:
    - services/rate-limit-accounting.ts
    - tests/services/rate-limit-accounting.test.ts

key-decisions:
  - "perGroup/perDm added as top-level scalar siblings of perType (not nested inside it) -- different axis: 'max for ONE context instance' vs perType's 'max across ALL instances of a type'"
  - "No new clamp-bounds constant for perGroup/perDm -- unlike window, 0 has no arithmetic hazard here and is handled by the existing contextLimit === 0 check"
  - "Updated the one pre-existing createRateLimitState exact-equality test to include the new contexts: {} field -- required to keep Task 1's own tests green since the extension is a new field on an existing exact-shape assertion"

patterns-established:
  - "contextLimitFor(type, config) helper: groups->perGroup, messages->perDm, else 0 (defensive; replies/zaps never receive a context in practice)"

requirements-completed: [D7-01, D7-02, D7-03, D7-04, D7-07, D7-09]

coverage:
  - id: D1
    description: "A brand-new `${type}:${contextKey}` bucket reads as count 0 on its first evaluate() call -- lazy-create, no separate registration step (D7-02)"
    requirement: "D7-02"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit-accounting.test.ts#evaluate -- per-context lazy-create (D7-02) > first evaluate for an unseen context key delivers and lazily sets contexts[key] to 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "A notification delivers only when under its per-context bucket AND per-type AND global -- most-restrictive-wins, all three gates from ONE rollIfExpired result (D7-04)"
    requirement: "D7-04"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit-accounting.test.ts#evaluate -- most-restrictive-wins layering table (D7-04)"
        status: pass
    human_judgment: false
  - id: D3
    description: "One context hitting its perGroup/perDm limit does not block a DIFFERENT context of the same type in the same window (per-context isolation, D7-01)"
    requirement: "D7-01"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit-accounting.test.ts#evaluate -- per-context isolation (D7-01) > one context reaching perGroup does not block a DIFFERENT context of the same type in the same window"
        status: pass
    human_judgment: false
  - id: D4
    description: "The whole contexts map resets to {} on the SAME window tumble as globalCount/perTypeCount/overflow -- this is the entire pruning mechanism (D7-02)"
    requirement: "D7-02"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit-accounting.test.ts#evaluate -- per-context window-prune (D7-02) > contexts resets to {} on the SAME window tumble as perTypeCount/overflow"
        status: pass
    human_judgment: false
  - id: D5
    description: "A context-rejected notification increments overflow[type] only; contexts is never touched on rejection, and no per-context overflow substructure exists (D7-07)"
    requirement: "D7-07"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit-accounting.test.ts#evaluate -- per-context overflow-rollup into per-type overflow only (D7-07)"
        status: pass
    human_judgment: false
  - id: D6
    description: "perGroup/perDm = 0 always passes the context gate regardless of count (0 = unlimited, D7-06)"
    requirement: "D7-06"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit-accounting.test.ts#evaluate -- 0 = unlimited for perGroup/perDm (D7-06)"
        status: pass
    human_judgment: false
  - id: D7
    description: "evaluate() called without a context argument behaves byte-identical to the pre-Phase-7 implementation (additive, D7-01/D7-09)"
    requirement: "D7-09"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit-accounting.test.ts#evaluate -- no-context regression parity (D7-01/09) > evaluate() called without a context argument behaves byte-identical to the pre-Phase-7 implementation -- contexts is left untouched"
        status: pass
    human_judgment: false
  - id: D8
    description: "Both DM transports (NIP-04/NIP-17) share ONE messages:<pubkey> bucket per counterparty (D7-01, Pitfall 4)"
    requirement: "D7-01"
    verification:
      - kind: unit
        ref: "tests/services/rate-limit-accounting.test.ts#evaluate -- DM counterparty sharing (D7-01, Pitfall 4) > two evaluates with type messages and the SAME context pubkey share ONE messages:<pubkey> bucket"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-13
status: complete
---

# Phase 7 Plan 01: Per-Context Rate Limit Accounting Core Summary

**Extended `services/rate-limit-accounting.ts`'s pure evaluate() with a lazily-created, window-pruned per-context bucket layer (contexts map + perGroup/perDm config + underContext gate), fully additive to the Phase-6 per-type/global limiter, with a 30-case injected-clock test suite.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-13T21:35:52Z
- **Completed:** 2026-07-13T21:40:06Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `RateLimitState.contexts: Record<string, number>` -- a flat per-window map keyed `` `${type}:${contextKey}` ``, seeded `{}` by `createRateLimitState` so it is pruned for free by the existing tumbling-window rollover (no new TTL/LRU/timer code, D7-02).
- `RateLimitConfig.perGroup`/`.perDm` -- top-level scalar siblings of `perType` (0 = unlimited), consumed via a new internal `contextLimitFor(type, config)` helper.
- `evaluate(state, type, now, config, context?)` -- new optional 5th parameter computing a third `underContext` gate from the SAME single `rollIfExpired` result as the existing `underType`/`underGlobal` gates (most-restrictive-wins, D7-04); delivery increments `globalCount`, `perTypeCount[type]`, and `contexts[key]` atomically; rejection increments `overflow[type]` only, never touching `contexts` (D7-07).
- 30-case test suite (18 pre-existing + 12 new/updated) covering lazy-create, per-context isolation, the most-restrictive-wins layering table (4 sub-cases), window-prune, overflow-rollup, `0 = unlimited` for both `perGroup` and `perDm`, DM-counterparty transport-sharing, and no-context regression parity.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend the accounting types + evaluate() with the underContext gate** - `649ce5a` (feat)
2. **Task 2: Add the per-context accounting test matrix (injected clock)** - `7fee5fa` (test)

_Note: Task 1's commit also includes a one-line update to the pre-existing `createRateLimitState` exact-equality test (see Deviations)._

## Files Created/Modified
- `services/rate-limit-accounting.ts` - Added `RateLimitConfig.perGroup`/`.perDm`, `RateLimitState.contexts`, `contextLimitFor()`, and the `evaluate()` 5th `context?` parameter + `underContext` gate.
- `tests/services/rate-limit-accounting.test.ts` - Extended `makeConfig` with `perGroup`/`perDm` defaults; added the 7 required per-context scenarios + no-context regression parity; updated one pre-existing exact-equality assertion.

## Decisions Made
- `perGroup`/`perDm` are top-level scalar siblings of `perType`, not nested inside it -- `perType` is "max across ALL instances of a type" while `perGroup`/`perDm` are "max for ONE chat-context instance," a structurally different axis.
- No new clamp-bounds constant (unlike `MIN_WINDOW_SECONDS`/`MAX_WINDOW_SECONDS`) for `perGroup`/`perDm` -- `0` has no arithmetic hazard here (unlike `window`) and is handled by the existing `contextLimit === 0` unlimited-sentinel pattern.
- Composite context key format is `` `${type}:${contextKey}` `` -- kept the type prefix for clarity/future-proofing even though group keys (containing an apostrophe from `encodeGroupPointer`) and 64-char-hex DM pubkeys are already structurally non-colliding.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated the pre-existing `createRateLimitState` exact-equality test to include `contexts: {}`**
- **Found during:** Task 1 (verifying `bun test tests/services/rate-limit-accounting.test.ts` after the source change)
- **Issue:** The plan's Task 1 acceptance criteria requires "the PRE-EXISTING accounting test cases... still pass unchanged." One pre-existing test (`createRateLimitState > seeds an all-zero state at windowStart=now`) uses `expect(state).toEqual({...})` asserting the FULL exact shape of the returned state object. Adding the new `contexts: {}` field to `createRateLimitState`'s return value (required by the plan's own Task 1 action) necessarily breaks this literal exact-equality check, since the actual object now has one more key than the expected literal.
- **Fix:** Added `contexts: {}` to the expected object literal in that one test, matching the new additive shape. This is the minimal, necessary update to keep the test green given the plan's own required source change -- the underlying behavior (all-zero state) is unchanged, only the shape assertion is updated to match.
- **Files modified:** tests/services/rate-limit-accounting.test.ts
- **Verification:** `bun test tests/services/rate-limit-accounting.test.ts` -- all 18 pre-existing cases pass (later 30/30 after Task 2's additions).
- **Committed in:** 649ce5a (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug/necessary-test-update)
**Impact on plan:** Required to satisfy the plan's own acceptance criteria after its own specified source change; no scope creep, no behavior change beyond what the plan itself specified.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `services/rate-limit-accounting.ts`'s pure core is fully extended and tested; Plan 02 (config/sync) can now add `perGroup`/`perDm` to `AppConfig.rateLimit`/`DEFAULT_RATE_LIMIT_CONFIG`/migration/`SyncedPrefs`/`asRateLimit` without touching this file again.
- `bun run lint` currently reports 2 pre-existing type errors (`services/rate-limit.ts:110`, `tests/helpers/preferences.test.ts:471`) because those files construct a `RateLimitConfig`-shaped object missing the new `perGroup`/`perDm` fields -- this is the EXPECTED, plan-documented coupling with Plan 02's `AppConfig` widening (see Task 1's acceptance criteria note: "full lint runs at the wave-merge gate"). Not a blocker for this plan; Plan 02/03 will resolve it.
- No blockers for Plan 02 (config/sync) or Plan 03/04 (shell threading + UI), which depend on this plan's `evaluate()` signature and `RateLimitConfig`/`RateLimitState` shapes.

---
*Phase: 07-default-rate-limit-for-chat-groups-and-dms-on-join*
*Completed: 2026-07-13*

## Self-Check: PASSED

- FOUND: services/rate-limit-accounting.ts
- FOUND: tests/services/rate-limit-accounting.test.ts
- FOUND: 649ce5a
- FOUND: 7fee5fa
