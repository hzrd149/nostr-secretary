---
phase: 01-nip-29-group-notification-modes
plan: 01
subsystem: testing
tags: [bun-test, applesauce, nostr-tools, tdd, nip-29, nip-19]

# Dependency graph
requires: []
provides:
  - "bun:test test harness (package.json `test` script wired to `bun test`)"
  - "helpers/groups.ts pure exports: GroupNotificationMode, DEFAULT_GROUP_NOTIFICATION_MODE, messageMentionsPubkey, passesGroupModeGate, getGroupMode, summarizeGroupModes, isGroupNotificationMode"
  - "tests/helpers/groups.test.ts — reference pattern for constructing synthetic NostrEvent fixtures with nostr-tools/pure + nostr-tools/nip19"
affects: [01-02, 01-03, 01-04, 01-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "bun:test as the project's test runner (describe/test/expect from \"bun:test\")"
    - "Synthetic NostrEvent fixtures built as plain typed objects (no signing needed for pure-function tests)"
    - "Reuse applesauce-core/helpers (getContentPointers, getPubkeyFromDecodeResult) instead of hand-rolled bech32/nostr: regex parsing"

key-files:
  created:
    - tests/helpers/groups.test.ts
  modified:
    - package.json
    - helpers/groups.ts

key-decisions:
  - "GroupNotificationMode type lives solely in helpers/groups.ts as the single source of truth (services/config.ts will import type, not redeclare, in Plan 02)"
  - "DEFAULT_GROUP_NOTIFICATION_MODE modeled as a constant, not a stored config field"
  - "messageMentionsPubkey short-circuits on p-tag match before falling back to content-pointer scan"

requirements-completed: [D-01, D-02, D-05, D-06]

coverage:
  - id: D1
    description: "getGroupMode returns stored mode for known group, DEFAULT_GROUP_NOTIFICATION_MODE for unknown group (D-01/D-06)"
    requirement: "D-01"
    verification:
      - kind: unit
        ref: "tests/helpers/groups.test.ts#getGroupMode > returns the stored mode for a known group (D-01)"
        status: pass
      - kind: unit
        ref: "tests/helpers/groups.test.ts#getGroupMode > returns DEFAULT_GROUP_NOTIFICATION_MODE for an unknown group (D-06)"
        status: pass
    human_judgment: false
  - id: D2
    description: "passesGroupModeGate: false for muted, true for all, messageMentionsPubkey(...) for mentions (D-01)"
    requirement: "D-01"
    verification:
      - kind: unit
        ref: "tests/helpers/groups.test.ts#passesGroupModeGate > returns false for 'muted' (D-01)"
        status: pass
      - kind: unit
        ref: "tests/helpers/groups.test.ts#passesGroupModeGate > returns true for 'all' (D-01)"
        status: pass
      - kind: unit
        ref: "tests/helpers/groups.test.ts#passesGroupModeGate > returns messageMentionsPubkey(...) for 'mentions' when the message mentions the user (D-01/D-02)"
        status: pass
      - kind: unit
        ref: "tests/helpers/groups.test.ts#passesGroupModeGate > returns messageMentionsPubkey(...) for 'mentions' when the message does not mention the user (D-01/D-02)"
        status: pass
    human_judgment: false
  - id: D3
    description: "messageMentionsPubkey: true on p-tag match OR nostr: content mention (npub/nprofile), false when neither matches (D-02)"
    requirement: "D-02"
    verification:
      - kind: unit
        ref: "tests/helpers/groups.test.ts#messageMentionsPubkey > returns true on a p-tag match (D-02)"
        status: pass
      - kind: unit
        ref: "tests/helpers/groups.test.ts#messageMentionsPubkey > returns true on a nostr:npub content mention with no p-tag (D-02)"
        status: pass
      - kind: unit
        ref: "tests/helpers/groups.test.ts#messageMentionsPubkey > returns true on a nostr:nprofile content mention (D-02)"
        status: pass
      - kind: unit
        ref: "tests/helpers/groups.test.ts#messageMentionsPubkey > returns false when neither a p-tag nor a content mention matches (D-02)"
        status: pass
    human_judgment: false
  - id: D4
    description: "summarizeGroupModes returns per-mode counts { all, mentions, muted } for the /notifications card (D-05)"
    requirement: "D-05"
    verification:
      - kind: unit
        ref: "tests/helpers/groups.test.ts#summarizeGroupModes > returns per-mode counts (D-05)"
        status: pass
      - kind: unit
        ref: "tests/helpers/groups.test.ts#summarizeGroupModes > returns all-zero counts for an empty modes map"
        status: pass
    human_judgment: false
  - id: D5
    description: "isGroupNotificationMode narrows an untrusted value to the literal union, rejecting any other value (ASVS V5)"
    verification:
      - kind: unit
        ref: "tests/helpers/groups.test.ts#isGroupNotificationMode > accepts each valid literal (ASVS V5)"
        status: pass
      - kind: unit
        ref: "tests/helpers/groups.test.ts#isGroupNotificationMode > rejects any other value (ASVS V5)"
        status: pass
    human_judgment: false
  - id: D6
    description: "package.json exposes a runnable bun test script"
    verification:
      - kind: unit
        ref: "bun run lint && bun test (full suite)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-07
status: complete
---

# Phase 01 Plan 01: Group Notification Mode Helpers Summary

**Pure, unit-tested three-way group notification mode gate (all/mentions/muted) plus an @mention detector reusing applesauce-core's NIP-19 pointer helpers — no hand-rolled bech32 parsing.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-07T21:XX:XXZ
- **Completed:** 2026-07-07T21:52:13Z
- **Tasks:** 2 completed
- **Files modified:** 3 (package.json, helpers/groups.ts, tests/helpers/groups.test.ts created)

## Accomplishments
- Established the project's first test harness (`bun:test` via `package.json`'s new `test` script — no test infra existed before this plan)
- Implemented `GroupNotificationMode` (`"all" | "mentions" | "muted"`) and `DEFAULT_GROUP_NOTIFICATION_MODE` (`"mentions"`) as the single source of truth for the whole phase
- Implemented `messageMentionsPubkey` (D-02): p-tag match OR `nostr:` content-pointer match via `getContentPointers` + `getPubkeyFromDecodeResult` from `applesauce-core/helpers` — zero hand-rolled regex
- Implemented `passesGroupModeGate` (D-01): exhaustive switch over the three modes, compiled clean under `tsc --noEmit` strict mode
- Implemented `getGroupMode` (D-06) and `summarizeGroupModes` (D-05)
- Implemented `isGroupNotificationMode` (ASVS V5 type guard) that later plans' `/groups` PATCH handler will use to keep arbitrary strings out of `config.groups.modes`
- Followed TDD RED → GREEN: wrote and confirmed a failing test suite before implementing any of the seven new exports

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the bun test script to package.json** - `68866ac` (chore)
2. **Task 2: Implement the pure group-mode helpers (test-first)** - `deaf19b` (test, RED) then `42edad5` (feat, GREEN)

