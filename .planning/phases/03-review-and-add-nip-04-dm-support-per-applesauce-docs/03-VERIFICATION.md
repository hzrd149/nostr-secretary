---
phase: 03-review-and-add-nip-04-dm-support-per-applesauce-docs
verified: 2026-07-10T04:25:00Z
status: human_needed
score: 10/10 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps_resolved:
  - truth: "D3-10: The NIP-17 gift-wrap block is left untouched beyond leaving it working — must not touch its catchError"
    resolution: "Closed inline during the autonomous run. The WR-02 code-review fix (commit 597487e) had symmetrically applied the same safe error-extraction guard to BOTH the NIP-04 (in-scope) and NIP-17 gift-wrap (out-of-scope) catchError blocks. Reverted ONLY the NIP-17 line back to its exact pre-Phase-3 form (`Reflect.get(error, \"message\") || \"Unknown error\"`) so Phase 3's diff no longer touches the NIP-17 block. Verified via `git diff 97e8781..HEAD -- notifications/messages.ts` (NIP-17 gift-wrap block shows no Phase-3 change); the NIP-04 in-scope guard is retained; bun test 68/0, lint clean. The pre-existing NIP-17 error-guard fragility is correctly deferred to Phase 4 (NIP-17 support)."
    resolved_at: "2026-07-10"
    resolution_commit: "restore NIP-17 catchError to pre-phase form for D3-10 scope compliance"
human_verification:
  - test: "Connect a fresh NIP-46 bunker session and send yourself (or have another account send) a legacy kind-4 NIP-04 DM; confirm a notification fires with decrypted content when messages.sendContent is on"
    expected: "The bunker honors the newly-requested nip04_decrypt permission at connect time; the DM decrypts and a notification is delivered with the correct generic title, gated body, and a working click deep-link"
    why_human: "Requires a live NIP-46 remote signer/bunker session — cannot be exercised in this automated environment (per 03-VALIDATION.md Manual-Only)"
  - test: "Using a pre-existing (already-connected) signer session that lacks the nip04_decrypt permission, trigger a NIP-04 DM decrypt attempt and confirm the non-blocking reconnect hint appears on /notifications, then clears after reconnecting with the new permission"
    expected: "nip04DecryptDegraded$ flips true on the failed decrypt, DmDecryptHint renders the reconnect-to-/signer hint, and the hint disappears once a subsequent decrypt succeeds"
    why_human: "Requires a live signer session in a permission-denied state and a real decrypt failure/recovery cycle — cannot be exercised without a real bunker in this automated environment (per 03-VALIDATION.md Manual-Only)"
---

# Phase 3: Review and add NIP-04 DM support per applesauce docs — Verification Report

