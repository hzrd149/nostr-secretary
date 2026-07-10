---
phase: 03-review-and-add-nip-04-dm-support-per-applesauce-docs
plan: 03
subsystem: notifications
tags: [nip-04, applesauce-common, rxjs, catchError, deep-link, bun-test]

# Dependency graph
requires:
  - phase: 03-review-and-add-nip-04-dm-support-per-applesauce-docs
    provides: "03-01 added nip04_decrypt to SIGNER_PERMISSIONS; 03-02 fixed the sendContent config-migration default to false"
provides:
  - "notifications/messages.ts NIP-04 block wrapped in catchError(()=>EMPTY) so one undecryptable/rejected/timed-out kind-4 event no longer tears down the messages subscription (parity with the existing NIP-17 path)"
  - "exported nip04DecryptDegraded\$ BehaviorSubject<boolean> — true on any NIP-04 decrypt failure, reset to false on the next successful unlock"
  - "DmDecryptHint() async component on /notifications, mirroring SyncStatusHint, showing a non-blocking reconnect-to-/signer hint only while nip04DecryptDegraded\$ is true"
  - "DM notifications now set click: buildOpenLink(event) so tapping deep-links into the user's client, matching replies.ts/zaps.ts"
  - "tests/notifications/messages.test.ts: network-safe unlockLegacyMessage round-trip + garbage-ciphertext rejection + local shouldNotify gate-order mirror"
