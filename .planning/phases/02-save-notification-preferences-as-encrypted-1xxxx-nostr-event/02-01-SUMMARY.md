---
phase: 02-save-notification-preferences-as-encrypted-1xxxx-nostr-event
plan: 01
subsystem: nostr-sync
tags: [nip-78, nip-44, applesauce, bun-test, notification-preferences, pure-helpers]

# Dependency graph
requires: []
provides:
  - "helpers/preferences.ts pure contract: PREFS_KIND (30078), PREFS_NAMESPACE, PREFS_VERSION, SyncedPrefs type, serializePrefs, mergePrefs, sanitizeSyncedPrefs, isNewerPrefs, samePrefsPayload"
  - "Proven D2-01/D2-02/D2-03 event shape (manual EventTemplate + NIP-44 self-encrypt) round-trips through applesauce-common's app-data read helpers"
  - "Proven D2-04/D2-05/D2-06 rules-only serialization contract that never leaks pubkey/signer/server/topic/email/lookupRelays/sendContent/groupLink"
  - "Proven D2-08 high-water-mark and D2-09 loop-prevention primitives"
affects: [02-02, 02-03, 02-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure helper module mirroring helpers/groups.ts split (no services/nostr import, unit-testable without live relays)"
    - "Field-by-field object construction (never spread whole sub-objects) to guarantee sensitive fields cannot leak into a synced payload"
    - "Payload-equality (JSON.stringify comparison) as the loop-prevention primitive instead of a skip(1)/count-based guard"

key-files:
  created:
    - helpers/preferences.ts
    - tests/helpers/preferences.test.ts
  modified: []

key-decisions:
  - "PREFS_NAMESPACE set to \"nostr-secretary/notification-prefs\" (Claude's discretion per RESEARCH.md)"
  - "sanitizeSyncedPrefs defaults missing/invalid sections to well-formed empty shapes (never throws) so a malformed inbound payload degrades to a benign no-op merge rather than corrupting config"
  - "Event round-trip test uses the fully-manual D2-03 path (raw EventTemplate + signer.nip44.encrypt + signer.signEvent), not the EventFactory builder alternative RESEARCH.md flagged, per the locked decision"

patterns-established:
  - "helpers/preferences.ts is the pure-logic half of Phase 2; services/preferences.ts (Plan 03) will own all RxJS/relay wiring and import these functions"

requirements-completed: [D2-01, D2-02, D2-03, D2-04, D2-05, D2-06, D2-08, D2-09]

coverage:
  - id: D1
    description: "serializePrefs extracts exactly the D2-04 rules subset and never emits pubkey/signer/server/topic/email/lookupRelays/sendContent/groupLink"
    requirement: "D2-04, D2-05, D2-06"
    verification:
      - kind: unit
        ref: "tests/helpers/preferences.test.ts#serializePrefs"
        status: pass
    human_judgment: false
  - id: D2
    description: "mergePrefs overwrites only synced fields, preserving current's local-only secrets (signer/pubkey/server/topic/email/lookupRelays/sendContent/groupLink)"
    requirement: "D2-06"
    verification:
      - kind: unit
        ref: "tests/helpers/preferences.test.ts#mergePrefs"
        status: pass
    human_judgment: false
  - id: D3
    description: "sanitizeSyncedPrefs rejects non-objects and drops invalid whitelist/blacklist entries and invalid groups.modes values"
    requirement: "D2-06"
    verification:
      - kind: unit
        ref: "tests/helpers/preferences.test.ts#sanitizeSyncedPrefs"
        status: pass
    human_judgment: false
  - id: D4
    description: "isNewerPrefs strict high-water-mark and samePrefsPayload loop-prevention primitives, including the merge-then-reserialize precondition"
    requirement: "D2-08, D2-09"
    verification:
      - kind: unit
        ref: "tests/helpers/preferences.test.ts#isNewerPrefs, tests/helpers/preferences.test.ts#samePrefsPayload"
        status: pass
    human_judgment: false
  - id: D5
    description: "A manually-built kind-30078 EventTemplate, NIP-44 self-encrypted and signed via PrivateKeySigner, decrypts back to the identical SyncedPrefs via applesauce-common's unlockAppData/getAppDataContent"
    requirement: "D2-01, D2-02, D2-03"
    verification:
      - kind: unit
        ref: "tests/helpers/preferences.test.ts#event round-trip (D2-01/D2-02/D2-03)"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-07-09
status: complete
---

# Phase 2 Plan 1: Pure preferences helpers Summary

**Pure serialize/merge/validate/conflict-resolution contract for the notification-prefs sync payload, proven end-to-end with a real NIP-44 self-encrypted kind-30078 event round-trip through applesauce's app-data helpers**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-09
- **Tasks:** 1 (TDD: RED then GREEN)
- **Files modified:** 2 (both new)

## Accomplishments
- `helpers/preferences.ts` created as a pure module (mirrors `helpers/groups.ts`) exporting `PREFS_KIND` (30078), `PREFS_NAMESPACE`, `PREFS_VERSION`, the `SyncedPrefs` type, `serializePrefs`, `mergePrefs`, `sanitizeSyncedPrefs`, `isNewerPrefs`, and `samePrefsPayload` — zero imports from `services/nostr` (Pitfall 6)
- `serializePrefs` builds the D2-04 rules-only subset field-by-field, proven (via a JSON-string negative-assertion test) to never emit `pubkey`, `signer`, `server`, `topic`, `email`, `lookupRelays`, `messages.sendContent`, or `groups.groupLink` (D2-05/Pitfall 8)
- `sanitizeSyncedPrefs` is the ASVS V5 validator for untrusted inbound payloads: rejects non-objects, drops non-string whitelist/blacklist entries, and drops invalid `groups.modes` values by reusing `helpers/groups.ts`'s `isGroupNotificationMode` guard
- `isNewerPrefs`/`samePrefsPayload` are the D2-08 strict high-water-mark and D2-09 payload-equality loop-prevention primitives that `services/preferences.ts` (Plan 03) will compose
- The event round-trip test constructs a `PrivateKeySigner`, builds a manual `{ kind: 30078, tags: [["d", PREFS_NAMESPACE]], content }` `EventTemplate` (D2-03), NIP-44 self-encrypts (D2-02), signs, and proves it decrypts back to the identical `SyncedPrefs` via `applesauce-common/helpers/app-data`'s `unlockAppData`/`getAppDataContent` (D2-01/interop) — validating the exact write shape and the third-party-app-compatible read shape in one test
- Full `bun:test` suite green (40/40 across the repo, no regression to Phase 1 tests) and `bun run lint` (`tsc --noEmit`) clean under strict mode with `noUncheckedIndexedAccess`

## Task Commits

TDD task, executed as RED then GREEN:

1. **Task 1 (RED): add failing test for preferences helpers** - `1f4a05e` (test)
2. **Task 1 (GREEN): implement preferences helpers** - `93bb4a2` (feat)

_No REFACTOR commit was needed — the GREEN implementation required no follow-up cleanup._

## TDD Gate Compliance

- RED gate: `1f4a05e` (`test(02-01): add failing test for preferences helpers`) — verified to fail (`Cannot find module '../../helpers/preferences'`) before the implementation existed.
- GREEN gate: `93bb4a2` (`feat(02-01): implement preferences helpers`) — verified all 15 tests pass immediately after.
- Sequence confirmed in `git log`: test commit precedes feat commit. Compliant.

## Files Created/Modified
- `helpers/preferences.ts` - Pure serialize/merge/validate/conflict-resolution functions for the notification-prefs sync contract; the symbol set every downstream Phase-2 plan imports
- `tests/helpers/preferences.test.ts` - 15-test `bun:test` suite (45 assertions) covering the full behavior block, including the live NIP-44 event round-trip against a `PrivateKeySigner`

## Decisions Made
- `PREFS_NAMESPACE` set to the literal string `"nostr-secretary/notification-prefs"` (Claude's discretion, per RESEARCH.md's "Claude's Discretion" section)
- `sanitizeSyncedPrefs` never throws and never returns a partially-invalid object: an invalid/missing section always defaults to a well-formed empty shape, so a malformed remote payload degrades to the safest possible merge (existing config fields untouched or reset to empty, never corrupted with wrong-typed data)
- Followed D2-03 literally: the round-trip test uses the fully-manual `EventTemplate` + `signer.nip44.encrypt` + `signer.signEvent` path, not the `EventFactory` builder RESEARCH.md flagged as a verified-working alternative — this plan does not reopen that locked decision

## Deviations from Plan

None - plan executed exactly as written. `bun install` was run once at the start of execution because this worktree had no `node_modules` yet (a standard, expected worktree-setup step, not a plan deviation — all packages resolved from the existing `bun.lock`/local cache with zero version changes and zero new dependencies).

## Issues Encountered
None. `prettier --write` reformatted `tests/helpers/preferences.test.ts` (wrapping some inline object literals across multiple lines) to match the project's Prettier config before the GREEN commit — a formatting-only change with no effect on test behavior (all 15 tests remained green after).

## Next Phase Readiness
- Plan 02 (SIGNER_PERMISSIONS expansion + wiring) and Plan 03 (services/preferences.ts RxJS wiring) can now import `helpers/preferences.ts`'s full symbol set with confidence in its exact JSON contract and edge-case behavior
- The interop read path (`applesauce-common/helpers/app-data`) is confirmed compatible with the D2-03 manual write path — Plan 03 can use either the manual path or the `EventFactory` builder alternative without re-verifying the encryption/decryption round-trip

---
*Phase: 02-save-notification-preferences-as-encrypted-1xxxx-nostr-event*
*Plan: 01*
*Completed: 2026-07-09*