**Phase Goal:** Review current DM handling and add proper NIP-04 DM support, following applesauce's documented patterns for NIP-04 encrypted direct messages (decryption + subscription). This is a review/harden phase; DM *sending* is explicitly out of scope (receive-only notification secretary, per decision D3-03).
**Verified:** 2026-07-10T04:25:00Z
**Status:** human_needed (all 10 code must-haves verified; the one D3-10 gap was resolved inline — see Gaps Summary; 2 live-signer UAT items remain, deferred)
**Re-verification:** Gap resolved inline during the autonomous run (NIP-17 catchError reverted to pre-phase form)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | D3-02: `SIGNER_PERMISSIONS` includes `nip04_decrypt` (via `Permission.Nip04Decrypt`) | ✓ VERIFIED | `const.ts:29` — `Permission.Nip04Decrypt` appended to the array; `tests/const.test.ts:25-27` asserts presence |
| 2 | D3-02: existing permissions (get_public_key, sign_event:22242, sign_event:30078, nip44_encrypt, nip44_decrypt) preserved, additive only | ✓ VERIFIED | `const.ts:25-30` — all prior entries intact; `tests/const.test.ts` cases 1-5 (all pre-existing, unmodified) still pass |
| 3 | D3-03: no `nip04_encrypt` permission requested, no DM send path exists anywhere in the app | ✓ VERIFIED | `grep -n "nip04_encrypt" const.ts` → no match; `tests/const.test.ts:29-31` asserts absence; repo-wide grep for `nip04.encrypt`/`sendDirectMessage`/`sendDM`/`composeMessage` outside tests → no matches |
| 4 | D3-04: `migrateConfig()` in `services/config.ts` forces `messages.sendContent: false` unconditionally on migration | ✓ VERIFIED | `services/config.ts:129` — `sendContent: false` hardcoded with a D3-04 comment, decoupled from `parsed.directMessageNotifications` (which still drives `messages.enabled`); `tests/services/config.test.ts:50-62` — regression tests for both legacy `true`/`false` inputs |
| 5 | D3-06: NIP-04 DM notifications set a click deep-link via `buildOpenLink(event)` | ✓ VERIFIED | `notifications/messages.ts:190` — `click: buildOpenLink(event)`; raw event threaded through `decryptLegacyDirectMessage`'s return value and the `.subscribe()` destructure (`:169`) |
| 6 | D3-07: a `nip04DecryptDegraded$` signal + non-blocking `DmDecryptHint()` on `/notifications` | ✓ VERIFIED | `notifications/messages.ts:111` — exported `BehaviorSubject<boolean>`, set `true` in `catchError` (`:160`) and `false` on successful unlock (`:145`); `pages/notifications.tsx:384-398` — `DmDecryptHint()` reads it via `firstValueFrom(...).catch(() => false)`, mounted at `:409` beside `SyncStatusHint` |
| 7 | D3-08: the NIP-04 mergeMap body is wrapped in `catchError` (per-message isolation) and the dead import was removed | ✓ VERIFIED | `notifications/messages.ts:127-163` — whole async body (`decryptLegacyDirectMessage`) wrapped in `from(...).pipe(map(...), catchError(...))`, returns `EMPTY` on failure; `getLegacyMessageCorraspondant` no longer imported or referenced anywhere (`grep` confirms), `getLegacyMessageReceiver` remains in use |
| 8 | D3-09: tests exist and pass (`bun test`), including const permission test, migration regression, and network-safe legacy-messages unit tests | ✓ VERIFIED | `bun test` → 68 pass / 0 fail across 7 files; includes `tests/const.test.ts` (7 tests), `tests/services/config.test.ts` migration describe block (4 tests), `tests/notifications/messages.test.ts` (8 tests, no self-subscribing import), `tests/notifications/legacy-messages.test.ts` (7 tests, WR-04/WR-01 coverage) |
| 9 | D3-10a: no contacts/others DM split, no cross-cutting `shouldNotify` dedup refactor | ✓ VERIFIED | `diff` of pre-phase vs. current `notifications/messages.ts` shows `shouldNotify` (`:46-74`) byte-for-byte unchanged; no new split logic introduced |
| 10 | D3-10b: the NIP-17 gift-wrap path is left untouched beyond "leaving it working" (no touching its `catchError`) | ✓ VERIFIED (after inline gap fix) | Commit `597487e` had changed the NIP-17 `catchError`'s error-message line alongside the NIP-04 block; this was reverted inline during the autonomous run so the NIP-17 gift-wrap block matches its exact pre-Phase-3 form. `git diff 97e8781..HEAD -- notifications/messages.ts` now shows no Phase-3 change to the NIP-17 block. |

