---
phase: 04-add-nip-17-dm-notifications-support-per-applesauce-docs
plan: 01
subsystem: notifications
tags: [rxjs, applesauce, nip-17, nip-59, gift-wrap, bun-test]

# Dependency graph
requires:
  - phase: 03-review-and-add-nip-04-dm-support-per-applesauce-docs
    provides: "the extracted-pure-unit pattern (notifications/legacy-messages.ts) this plan mirrors"
provides:
  - "notifyNewGiftWraps(seed$, live$, seen?) — pure RxJS seed-then-live dedup combinator (helpers/gift-wrap-subscription.ts)"
  - "unlockPrivateDirectMessage(event, signer, deps?) — pure unwrap+kind-14-classify unit (notifications/gift-wrap-messages.ts)"
  - "4-case dedup-contract test suite + GiftWrapFactory/PrivateKeySigner round-trip test"
affects: ["04-02 (Wave 2 wires these two units into services/nostr.ts's giftWraps$ and notifications/messages.ts's NIP-17 block)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "seed(ignoreElements)+live(seen-filter) RxJS combinator for 'notify only on genuinely new' when the underlying protocol randomizes timestamps"
    - "extracted-pure-unit-with-injectable-deps mirroring notifications/legacy-messages.ts, applied a second time"

key-files:
  created:
    - helpers/gift-wrap-subscription.ts
    - notifications/gift-wrap-messages.ts
    - tests/helpers/gift-wrap-subscription.test.ts
    - tests/notifications/gift-wrap-messages.test.ts
  modified: []

key-decisions:
  - "Implemented notifyNewGiftWraps and unlockPrivateDirectMessage exactly per 04-RESEARCH.md Examples 2 and 4 (empirically verified against installed applesauce-relay/applesauce-common source in that research session) rather than deriving a new design"
  - "Rephrased the network-safety header comments in both new test files to avoid literally naming the self-subscribing module paths (services/nostr.ts, notifications/messages.ts, notifications/index.ts), since the plan's own automated verify greps for the absence of those exact strings in the test/module files"

patterns-established:
  - "Pattern: pure RxJS combinator with a default-constructed mutable Set parameter (seen = new Set()) for injectable-but-defaulted stateful dedup, safe to import directly in tests"

requirements-completed: [D4-01, D4-02, D4-09]

coverage:
  - id: D1
    description: "notifyNewGiftWraps combinator: a historical gift wrap seeded during the seed phase is never emitted, even if the live phase resends the same id"
    requirement: "D4-02"
    verification:
      - kind: unit
        ref: "tests/helpers/gift-wrap-subscription.test.ts#a historical wrap present during seeding is NOT emitted, even if the relay resends it live"
        status: pass
    human_judgment: false
  - id: D2
    description: "notifyNewGiftWraps combinator: a genuinely-new live wrap is emitted, including the zero-historical-events edge case that broke the old skip-one hack"
    requirement: "D4-02"
    verification:
      - kind: unit
        ref: "tests/helpers/gift-wrap-subscription.test.ts#a new wrap arriving after seeding completes IS emitted"
        status: pass
      - kind: unit
        ref: "tests/helpers/gift-wrap-subscription.test.ts#an empty seed (zero historical events) still notifies for the first live event"
        status: pass
    human_judgment: false
  - id: D3
    description: "notifyNewGiftWraps combinator: the same live id delivered twice (reconnect resend / duplicate relay delivery) is emitted only once"
    requirement: "D4-02"
    verification:
      - kind: unit
        ref: "tests/helpers/gift-wrap-subscription.test.ts#the same live id is never emitted twice"
        status: pass
    human_judgment: false
  - id: D4
    description: "unlockPrivateDirectMessage unwraps a real GiftWrapFactory-built kind-14 gift wrap to a rumor with the real sender pubkey (not the wrap's random one-time pubkey) and intact content"
    requirement: "D4-01"
    verification:
      - kind: unit
        ref: "tests/notifications/gift-wrap-messages.test.ts#unwraps a real gift wrap and returns the rumor for a PrivateDirectMessage"
        status: pass
    human_judgment: false
  - id: D5
    description: "unlockPrivateDirectMessage returns undefined for a rumor whose kind is not PrivateDirectMessage (14)"
    requirement: "D4-01"
    verification:
      - kind: unit
        ref: "tests/notifications/gift-wrap-messages.test.ts#returns undefined for a rumor kind that is not PrivateDirectMessage"
        status: pass
    human_judgment: false

# Metrics
duration: 10min
completed: 2026-07-10
status: complete
---

# Phase 04 Plan 01: Gift-wrap dedup combinator + unwrap-classify unit Summary

**Two new network-safe pure units — `notifyNewGiftWraps` (seed-then-live dedup combinator fixing the skip(1)/limit:1 fragility) and `unlockPrivateDirectMessage` (unwrap+kind-14-classify) — each with a fully green, network-free test suite.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-07-10T16:07:00Z (approx)
- **Completed:** 2026-07-10T16:11:35Z
- **Tasks:** 2 completed
- **Files modified:** 4 (all new)

## Accomplishments
- `helpers/gift-wrap-subscription.ts` exports `notifyNewGiftWraps(seed$, live$, seen?)`: concats a `seed$` (side-effect-only via `tap`+`ignoreElements`, recording ids into `seen`) with a `live$` filtered against that same growing `seen` set on every emission — the D4-02 fix, replacing the old `limit: 1` + `skip(1)` fragility, without ever relying on NIP-59's randomized `created_at`.
- `tests/helpers/gift-wrap-subscription.test.ts` proves the full dedup contract in 4 cases: historical-not-emitted (even on live resend), new-emitted, the zero-historical empty-seed edge case that broke the old skip-one hack, and no-double-notify for a duplicate live delivery.
- `notifications/gift-wrap-messages.ts` exports `unlockPrivateDirectMessage(event, signer, deps?)`: awaits applesauce's `unlockGiftWrap`, returns the rumor only when `rumor.kind === kinds.PrivateDirectMessage`, else `undefined` — deliberately does not catch a failed unwrap (the caller isolates that per D4-05).
- `tests/notifications/gift-wrap-messages.test.ts` executes a real `GiftWrapFactory.create()` → `unlockPrivateDirectMessage()` round trip (no relays) confirming the rumor's pubkey is the real sender (distinct from the gift wrap's anonymized pubkey) with content intact, plus the non-DM-kind-returns-undefined case.
- Both new modules have zero top-level singleton imports (no `pool`, `eventStore`, or signer singleton), confirmed by the plan's automated verify greps, so their tests import them directly with no network I/O risk.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create notifyNewGiftWraps combinator + dedup-contract test (D4-02/D4-09)** - `71f016b` (feat)
2. **Task 2: Create unlockPrivateDirectMessage unwrap+classify unit + round-trip test (D4-01/D4-09)** - `b8609ee` (feat)

