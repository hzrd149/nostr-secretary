---
phase: 04-add-nip-17-dm-notifications-support-per-applesauce-docs
verified: 2026-07-10T17:31:40Z
status: human_needed
score: 9/9 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Connect a live NIP-46 signer and have a real NIP-17 gift-wrapped DM sent to the user's account over real relays"
    expected: "Exactly one notification fires for the new DM (with click deep-link opening the message). Restart the app/service; the same historical wrap must NOT re-notify. A subsequent new DM after restart IS notified."
    why_human: "Requires a live NIP-46 bunker session, real relay connectivity, and real gift-wrap delivery over the network — not reproducible in an automated test run. Documented as Manual-Only in 04-VALIDATION.md; the dedup/self-healing/unwrap logic itself is already unit-tested network-free (tests/helpers/gift-wrap-subscription.test.ts, tests/notifications/gift-wrap-messages.test.ts)."
---

# Phase 4: Add NIP-17 DM notifications support per applesauce docs Verification Report

**Phase Goal:** Add/harden NIP-17 (gift-wrapped) DM notifications per applesauce docs — subscribe to gift wraps, decrypt via unlockGiftWrap, and fire notifications on genuinely-new DMs. Review/harden phase; centerpiece is replacing the fragile `giftWraps$` `limit:1`/`skip(1)` with a seed(pool.request)-then-live(pool.subscription) dedup so new DMs aren't dropped and historical wraps aren't re-notified.

**Verified:** 2026-07-10T17:31:40Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (mapped to D4-01..D4-09 decisions in 04-CONTEXT.md)