affects: [04-nip-17-gift-wrap-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "mergeMap(event => {...guards; return from(asyncBody()).pipe(catchError(...))}) — wrap the whole async body (not just the risky call) in one catchError, mirroring the NIP-17 block"
    - "edge-triggered BehaviorSubject<boolean> flipped true in catchError / false on the happy path, read via firstValueFrom(...).catch(() => false) in an async page component — the D2-14 reconnect-hint pattern reapplied"

key-files:
  created:
    - tests/notifications/messages.test.ts
  modified:
    - notifications/messages.ts
    - pages/notifications.tsx

key-decisions:
  - "Wrapped the entire NIP-04 async body (profile fetch + unlockLegacyMessage) in one catchError, not just the decrypt call, since getValue(eventStore.profile(...)) can also reject with a TimeoutError (documented CONCERNS.md fragility) — matches RESEARCH.md's recommended fix over the narrower 'guard only unlockLegacyMessage' alternative"
  - "Treated any NIP-04 decrypt failure while a signer is connected as reconnect-hint-worthy (best-effort), rather than string-matching the bunker's free-text error for a 'permission denied' phrase — NIP-46 has no standardized error code for this (Pitfall 2 / Assumption A1)"
  - "Used a local shouldNotify gate-order mirror in the test file (mirroring groups.test.ts's WR-04 precedent) rather than exporting shouldNotify from messages.ts, keeping the change strictly test-file-scoped and avoiding any visibility change to production code"
  - "DmDecryptHint reuses the existing .sync-hint CSS class verbatim — no new styles added"

patterns-established: []

requirements-completed: [D3-01, D3-05, D3-06, D3-07, D3-08, D3-09, D3-10]

coverage:
  - id: D1
    description: "NIP-04 mergeMap wrapped in catchError(()=>EMPTY) — a single undecryptable/rejected/timed-out kind-4 event no longer tears down the messages subscription; catchError logs only the error message string (D3-08)"
    requirement: "D3-08"
    verification:
      - kind: unit
        ref: "tests/notifications/messages.test.ts#unlockLegacyMessage (NIP-04) > rejects a garbage/non-ciphertext content value"
        status: pass
      - kind: other
        ref: "grep -q 'buildOpenLink(event)' notifications/messages.ts && bun run lint && bun test"
        status: pass
    human_judgment: true
    rationale: "The catchError/EMPTY subscription-survival guarantee and the live NIP-46 bunker permission failure it protects against can only be fully confirmed with a real bunker sending a genuinely undecryptable/rejected DM in production — deferred to manual UAT per 03-VALIDATION.md Manual-Only, consistent with phases 1/2's live-signer deferrals."
  - id: D2
    description: "nip04DecryptDegraded\$ exported BehaviorSubject<boolean>, set true on any NIP-04 decrypt failure while a signer is connected, reset false on the next successful unlock (D3-07)"
    requirement: "D3-07"
    verification:
      - kind: other
        ref: "grep -q 'export const nip04DecryptDegraded\\$' notifications/messages.ts && bun run lint"
        status: pass
    human_judgment: true
    rationale: "The flag's true production trigger (a bunker actually rejecting nip04_decrypt) requires a live NIP-46 signer session to observe end-to-end; static/lint verification confirms the wiring but not the live degrade/recover cycle. Deferred to manual UAT per 03-VALIDATION.md."
  - id: D3
    description: "DmDecryptHint() renders a non-blocking reconnect-to-/signer hint on /notifications only while nip04DecryptDegraded\$ is true, via firstValueFrom(...).catch(() => false), reusing the .sync-hint CSS; renders nothing otherwise"
    requirement: "D3-07"
    verification:
      - kind: other
        ref: "grep -q 'DmDecryptHint' pages/notifications.tsx && grep -q 'nip04DecryptDegraded\\$' pages/notifications.tsx && bun run lint"
        status: pass
    human_judgment: true
    rationale: "Visual confirmation that the hint actually appears/disappears in the rendered page for a real degraded/recovered signer state is a UI judgment call best left to manual UAT; static verification here only confirms the component exists, reads the correct signal, and typechecks."
  - id: D4
    description: "DM notifications thread the raw event through the NIP-04 pipeline and set click: buildOpenLink(event), so tapping a DM notification deep-links into the user's client (matches replies.ts/zaps.ts)"
    requirement: "D3-06"
    verification:
      - kind: other
        ref: "grep -q 'buildOpenLink(event)' notifications/messages.ts && bun run lint && bun test"
        status: pass
    human_judgment: false
  - id: D5
    description: "Generic notification title preserved; body is decrypted content only when messages.sendContent is true, else '[content omitted]' — confirmed unchanged (D3-05)"
    requirement: "D3-05"
    verification:
      - kind: other
        ref: "git diff notifications/messages.ts (title/message lines unchanged in the rewritten NIP-04 block)"
        status: pass
    human_judgment: false
  - id: D6
    description: "tests/notifications/messages.test.ts: unlockLegacyMessage NIP-04 round-trip via PrivateKeySigner, a garbage-ciphertext rejection case, and a local shouldNotify gate-order mirror — no import of notifications/messages.ts or the notifications barrel (D3-09, Pitfall 1)"
    requirement: "D3-09"
    verification:
      - kind: unit
        ref: "bun test tests/notifications/messages.test.ts (8 pass)"
        status: pass
    human_judgment: false

# Metrics
duration: 5min
completed: 2026-07-10
status: complete
---

# Phase 3 Plan 3: Harden NIP-04 legacy-DM listener (catchError, reconnect hint, deep-link) Summary

**Wrapped the NIP-04 kind-4 decrypt mergeMap in catchError/EMPTY parity with the NIP-17 path, added an exported `nip04DecryptDegraded$` signal with a non-blocking `/notifications` reconnect hint, threaded the raw event through for `click: buildOpenLink(event)` deep-linking, removed the dead `getLegacyMessageCorraspondant` import, and added `tests/notifications/messages.test.ts` covering the decrypt round-trip and the `shouldNotify` gate order without importing the self-subscribing notification module.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-07-10T03:33:35Z (approx, first task commit)
- **Completed:** 2026-07-10T03:38:35Z
- **Tasks:** 3
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- NIP-04 mergeMap's entire async body (profile fetch + `unlockLegacyMessage`) is now wrapped in `catchError(()=>EMPTY)`, matching the existing NIP-17 gift-wrap block's resilience — one bad DM can no longer kill the messages subscription
- New exported `nip04DecryptDegraded$` BehaviorSubject flips true on any NIP-04 decrypt failure while a signer is connected and resets to false on the next successful unlock
- New `DmDecryptHint()` component on `/notifications`, mounted beside `SyncStatusHint`, shows a reconnect-to-`/signer` hint only while degraded, reusing the existing `.sync-hint` CSS
- DM notifications now set `click: buildOpenLink(event)`, matching `replies.ts`/`zaps.ts` deep-link behavior
- Removed the unused deprecated `getLegacyMessageCorraspondant` import; `getLegacyMessageReceiver` remains
- New `tests/notifications/messages.test.ts`: NIP-04 decrypt round-trip via `PrivateKeySigner`, a garbage-ciphertext rejection case documenting the exact failure the new `catchError` absorbs, and a local `shouldNotify` gate-order mirror (mute → per-section blacklist → per-section whitelist → global whitelist → global blacklist) — no import of `notifications/messages.ts` or the barrel

## Task Commits

Each task was committed atomically:

1. **Task 1: Create tests/notifications/messages.test.ts** - `aa6108c` (test)
2. **Task 2: Harden notifications/messages.ts NIP-04 block** - `b396b84` (feat)
3. **Task 3: Render the non-blocking reconnect hint on /notifications** - `0338b72` (feat)

_Note: Task 2 was tagged `tdd="true"` in the plan, but the plan's actual sequencing places the test file (Task 1) before the implementation (Task 2), which already satisfies the RED-then-GREEN gate order at the plan level._

## Files Created/Modified
- `tests/notifications/messages.test.ts` - New: NIP-04 decrypt round-trip + garbage-ciphertext rejection + shouldNotify gate-order mirror
- `notifications/messages.ts` - NIP-04 block hardened: catchError/EMPTY, nip04DecryptDegraded$, event threaded + click:buildOpenLink(event), dead import removed
- `pages/notifications.tsx` - New DmDecryptHint() component mounted in NotificationsView

## Decisions Made
- Wrapped the *entire* NIP-04 async body (profile fetch + decrypt) in one `catchError`, not just `unlockLegacyMessage`, since the profile fetch's `getValue(...)` can also throw a `TimeoutError` — matches RESEARCH.md's explicit recommendation over the narrower alternative.
- Treated any NIP-04 decrypt failure as reconnect-hint-worthy rather than string-matching a "permission denied" phrase, since NIP-46 has no standardized error code for this (Pitfall 2).
- Used a local `shouldNotify` gate-order mirror in the test file rather than exporting `shouldNotify` from `messages.ts`, keeping the change strictly test-scoped (avoids any production visibility change, matching the `groups.test.ts` WR-04 precedent exactly).
- `DmDecryptHint` reuses the existing `.sync-hint` CSS class verbatim — no new styles.

## Deviations from Plan

None - plan executed exactly as written. All three tasks matched the plan's `<action>` and `<behavior>` specs precisely; no Rule 1-4 fixes were needed.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The NIP-04 legacy-DM path is now hardened to the same resilience standard as the NIP-17 gift-wrap path (Phase 4 will review/harden NIP-17 itself, per D3-10's explicit deferral — the NIP-17 block was intentionally left untouched here).
- Full automated suite (`bun test`, 58 tests) and `bun run lint` (`tsc --noEmit`) are green.
- Manual/live-bunker verification (a fresh bunker decrypting a real kind-4 DM; the reconnect hint appearing for an already-connected signer lacking the permission) is deferred to `/gsd-verify-work` per `03-VALIDATION.md`'s Manual-Only section — this requires a live NIP-46 signer session not available in this execution environment.

---
*Phase: 03-review-and-add-nip-04-dm-support-per-applesauce-docs*
*Completed: 2026-07-10*
