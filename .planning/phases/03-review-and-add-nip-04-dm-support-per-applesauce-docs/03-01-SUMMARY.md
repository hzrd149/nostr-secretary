---
phase: 03-review-and-add-nip-04-dm-support-per-applesauce-docs
plan: 01
subsystem: auth
tags: [nip-46, nostr-connect, applesauce-signers, nip-04, permissions, bun-test]

# Dependency graph
requires:
  - phase: 02-save-notification-preferences-as-encrypted-1xxxx-nostr-event
    provides: SIGNER_PERMISSIONS constant already extended for kind-30078 + NIP-44 self-encryption
provides:
  - SIGNER_PERMISSIONS in const.ts now requests nip04_decrypt (via Permission.Nip04Decrypt) so freshly connected NIP-46 bunkers can be granted legacy kind-4 DM decrypt authority
  - Regression tests locking in the receive-only permission boundary (nip04_decrypt present, nip04_encrypt absent)
affects: [03-02, 03-03]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - const.ts
    - tests/const.test.ts

key-decisions:
  - "Used the applesauce-provided Permission.Nip04Decrypt constant (applesauce-signers/helpers) instead of a hand-typed \"nip04_decrypt\" string literal, per D3-02 and the research's Don't-Hand-Roll guidance"
  - "Deliberately did not request nip04_encrypt — receive-only notification secretary, no DM send surface (D3-03)"
  - "Rephrased the JSDoc to avoid the literal substring \"nip04_encrypt\" so it doesn't trip the plan's negative grep check (grep -q 'nip04_encrypt' const.ts must NOT match) while still documenting the receive-only boundary in prose"

patterns-established: []

requirements-completed: [D3-02, D3-03, D3-09]

coverage:
  - id: D1
    description: "SIGNER_PERMISSIONS requests nip04_decrypt via the applesauce Permission.Nip04Decrypt constant, fixing the bug where NIP-46 bunkers never granted legacy kind-4 DM decrypt authority"
    requirement: "D3-02"
    verification:
      - kind: unit
        ref: "tests/const.test.ts#SIGNER_PERMISSIONS > includes nip04_decrypt (D3-02 — legacy kind-4 DM decryption)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Receive-only boundary locked in by test: SIGNER_PERMISSIONS never requests nip04_encrypt (no DM send surface exists in this app)"
    requirement: "D3-03"
    verification:
      - kind: unit
        ref: "tests/const.test.ts#SIGNER_PERMISSIONS > does NOT include nip04_encrypt (D3-03 — receive-only, no DM send path)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Existing permission entries (get_public_key, sign_event:22242, sign_event:30078, nip44_encrypt, nip44_decrypt) remain untouched — the new entry is additive"
    verification:
      - kind: unit
        ref: "tests/const.test.ts (all 5 pre-existing SIGNER_PERMISSIONS cases)"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-07-09
status: complete
---

# Phase 3 Plan 1: NIP-46 nip04_decrypt permission fix Summary

**SIGNER_PERMISSIONS now requests `nip04_decrypt` via applesauce's `Permission.Nip04Decrypt` constant, fixing the one concrete bug behind the whole phase: NIP-46 bunkers were never granted legacy kind-4 DM decrypt authority at connect time.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-09T22:24:35-05:00 (relative to prior phase docs commit)
- **Completed:** 2026-07-09T22:30:29-05:00
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- Added a failing (RED) test asserting `SIGNER_PERMISSIONS` contains `nip04_decrypt`, plus an immediately-green test asserting it does NOT contain `nip04_encrypt` (D3-02/D3-03 receive-only boundary), following existing TDD-style test shape in `tests/const.test.ts`
- Fixed the bug: imported `Permission` from `applesauce-signers/helpers` and appended `Permission.Nip04Decrypt` to `SIGNER_PERMISSIONS` in `const.ts`, turning the RED test GREEN without touching any existing permission entry
- Extended the JSDoc above `SIGNER_PERMISSIONS` to document the new legacy kind-4 decrypt grant and the deliberate receive-only boundary
- Confirmed both signer connect call sites (`services/signer.ts` QR flow and bunker-URI flow) already read `SIGNER_PERMISSIONS` by reference — no call-site changes needed or made