_Note: both tasks had `tdd="true"` but were implemented directly from RESEARCH.md's already-verified exact reference implementations (Examples 2 and 4), so RED/GREEN/REFACTOR gate commits were not separated — the implementation and its test were written and verified green together in a single feat commit per task, matching how legacy-messages.ts's Phase 3 precedent files were authored._

## Files Created/Modified
- `helpers/gift-wrap-subscription.ts` - Pure RxJS `notifyNewGiftWraps` seed-then-live dedup combinator (D4-02)
- `notifications/gift-wrap-messages.ts` - Pure `unlockPrivateDirectMessage` unwrap+classify unit (D4-01)
- `tests/helpers/gift-wrap-subscription.test.ts` - 4-case dedup-contract test suite
- `tests/notifications/gift-wrap-messages.test.ts` - Real GiftWrapFactory/PrivateKeySigner round-trip test

## Decisions Made
- Followed RESEARCH.md's Example 2 and Example 4 verbatim for both new modules and their tests, since those examples were empirically verified against the installed `applesauce-relay`/`applesauce-common` v6.2.x source in the research session (not training-data recollection) — no reason to deviate.
- Rephrased both new test files' network-safety header comments to avoid literally spelling out `services/nostr.ts` / `notifications/messages.ts` / `notifications/index` (the plan's own automated verify greps for the absence of these exact substrings in the new test files and `notifications/gift-wrap-messages.ts`). The comments still explain the same reasoning (self-subscribing modules boot the live pool/store at import time) using paraphrased wording instead of the literal paths.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test-file network-safety comment tripped the plan's own negative-grep verification**
- **Found during:** Task 1 (running the full automated `<verify>` command)
- **Issue:** The initial `tests/helpers/gift-wrap-subscription.test.ts` header comment (mirroring `tests/notifications/legacy-messages.test.ts`'s convention) named `notifications/messages.ts` / `services/nostr.ts` literally, which matched the plan's own `! grep -Eq 'services/nostr|notifications/index|notifications/messages' ...` prohibition check, causing the automated verify to report failure even though the file imports nothing from those modules.
- **Fix:** Reworded the comment to describe the same reasoning ("the self-subscribing notification-listener/service modules... subscribe to the live RelayPool/EventStore at import time") without using the literal file path substrings the grep checks for. Applied proactively to `tests/notifications/gift-wrap-messages.test.ts` as well, since it uses the same comment convention.
- **Files modified:** tests/helpers/gift-wrap-subscription.test.ts, tests/notifications/gift-wrap-messages.test.ts
- **Verification:** Re-ran the full automated `<verify>` command for both tasks; both print their `-ok` sentinel and all tests remain green.
- **Committed in:** 71f016b (Task 1 commit; the gift-wrap-messages.test.ts file was authored with the paraphrased wording from the start in the Task 2 commit b8609ee)

---

**Total deviations:** 1 auto-fixed (1 bug/verification-fidelity fix)
**Impact on plan:** No scope creep — the fix only reworded a comment's phrasing to satisfy the plan's own literal-string prohibition check while preserving the same explanatory content and the same network-safety guarantee (zero top-level singleton imports, confirmed by grep).

## Issues Encountered
None beyond the comment-wording deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
Both pure units (`notifyNewGiftWraps`, `unlockPrivateDirectMessage`) exist, are network-safe, and are proven by deterministic green tests. `bun run lint` (tsc --noEmit, strict + noUncheckedIndexedAccess) is clean and the full suite (74 tests across 9 files) passes. Wave 2 (Plan 02) can now wire these into `services/nostr.ts`'s `giftWraps$` and `notifications/messages.ts`'s NIP-17 block against this full-suite safety net, per the plan's stated purpose.

---
*Phase: 04-add-nip-17-dm-notifications-support-per-applesauce-docs*
*Completed: 2026-07-10*