_TDD task produced two commits (test → feat); no refactor commit was needed — the implementation matched the plan's exact signatures with no cleanup required._

## Files Created/Modified
- `package.json` - Added `"test": "bun test"` script alongside existing `dev`/`lint`/`format`
- `helpers/groups.ts` - Added the seven new pure exports colocated with the existing (unchanged) `getGroupMetadata` fetch helper
- `tests/helpers/groups.test.ts` - New `bun:test` suite (15 tests) covering D-01, D-02, D-05, D-06, and the ASVS V5 validator, using synthetic `NostrEvent` fixtures and `nostr-tools/nip19`'s `npubEncode`/`nprofileEncode` for content-mention cases

## Decisions Made
- `GroupNotificationMode` type declared only in `helpers/groups.ts`; Plan 02's `services/config.ts` will `import type` it rather than redeclaring, per the plan's explicit single-source-of-truth instruction
- `DEFAULT_GROUP_NOTIFICATION_MODE` modeled as an in-code constant, not a stored/configurable default, matching D-06 and the RESEARCH.md "Config Storage Shape" guidance
- Test fixtures use plain typed objects (not `finalizeEvent`-signed events) since none of the functions under test verify signatures — kept the suite fast and dependency-free of real key generation for message shape, only using `generateSecretKey`/`getPublicKey` to obtain realistic hex pubkeys for tag/content matching

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Ran `bun install` before any verification — `node_modules` did not exist in the worktree**
- **Found during:** Task 1 (before running the first verification command)
- **Issue:** The worktree had no `node_modules` directory, so `bun test`/`bun run lint` would fail immediately regardless of code correctness. This is normal for a freshly created worktree, not a plan defect.
- **Fix:** Ran `bun install`, which resolved exactly the versions already pinned in `bun.lock` (no `package.json` or lockfile changes).
- **Files modified:** None (node_modules is gitignored; no lockfile drift).
- **Verification:** `bun run lint` and `bun test` both ran successfully afterward.
- **Committed in:** N/A (no file changes to commit; environment setup only)