| # | Truth (Decision) | Status | Evidence |
|---|---|---|---|
| 1 | D4-02: `giftWraps$` no longer uses `limit:1`/`skip(1)`; a historical wrap at startup is not re-notified, a new one after startup is, and the pipeline self-heals from a transient seed failure without permanent blackout | ✓ VERIFIED | `services/nostr.ts:215-275` composes `seededGiftWraps(seedRequest$, live$, {...})` from `helpers/gift-wrap-subscription.ts`; no `skip(1)`/`limit:1` anywhere in the file (`grep -c "skip(1)" services/nostr.ts` = 0). `seededGiftWraps` retries the seed forever with capped exponential backoff (`retry({ delay: ... })`, no `catchError` give-up path) and gates all `live$` emissions on a `seeded` latch that flips `false→true` only on a genuine seed success — this was the subject of code review iteration 2 (CR-01, commit `d677930`) which specifically fixed an iteration-1 "permanently fail-closed after retries exhausted" bug. Behaviorally proven (not just present) by `tests/helpers/gift-wrap-subscription.test.ts`: 6 test cases including "a historical wrap present during seeding is NOT emitted, even if the relay resends it live", "an empty seed still notifies for the first live event" (the exact zero-historical-events edge case that broke the old hack), "the same live id is never emitted twice", and the self-healing case "after repeated seed failures, a later success does NOT mass-notify the backlog AND live notifications resume". |
| 2 | D4-01: NIP-17 block uses the extracted pure `unlockPrivateDirectMessage` (not inline `unlockGiftWrap` + kind filter) | ✓ VERIFIED | `notifications/messages.ts:207` calls `from(unlockPrivateDirectMessage(event, signer))`; `notifications/gift-wrap-messages.ts` exports it, awaiting applesauce's `unlockGiftWrap` and returning the rumor only when `kind === kinds.PrivateDirectMessage`. Real round-trip test (`tests/notifications/gift-wrap-messages.test.ts`) uses `GiftWrapFactory.create` + `PrivateKeySigner` (no relays) and asserts the returned rumor's `pubkey` is the real sender (distinct from the gift wrap's anonymized pubkey) with content intact, plus the non-DM-kind-returns-undefined case. |
| 3 | D4-04: NIP-17 DM notifications set a click deep-link via `buildOpenLink` | ✓ VERIFIED | `notifications/messages.ts:257`: `click: buildOpenLink(rumor as unknown as NostrEvent)`. Verified `buildOpenLink` → `getEventPointerForEvent` (applesauce-core) only reads `.id`/`.kind`/`.pubkey` (never `.sig`), confirming the `Rumor`→`NostrEvent` cast is safe at runtime as the plan claimed. |
| 4 | D4-05 (prohibition): NO reconnect/degraded hint driven by gift-wrap decrypt failures | ✓ VERIFIED | `grep -rn "iftWrap.*Degraded\|GiftWrapDecryptDegraded"` across `notifications/*.ts`, `services/*.ts`, `pages/*.tsx` returns no matches. Only the pre-existing NIP-04 `nip04DecryptDegraded$` exists (`notifications/messages.ts:111`), untouched by this phase's diff. The NIP-17 `catchError` explicitly comments "D4-05: deliberately NO reconnect-hint signal here". |
| 5 | D4-06: safe `instanceof Error` error-guard on the NIP-17 `catchError` | ✓ VERIFIED | `notifications/messages.ts:212`: `error: error instanceof Error ? error.message : String(error)`, replacing the prior unsafe `Reflect.get(error, "message")` read (confirmed via `git diff`). |
| 6 | D4-07: `sendContent` gate not regressed (no plaintext to ntfy when off) | ✓ VERIFIED | `notifications/messages.ts:251-252`: title stays `${displayName} sent you a message` (generic, no content); body is `messages.sendContent ? content : "[content omitted]"` — identical shape to the pre-phase code and to the NIP-04 block; `git diff` confirms this line's logic was not touched, only surrounding lines (profile guard, click link). |
| 7 | D4-03: no signer permission change | ✓ VERIFIED | `const.ts` `SIGNER_PERMISSIONS` last modified in commit `c1cadce` (Phase 3, `nip04_decrypt`) and `6f3fea0` (Phase 2, `nip44_decrypt`) — no Phase 4 commit touches `const.ts` (`git diff 71f016b~1 HEAD -- const.ts` is empty). |
| 8 | D4-08 (prohibition): NIP-04 legacy path untouched, no contacts/others split, no rate limiting, no `shouldNotify` refactor | ✓ VERIFIED | `git diff 71f016b~1 HEAD --stat` (excluding `.planning/`) touches only: `helpers/gift-wrap-subscription.ts` (new), `notifications/gift-wrap-messages.ts` (new), `notifications/messages.ts`, `services/nostr.ts`, plus their new test files. `git diff -- notifications/messages.ts` confirms only the NIP-17 block changed — the NIP-04 block (lines 104-192, including `shouldNotify`, `enabled$`, `nip04DecryptDegraded$`) is byte-identical before/after. No contacts/others split or rate-limiting code exists anywhere in the diff. |
| 9 | D4-09: network-safe tests covering the dedup/self-healing logic and unwrap, with no import of `services/nostr.ts` or the notifications barrel | ✓ VERIFIED | `grep -rn "services/nostr\|notifications/index\|notifications/messages" tests/helpers/gift-wrap-subscription.test.ts tests/notifications/gift-wrap-messages.test.ts notifications/gift-wrap-messages.ts helpers/gift-wrap-subscription.ts` → no matches (exit 1) in all four files. Both test files import only `notifyNewGiftWraps`/`seededGiftWraps` or `unlockPrivateDirectMessage` directly, plus rxjs/nostr-tools/applesauce-signers/applesauce-common/factories fixtures. |

**Score:** 9/9 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `helpers/gift-wrap-subscription.ts` | `notifyNewGiftWraps`/`seededGiftWraps` pure combinators, no singleton imports | ✓ VERIFIED | Exports both functions; imports only `nostr-tools` types + `rxjs` operators (`concat`, `filter`, `ignoreElements`, `retry`, `tap`, `timer`, `Observable`). Hardened beyond the original plan by code-review iteration 2 (self-healing retry, bounded `seen` set — `DEFAULT_MAX_SEEN = 5_000`, FIFO eviction). |
| `notifications/gift-wrap-messages.ts` | `unlockPrivateDirectMessage(event, signer, deps?)` pure unit | ✓ VERIFIED | 25 lines, awaits `unlockGiftWrap`, classifies kind 14, no singleton imports. |
| `services/nostr.ts` (`giftWraps$`) | seed+live composition via the new combinator | ✓ VERIFIED | Lines 215-275; imports `seededGiftWraps` from `../helpers/gift-wrap-subscription`; `catchError` no longer imported/used at this level (replaced by `retry`-based self-healing) — confirmed intentional per 04-REVIEW-FIX.md CR-01. |
| `notifications/messages.ts` (NIP-17 block) | rewired to extracted unit + deep-link + safe error-guard + no reconnect hint | ✓ VERIFIED | Lines 194-259; matches all D4 decisions (see truths table). |
| `tests/helpers/gift-wrap-subscription.test.ts` | dedup + self-healing test coverage | ✓ VERIFIED | 6 test cases (4 original dedup-contract + 1 WR-01 bounded-`seen` + rewritten `seededGiftWraps` self-healing describe block with 2 cases), all green. |
| `tests/notifications/gift-wrap-messages.test.ts` | real unwrap round-trip test | ✓ VERIFIED | 2 test cases (real GiftWrapFactory round trip, non-DM-kind-undefined), all green. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `services/nostr.ts` `giftWraps$` | `helpers/gift-wrap-subscription.ts` | `seededGiftWraps(seedRequest$, live$, {...})` | WIRED | Confirmed by direct read; `pool.request(...)` (seed) and `pool.subscription(...)` (live) both present, `giftWrapFilter` named to avoid shadowing rxjs `filter` (Pitfall 3, confirmed not shadowed). |
| `notifications/messages.ts` NIP-17 block | `notifications/gift-wrap-messages.ts` | `from(unlockPrivateDirectMessage(event, signer))` + `defined()` | WIRED | Confirmed; `defined()` placed after `mergeMap` drops non-DM rumors. |
| `notifications/messages.ts` NIP-17 block | `helpers/link.ts` | `buildOpenLink(rumor as unknown as NostrEvent)` | WIRED | Confirmed; `buildOpenLink`/`getEventPointerForEvent` verified to read only `.id`/`.kind`/`.pubkey`, never `.sig` — the cast is runtime-safe. |
| `services/nostr.ts` `giftWraps$` | `notifications/messages.ts` | import of `giftWraps$` | WIRED | Unchanged export name/type (`Observable<NostrEvent>`); consumed unchanged by `notifications/messages.ts:36`. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full test suite green | `bun test` | 77 pass, 0 fail, 135 expect() calls, 9 files, 304ms | ✓ PASS |
| Type-check clean | `bun run lint` (`tsc --noEmit`) | no output, exit 0 | ✓ PASS |
| Dedup/self-healing test file specifically | `bun test tests/helpers/gift-wrap-subscription.test.ts` | included in full suite (all pass) | ✓ PASS |
| Unwrap round-trip test file specifically | `bun test tests/notifications/gift-wrap-messages.test.ts` | included in full suite (all pass) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| D4-01 | 04-01, 04-02 | Review & harden (not rebuild); use extracted `unlockPrivateDirectMessage` | ✓ SATISFIED | Truth #2 |
| D4-02 | 04-01, 04-02 | Fix `skip(1)`/`limit:1` fragility with seed-then-live dedup | ✓ SATISFIED | Truth #1 |
| D4-03 | 04-02 | No signer permission change | ✓ SATISFIED | Truth #7 |
| D4-04 | 04-02 | Add click deep-link via `buildOpenLink` | ✓ SATISFIED | Truth #3 |
| D4-05 | 04-02 | No reconnect/degraded hint for NIP-17 | ✓ SATISFIED | Truth #4 |
| D4-06 | 04-02 | Safe `instanceof Error` error-guard | ✓ SATISFIED | Truth #5 |
| D4-07 | 04-02 | Generic title, gated body (sendContent) | ✓ SATISFIED | Truth #6 |
| D4-08 | 04-02 | Tight NIP-17-only boundary | ✓ SATISFIED | Truth #8 |
| D4-09 | 04-01 | Network-safe tests, extracted pure units | ✓ SATISFIED | Truth #9 |

No orphaned requirements — ROADMAP.md lists exactly D4-01 through D4-09 for Phase 4, and both plans together claim all nine.

### Anti-Patterns Found

None. `grep -n -E "TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER"` across all phase-modified files (`helpers/gift-wrap-subscription.ts`, `notifications/gift-wrap-messages.ts`, `notifications/messages.ts`, `services/nostr.ts`, and both new test files) returns no matches.

### Human Verification Required

#### 1. Live end-to-end gift-wrapped DM notification (dedup + no re-notify on restart)

**Test:** Connect a live NIP-46 bunker signer to the app. Have another Nostr client send a NIP-17 gift-wrapped DM to the user's account over real DM-inbox relays. Confirm a single notification fires with a working click-through deep-link. Restart the notification service/app. Confirm the same (now-historical) gift wrap does NOT re-trigger a notification. Send a second, genuinely new DM after the restart and confirm it DOES notify.

**Expected:** Exactly one notification per genuinely-new DM; no duplicate/re-notification of a wrap already seen at a prior startup; the click action opens the message in the configured client.

**Why human:** This exercises the full seed(pool.request)+live(pool.subscription) composition against real relay behavior (actual EOSE timing, actual backlog resend semantics, actual NIP-46 signer round-trip latency) — none of which can be faithfully simulated without a live signer and real relay connectivity. This is explicitly scoped as Manual-Only in `04-VALIDATION.md`. The underlying dedup/self-healing/unwrap decision logic is already proven correct by deterministic, network-free unit tests (`tests/helpers/gift-wrap-subscription.test.ts`, `tests/notifications/gift-wrap-messages.test.ts`), so this item verifies real-world integration behavior, not the correctness of the algorithm itself.

### Gaps Summary

No gaps. All 9 D4 decisions (D4-01 through D4-09) are verified against the actual codebase, not just SUMMARY.md claims:

- The centerpiece fix (D4-02) was found to be *more* hardened than the original plan specified: code review (04-REVIEW.md, 04-REVIEW-FIX.md) caught and fixed a real bug in iteration 1 (a bounded-retry design that could permanently blacklist notifications after transient relay failures) and replaced it with an unbounded-retry, capped-exponential-backoff, self-healing design (`seededGiftWraps`), verified line-by-line against RxJS's own `retry()` operator source in the final review pass. This exceeds rather than falls short of the D4-02 requirement.
- `bun test` (77/77 pass) and `bun run lint` (`tsc --noEmit` clean) both independently re-confirmed in this verification pass, not merely trusted from SUMMARY.md.
- The only unresolved item is the live-signer/live-relay end-to-end manual check, which was correctly scoped out of automated verification from the start (04-VALIDATION.md Manual-Only) and does not indicate a code defect — it indicates untested integration surface that requires human/live infrastructure.

---

_Verified: 2026-07-10T17:31:40Z_
_Verifier: Claude (gsd-verifier)_