**Score:** 10/10 truths verified (0 present, behavior-unverified) — the D3-10 gap (truth 10) was resolved inline; see Gaps Summary.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `const.ts` | `SIGNER_PERMISSIONS` extended with `Permission.Nip04Decrypt`, JSDoc updated | ✓ VERIFIED | Imported from `applesauce-signers/helpers`; JSDoc at `:15-24` documents the new grant and receive-only boundary |
| `tests/const.test.ts` | two new cases: nip04_decrypt present, nip04_encrypt absent | ✓ VERIFIED | `:25-31` |
| `services/config.ts` | `migrateConfig(parsed)` exported pure function, sendContent forced false, groups.modes backfill preserved (+ hardened) | ✓ VERIFIED | `:124-151`; load path calls it at `:155` |
| `tests/services/config.test.ts` | new describe block on `migrateConfig` (sendContent x2 + groups.modes parity, plus WR-03 null-groups cases) | ✓ VERIFIED | 6 cases total in the `migrateConfig` describe block |
| `notifications/messages.ts` | NIP-04 block wrapped in `catchError`, `nip04DecryptDegraded$` exported, event threaded + `click:buildOpenLink(event)`, dead import removed | ✓ VERIFIED | See truths 5-7 above. Extraction to `notifications/legacy-messages.ts` (`decryptLegacyDirectMessage`, `getMessageDisplayName`) was done during code-review remediation (WR-01/WR-04) — an in-scope hardening of the same NIP-04 block, not a new artifact declared in PLAN frontmatter but consistent with the phase's own review-fix cycle (03-REVIEW.md / 03-REVIEW-FIX.md) |
| `pages/notifications.tsx` | new `DmDecryptHint()` mounted beside `SyncStatusHint`, reusing `.sync-hint` CSS | ✓ VERIFIED | `:384-398`, mounted `:409`; no new CSS added |
| `tests/notifications/messages.test.ts` | NIP-04 round-trip + garbage-ciphertext rejection + shouldNotify gate-order mirror, no self-subscribing import | ✓ VERIFIED | Confirmed no import of `notifications/messages.ts` or barrel; imports `unlockLegacyMessage`/`PrivateKeySigner` directly |
| `tests/notifications/legacy-messages.test.ts` (review-fix addition) | Unit coverage for `decryptLegacyDirectMessage` / `getMessageDisplayName` | ✓ VERIFIED | 7 tests, network-safe, no singleton imports |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `services/signer.ts` (QR + bunker-URI connect) | `const.ts` `SIGNER_PERMISSIONS` | referenced by import, no call-site edit needed | ✓ WIRED | Confirmed both connect sites read the array by reference (unchanged, per 03-01-SUMMARY.md and spot-check) |
| `pages/notifications.tsx` `DmDecryptHint` | `notifications/messages.ts` `nip04DecryptDegraded$` | `firstValueFrom(messagesNotification.nip04DecryptDegraded$).catch(() => false)` | ✓ WIRED | `pages/notifications.tsx:385-387` |
| `notifications/messages.ts` NIP-04 mergeMap | `helpers/link.ts` `buildOpenLink` | `click: buildOpenLink(event)` | ✓ WIRED | `notifications/messages.ts:24` import, `:190` usage |
| `services/config.ts` load path | `migrateConfig(parsed)` | called before `config$.next` | ✓ WIRED | `:154-160` |
| `notifications/messages.ts` NIP-04 mergeMap | `notifications/legacy-messages.ts` `decryptLegacyDirectMessage` | direct call inside `from(...)` | ✓ WIRED | `:127-137` |

### Behavioral Spot-Checks / Test Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite green | `bun test` | 68 pass / 0 fail across 7 files | ✓ PASS |
| Scoped D3 test files green | `bun test tests/services/config.test.ts tests/const.test.ts tests/notifications/messages.test.ts tests/notifications/legacy-messages.test.ts` | 31 pass / 0 fail | ✓ PASS |
| Typecheck clean | `bun run lint` (`tsc --noEmit`) | no output (clean) | ✓ PASS |
| No DM send surface exists | `grep -rn "nip04.encrypt\|sendDirectMessage\|sendDM\|composeMessage"` (excl. tests/node_modules) | no matches | ✓ PASS |
| Dead import fully removed | `grep -rn "getLegacyMessageCorraspondant"` (repo-wide) | no matches | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| D3-01 | 03-03 | Review & harden, not rebuild | ✓ SATISFIED | `unlockLegacyMessage` call site unchanged in intent; only error handling/signal/deep-link added |
| D3-02 | 03-01 | Add nip04_decrypt permission | ✓ SATISFIED | See truth 1 |
| D3-03 | 03-01 | Receive-only, no DM sending | ✓ SATISFIED | See truth 3 |
| D3-04 | 03-02 | Privacy-safe sendContent migration default | ✓ SATISFIED | See truth 4 |
| D3-05 | 03-03 | Generic title, gated body | ✓ SATISFIED | `git diff` confirms title/body logic unchanged; still gated on `messages.sendContent` |
| D3-06 | 03-03 | Deep-link on DM notifications | ✓ SATISFIED | See truth 5 |
| D3-07 | 03-03 | Non-blocking reconnect hint | ✓ SATISFIED (code); manual UAT pending for live-signer trigger | See truth 6; human_verification item 2 |
| D3-08 | 03-03 | catchError parity + dead import removal | ✓ SATISFIED | See truth 7 |
| D3-09 | 03-01/02/03 | Tests | ✓ SATISFIED | See truth 8 |
| D3-10 | 03-01/02/03 | Tight boundary (no NIP-17 changes beyond working, no contacts/others split, no shouldNotify refactor) | ✓ SATISFIED (after inline gap fix) | Truth 9 verified; truth 10 (NIP-17 catchError untouched) initially FAILED then resolved inline — NIP-17 line reverted to pre-phase form; see Gaps Summary |