**2. [Rule 1 - Bug] Task 1's stated verify command doesn't match actual Bun 1.3.14 output when zero test files exist**
- **Found during:** Task 1 verification (`bun test 2>&1 | grep -qiE "pass|no tests|ran"`)
- **Issue:** The plan's acceptance criteria state "0 tests is acceptable at this point — the script must be runnable," implying `bun test` exits cleanly with a "no tests" style message when no test files exist yet. On the installed Bun version (1.3.14), running `bun test` with zero matching test files instead prints `error: 0 test files matching ...` and exits with code 1 — it does not print "pass", "no tests", or "ran". This is a plan-verification-command assumption that doesn't hold on this Bun version, not a defect in the produced `package.json` change.
- **Fix:** No code fix needed — the `test` script itself (`"test": "bun test"`) is correctly wired per the acceptance criteria's primary requirement ("`package.json` `scripts.test` equals `bun test`"). Proceeded to Task 2 in the same plan (per the plan's own Wave 1 sequencing), which immediately adds `tests/helpers/groups.test.ts`. The full-suite verify command (`bun test`) at the end of the plan now runs 15 passing tests with zero errors, fully proving the script works end-to-end.
- **Files modified:** None beyond the already-committed `package.json` change.
- **Verification:** `bun test` (full suite, after Task 2) — "15 pass, 0 fail, ran across 1 file", exit 0.
- **Committed in:** `68866ac` (Task 1 commit, unchanged) — no additional commit needed since the underlying script was already correct.

---

**Total deviations:** 2 auto-fixed (1 environment setup, 1 verification-command assumption mismatch)
**Impact on plan:** No scope creep, no code changes beyond what the plan specified. Both items are process/tooling observations that resolved themselves once the plan's own Wave 1 sequence (Task 1 then Task 2) completed.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `helpers/groups.ts` now exports the full symbol set (`GroupNotificationMode`, `DEFAULT_GROUP_NOTIFICATION_MODE`, `messageMentionsPubkey`, `passesGroupModeGate`, `getGroupMode`, `summarizeGroupModes`, `isGroupNotificationMode`) that Plans 02-05 compose against, exactly as specified in the phase symbol map.
- Test harness (`bun:test` via `package.json`'s `test` script) is proven runnable and will be reused by Plan 02 (`tests/services/config.test.ts`) and Plan 03 (`tests/notifications/groups.test.ts`).
- No blockers for Plan 02 (config field + migration) or Plan 03 (notification gate wiring) — both consume these exports directly.

---
*Phase: 01-nip-29-group-notification-modes*
*Completed: 2026-07-07*

## Self-Check: PASSED

- FOUND: helpers/groups.ts
- FOUND: tests/helpers/groups.test.ts
- FOUND: package.json
- FOUND: 68866ac (Task 1 commit)
- FOUND: deaf19b (Task 2 RED commit)
- FOUND: 42edad5 (Task 2 GREEN commit)