## Task Commits

Each task was committed atomically:

1. **Task 1: Add failing nip04_decrypt / no-nip04_encrypt assertions to tests/const.test.ts** - `98d6837` (test)
2. **Task 2: Add Permission.Nip04Decrypt to SIGNER_PERMISSIONS in const.ts** - `c1cadce` (feat)

_TDD gate sequence confirmed: `test(...)` commit (RED gate, 98d6837) precedes the `feat(...)` commit (GREEN gate, c1cadce). No refactor commit was needed._

## Files Created/Modified
- `const.ts` - Imported `Permission` from `applesauce-signers/helpers`; appended `Permission.Nip04Decrypt` (`"nip04_decrypt"`) as a new, additive entry in `SIGNER_PERMISSIONS`; updated JSDoc to describe the new legacy-DM decrypt grant and the receive-only boundary
- `tests/const.test.ts` - Added two new `test()` cases inside the existing `describe("SIGNER_PERMISSIONS")` block: presence of `nip04_decrypt` (D3-02) and absence of `nip04_encrypt` (D3-03)

## Decisions Made
- Used `Permission.Nip04Decrypt` (applesauce-signers/helpers) rather than a hand-typed `"nip04_decrypt"` string literal, matching the plan's explicit instruction and the research's "Don't Hand-Roll" guidance (avoids typos, matches the exact string the NIP-46 RPC method expects)
- Kept the existing hand-typed `nip44_encrypt`/`nip44_decrypt` entries untouched — no refactor to constants, per plan scope (D3-10)
- Rephrased the new JSDoc prose to avoid containing the literal substring `nip04_encrypt` (used "the NIP-04 encrypt permission" instead), since the plan's own automated verification (`grep -q 'nip04_encrypt' const.ts` must NOT match) would otherwise have been tripped by a doc comment that mentions the excluded permission by name

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JSDoc initially contained the literal string "nip04_encrypt", failing the plan's own negative-grep verification**
- **Found during:** Task 2 (writing the extended JSDoc)
- **Issue:** My first draft of the updated JSDoc explained the receive-only boundary using the exact literal text `nip04_encrypt`, which caused `grep -q 'nip04_encrypt' const.ts` (part of the plan's `<verify>` block) to match — even though no actual permission was added, only prose mentioning the excluded one
- **Fix:** Reworded the JSDoc to describe the same boundary ("the NIP-04 encrypt permission is deliberately not requested") without using the literal substring `nip04_encrypt`
- **Files modified:** const.ts
- **Verification:** Re-ran `grep -q 'Nip04Decrypt' const.ts` (matches) and `! grep -q 'nip04_encrypt' const.ts` (no longer matches) — both pass; `bun test tests/const.test.ts` still 7/7 green; `bun run lint` clean
- **Committed in:** c1cadce (Task 2 commit — fixed before commit, no separate commit needed)

---

**Total deviations:** 1 auto-fixed (1 bug — Rule 1, caught before commit)
**Impact on plan:** No scope creep; the fix was purely wording in a doc comment, required to satisfy the plan's own literal verification command.

## Issues Encountered
None beyond the auto-fixed JSDoc wording issue above.

## User Setup Required
None - no external service configuration required. Full end-to-end confirmation that a live NIP-46 bunker actually honors the new `nip04_decrypt` grant requires a live signer session and is deferred to human UAT (consistent with phases 1 and 2), per 03-RESEARCH.md's Environment Availability section.

## Next Phase Readiness
- `const.ts` and `tests/const.test.ts` are ready as read-only context for plans 03-02 and 03-03 in this phase (no further changes to these files expected)
- `bun test` (full suite): 47 pass, 0 fail across 5 files
- `bun run lint` (`tsc --noEmit`): clean
- No blockers for the remaining phase-3 plans (config migration default fix, catchError/deep-link/reconnect-hint work, and messages.test.ts)

---
*Phase: 03-review-and-add-nip-04-dm-support-per-applesauce-docs*
*Completed: 2026-07-09*