No orphaned requirements found — all D3-01 through D3-10 IDs are claimed by at least one plan's `requirements:` frontmatter field and cross-referenced above.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `tests/notifications/messages.test.ts` | 22 | `TODO(WR-04, tracked follow-up, ...)` | ℹ️ Info | Not a blocker (TODO, not TBD/FIXME/XXX) — references a formal tracked follow-up ID (WR-04) consistent with the project's existing `groups.test.ts` convention; documents a known, accepted test-coverage gap (the gate-order mirror doesn't cover real wiring), not a functional defect |

No TBD/FIXME/XXX markers, no placeholder/stub returns, no hardcoded-empty data flows, and no console.log-only implementations found in any of the 9 files touched by this phase.

### Gaps Summary

**RESOLVED (inline, during the autonomous run).** One gap was found and closed before phase completion — a boundary/process violation rather than a missing feature. Resolution: the NIP-17 `catchError` error-extraction line was reverted to its exact pre-Phase-3 form so Phase 3's diff is strictly NIP-04-scoped; `git diff 97e8781..HEAD -- notifications/messages.ts` confirms the NIP-17 gift-wrap block has no Phase-3 change, the NIP-04 in-scope guard is retained, and `bun test` (68/0) + `bun run lint` remain green. The pre-existing NIP-17 error-guard fragility is deferred to Phase 4 (NIP-17 support). Original finding, for the record:

**D3-10 boundary violation — NIP-17 `catchError` line touched.** During the phase's code-review remediation cycle (commit `597487e`, "WR-02 guard catchError message extraction against non-object rejections"), the same one-line fix (`Reflect.get(error, "message") || "Unknown error"` → `error instanceof Error ? error.message : String(error)`) was applied to *both* the NIP-04 catchError block (in scope) *and* the NIP-17 gift-wrap catchError block (explicitly out of scope per D3-10 and 03-03-PLAN.md's own prohibitions list, which states three separate times not to touch the NIP-17 block's catchError). The change itself is safe and symmetrical — for a real `Error` rejection both old and new code produce the identical message string; the new code is additionally safer for a non-`Error` rejection (the old `Reflect.get` would throw a `TypeError` on a primitive rejection reason, e.g. a rejected promise with a string reason) — so this does not regress NIP-17 functionality and no test failure resulted. However, it is a literal violation of an explicit, repeatedly-stated phase boundary, and the phase goal statement itself commits to leaving NIP-17 for Phase 4.

**This looks intentional (symmetrical defensive fix), but violates an explicit boundary.** To accept this deviation, add to VERIFICATION.md frontmatter:

```yaml
overrides:
  - must_have: "D3-10: NIP-17 gift-wrap block left untouched beyond leaving it working — do not touch its catchError"
    reason: "WR-02 applied the same safe, non-behavior-changing error-extraction guard symmetrically to both catchError blocks during code-review remediation; for real Error rejections output is identical, and it additionally prevents a TypeError on non-Error rejections in the NIP-17 path. No functional regression to NIP-17."
    accepted_by: "{name}"
    accepted_at: "{ISO timestamp}"
```

Alternatively, revert just the one line in the NIP-17 `catchError` block (`notifications/messages.ts` around the gift-wrap listener) to restore strict D3-10 compliance before shipping.

### Human Verification Required

Two items require a live NIP-46 signer/bunker session and are documented as Manual-Only in `03-VALIDATION.md`; both are genuinely un-automatable in this environment, and the code paths supporting them are implemented and unit-tested up to the boundary of what requires a live signer:

1. **Fresh bunker connect + real kind-4 DM decrypt**
   **Test:** Connect a fresh NIP-46 bunker session and send yourself a legacy kind-4 NIP-04 DM; confirm a notification fires with decrypted content when `messages.sendContent` is on.
   **Expected:** The bunker honors the newly-requested `nip04_decrypt` permission at connect time; the DM decrypts and a notification is delivered with the correct title/body gating and click deep-link.
   **Why human:** Requires a live remote-signer/bunker round trip; no bunker is available in this automated environment.

2. **Reconnect hint appears/clears for an already-connected signer**
   **Test:** Using a pre-existing signer session lacking `nip04_decrypt`, trigger a NIP-04 DM decrypt attempt; confirm the non-blocking reconnect hint appears on `/notifications`, then clears after reconnecting with the new permission.
   **Expected:** `nip04DecryptDegraded$` flips true on failure, the hint renders, and it clears on the next successful decrypt.
   **Why human:** Requires a live signer session in a permission-denied state and an observable degrade/recover cycle; cannot be exercised without a real bunker.

---

_Verified: 2026-07-10T04:25:00Z_
_Verifier: Claude (gsd-verifier)_
