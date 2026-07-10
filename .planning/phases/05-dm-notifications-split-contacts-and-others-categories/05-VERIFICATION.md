---
phase: 05-dm-notifications-split-contacts-and-others-categories
verified: 2026-07-10T19:16:55Z
status: human_needed
score: 6/8 must-haves verified
behavior_unverified: 2
overrides_applied: 0
behavior_unverified_items:
  - truth: "contacts$/isContact reactively re-classify a sender when the user's kind-3 follow list changes (D5-03), and isContact's 2s-timeout->false fallback actually degrades to 'others' when the follow list cannot load in time (D5-02)"
    test: "Follow a pubkey, receive a DM from it (classified as others before, contacts after); unfollow and confirm the next DM reclassifies to others. Separately, simulate/observe a slow-loading relay to confirm the 2s timeout path resolves to others rather than hanging or throwing."
    expected: "Classification updates on the very next DM after a follow-list change (no boot-time snapshot); an unresolved follow list resolves to 'others' within ~2s."
    why_human: "contacts$ is a live RxJS observable over a real kind-3 event stream and isContact's timeout branch only fires against a genuinely slow/unavailable relay -- both require a live signer + real relay traffic to exercise; the codebase's own established precedent (groups$/mutedPubkeys$) is that these reactive observables are not directly unit-tested, only code-reviewed for shape."
  - truth: "/messages renders two labeled sections (Contacts/Others) and saving+reloading both toggles round-trips correctly through the running web UI (D5-08)"
    test: "Open /messages in a browser, toggle Contacts and Others independently, click Save, reload the page, and confirm both checkboxes reflect the saved state."
    expected: "Each checkbox persists its own value across a save+reload cycle, independent of the other."
    why_human: "Requires a running web server + browser interaction (Datastar signal binding, PATCH round-trip, page re-render) -- not exercised by any unit test; the code (grep-verified two sections, flat signals, PATCH handler) is present and wired, but the interactive round-trip itself is unproven by automated tests."
human_verification:
  - test: "Connect a real signer with a populated kind-3 follow list. Receive a DM from a followed pubkey (NIP-04 and NIP-17) and confirm it notifies when contacts.enabled=true. Receive a DM from a non-followed pubkey (both transports) and confirm it is suppressed when others.enabled=false, and notifies when others.enabled=true."
    expected: "Followed-sender DMs are gated by contacts.enabled; non-followed-sender DMs are gated by others.enabled; both NIP-04 and NIP-17 apply the identical gate using the DM's real sender pubkey (rumor.pubkey for NIP-17, not the gift wrap's one-time pubkey)."
    why_human: "Requires a live signer, a real kind-3 follow list, and real incoming DMs of both transport types -- the classification+gate ORDERING is proven by a real-function unit test (evaluateDmNotificationGates), but the live end-to-end classification against a genuine follow list and live relays is Manual-Only per 05-VALIDATION.md."
  - test: "Follow a pubkey the user was not previously following, then receive a DM from it; confirm it now classifies as 'contacts' on the next message (not just at next app boot)."
    expected: "contacts$ re-emits and isContact reflects the new follow immediately/reactively (D5-03) -- no boot-time snapshot."
    why_human: "Requires a live signer + real follow-list mutation + a real incoming DM to observe the reactive update; not unit-tested (see behavior_unverified_items above)."
  - test: "On /messages, toggle Contacts and Others independently, save, reload, confirm both persist (D5-08)."
    expected: "Both category toggles round-trip through the PATCH handler and survive a page reload, independently of each other."
    why_human: "Requires a running web UI and browser interaction; see behavior_unverified_items above."
  - test: "With two devices synced via the kind-30078 encrypted prefs event, change a category flag on device A and confirm device B receives and applies the update (D5-10), including the scenario where device B is still on a pre-Phase-5 build (old-schema payload) and does not silently disable both categories on the upgraded device."
    expected: "The sync round-trip (already proven by unit tests for the pure serialize/sanitize/merge functions) also works end-to-end over real relays with a real second device/build."
    why_human: "Requires two live devices/signers and a real relay round-trip; the pure-function logic (including the old-schema fallback, T-5-04) is unit-tested, but the live multi-device sync itself is Manual-Only per 05-VALIDATION.md."
---

# Phase 5: DM notifications split into contacts and others categories — Verification Report

**Phase Goal:** Split DM notifications into two default categories — "contacts" (DMs from users the recipient follows) and "others" (DMs from users not in the recipient's contact list) — each with its own default notification setting, giving granular control over who can ping the user. Applies to BOTH NIP-04 and NIP-17 DMs.
**Verified:** 2026-07-10T19:16:55Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (D5 decision) | Status | Evidence |
|---|---|---|---|
| 1 | D5-01/D5-02/D5-03: A followed sender classifies as contacts, a non-followed/unavailable-follow-list sender classifies as others, reactive to follow/unfollow | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `contacts$`/`isContact` (services/nostr.ts:344-365) built as `user$.pipe(switchMap(user => eventStore.contacts(user)), shareAndHold())` with NO signer dependency (confirmed: no `combineLatest([user$, signer$])`, mirrors `groups$` not `mutedPubkeys$`); `isContact` mirrors `isMuted`'s exact `firstValueFrom(...timeout({first:2000, with:()=>of([])}))` idiom. `classifyDmSender` (notifications/dm-category.ts) pure-unit tested for true→contacts/false→others/unavailable→others (`tests/notifications/dm-category.test.ts`, 4 tests pass). The classification LOGIC is fully verified; the LIVE reactive re-emission on real follow/unfollow and the real 2s-timeout degrade path are unexercised by any test (matches existing `groups$`/`mutedPubkeys$` precedent of not unit-testing reactive observables) — see human verification. |
| 2 | D5-04: Config splits to per-category `messages.contacts.enabled`/`messages.others.enabled`; `sendContent`/whitelists/blacklists stay SHARED | ✓ VERIFIED | `services/config.ts:28-36` — `AppConfig.messages` type has `contacts:{enabled}`, `others:{enabled}`, plus shared `sendContent`/`whitelists`/`blacklists`; no derived/back-compat flat `enabled` field. `notifications/messages.ts:81` — `enabled$` is `c.messages.contacts.enabled || c.messages.others.enabled`. |
| 3 | D5-05: New-install default `contacts.enabled=true`, `others.enabled=FALSE` | ✓ VERIFIED | `services/config.ts:71-77` — `DEFAULT_MESSAGES_CONFIG = { contacts:{enabled:true}, others:{enabled:false}, ... }`, seeded into `config$`'s initial value (line 85). Test: `tests/services/config.test.ts:205-210` asserts `contacts.enabled===true`/`others.enabled===false` explicitly, noting "corrected — NOT both ON". |
| 4 | D5-06: `migrateConfig` seeds BOTH category flags from old `messages.enabled`; idempotent; malformed-config guarded | ✓ VERIFIED | `services/config.ts:162-234` — normalizes null/non-object `messages` before the split (CR-01 fix); splits `contacts`/`others` independently from a legacy `enabled` flag when present, else falls back to `DEFAULT_MESSAGES_CONFIG`'s own default per missing key; deletes `messages.enabled`. Tests: `tests/services/config.test.ts` lines 64-122 cover true→both-true, false→both-false, the `directMessageNotifications` chain, and idempotency (already-split config left untouched, `enabled` not re-added); lines 145-200+ cover the CR-01 null/partial-object crash-guard cases. |
| 5 | D5-07: Layered gate — category enabled BEFORE the byte-identical `shouldNotify` (mute+whitelist+blacklist not bypassed) | ✓ VERIFIED | `notifications/dm-notification-gate.ts` — `evaluateDmNotificationGates(category, messages, sender, shouldNotify)` checks `messages[category].enabled` first, returns `{pass:false, reason:"category-disabled"}` before ever calling `shouldNotify`; `shouldNotify` (notifications/messages.ts:49-77) is untouched/byte-identical to Phases 3-4. Directly proven by a REAL (non-mirror) behavioral test: `tests/notifications/messages.test.ts:235-253` asserts `shouldNotifyCalled === false` when the category is disabled — an actual ordering-invariant proof against production code, not just presence. Both listeners (notifications/messages.ts:200-205, :289-294) call this shared function. |
| 6 | D5-08: Two-section `/messages` UI (Contacts/Others) with flat `contactsEnabled`/`othersEnabled` Datastar signals | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `pages/messages.tsx:30-75` — two labeled sections, `data-bind="contactsEnabled"` (line 35) checked from `messagesConfig.contacts.enabled` (line 36), `data-bind="othersEnabled"` (line 59) checked from `messagesConfig.others.enabled` (line 60); shared `sendContent`+`WhitelistBlacklist` below (lines 77-115). PATCH handler (lines 145-204) reads both flat signals and writes the nested shape. Code is present and correctly wired (grep-verified); the interactive save/reload round-trip through a running browser is unexercised by any test — see human verification. |
| 7 | D5-09: Gate applied in BOTH NIP-04 and NIP-17 listeners, correct sender per path | ✓ VERIFIED | NIP-04 (notifications/messages.ts:172-216): classifies `sender` (`getLegacyMessageReceiver` result), gate before `shouldNotify`. NIP-17 (notifications/messages.ts:264-307): `const sender = rumor.pubkey` (line 268, the unwrapped rumor's real author, never the gift wrap's random pubkey), gate before `shouldNotify`. Both call the identical `evaluateDmNotificationGates`. |
| 8 | D5-10: Phase-2 kind-30078 sync carries the flags with an old-peer fallback + PREFS_VERSION bump | ✓ VERIFIED | `helpers/preferences.ts` — `PREFS_VERSION=2` (line 28); `SyncedPrefs.messages` carries `contacts.enabled`/`others.enabled` (lines 40-41); `serializePrefs` builds them field-by-field, never spreads (never leaks `sendContent`, line 70-74); `asMessagesCategories` (lines 132-150) detects an old-schema payload by absence of `contacts`/`others` keys and seeds BOTH flags from the legacy `enabled` boolean instead of coercing to false. Tests: `tests/helpers/preferences.test.ts` lines 283-318 cover new-schema coercion, old-schema `enabled:true`→both-true, old-schema `enabled:false`→both-false; `mergePrefs` round-trip (lines 184-188) preserves `sendContent` (local-only). |

**Score:** 6/8 truths fully verified (2 present + wired, behavior not exercised by an automated test — see Human Verification below).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `services/nostr.ts` | `contacts$` + `isContact(pubkey)`, no signer dependency | ✓ VERIFIED | Lines 344-365; `ProfilePointer` type imported from `applesauce-core/helpers` (deviation from plan's `nostr-tools` path, documented and correct — `nostr-tools` doesn't re-export `ProfilePointer` at root). |
| `notifications/dm-category.ts` | `DmCategory` + `classifyDmSender` pure unit | ✓ VERIFIED | Present, no singleton imports, JSDoc documents D5-01/D5-02 semantics. |
| `tests/notifications/dm-category.test.ts` | Unit coverage incl. unavailable→others | ✓ VERIFIED | 4 tests, all pass. |
| `services/config.ts` | Nested `messages.contacts`/`others`, `DEFAULT_MESSAGES_CONFIG`, migration | ✓ VERIFIED | Confirmed above; flat `enabled` field fully removed. |
| `helpers/preferences.ts` | `SyncedPrefs` reshape, `PREFS_VERSION=2`, `asMessagesCategories` | ✓ VERIFIED | Confirmed above. |
| `notifications/messages.ts` | Category gate in both listeners before `shouldNotify` | ✓ VERIFIED | Uses extracted `evaluateDmNotificationGates` (notifications/dm-notification-gate.ts) — an improvement over the plan's originally-described inline `if` check, added during code review (05-REVIEW-FIX.md WR-02) to give the ordering invariant direct test coverage. |
| `notifications/dm-notification-gate.ts` (not in original plan frontmatter, added via review fix) | Extracted, directly-testable gate-order function | ✓ VERIFIED | New file; zero runtime dependency on `services/nostr.ts` singletons (only a type-only `AppConfig` import); `shouldNotify` injected. |
| `pages/messages.tsx` | Two-section UI + flat signals | ✓ VERIFIED (wired) / ⚠️ interactive round-trip unverified | Confirmed above. |
| `tests/notifications/messages.test.ts` | Truth-table + real-function ordering test | ✓ VERIFIED | New `evaluateDmNotificationGates` describe block (4 tests) + `layered category gate mirror` describe block (5 tests); 17 tests total in file, all pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `contacts$`/`isContact` (services/nostr.ts) | `classifyDmSender` (notifications/dm-category.ts) | `classifyDmSender(await isContact(sender))` | ✓ WIRED | Called identically in both DM listeners (notifications/messages.ts:187/195, :276/284). |
| `messages.contacts.enabled`/`others.enabled` (services/config.ts) | `evaluateDmNotificationGates` (notifications/dm-notification-gate.ts) | `messages[category].enabled` lookup | ✓ WIRED | `getConfig()` destructures `messages`, passed into the gate function in both listeners. |
| Category gate | `shouldNotify` | Sequential await, gate first | ✓ WIRED | Proven by real test asserting `shouldNotify` is never called when category is disabled (tests/notifications/messages.test.ts:235-253). |
| `serializePrefs`/`sanitizeSyncedPrefs` (helpers/preferences.ts) | `AppConfig.messages` (services/config.ts) | Field-by-field mapping, `asMessagesCategories` | ✓ WIRED | Round-trip tests confirm both directions preserve `contacts`/`others` independently; `sendContent` never crosses the sync boundary. |
| `pages/messages.tsx` PATCH handler | `config$.next(...)` | Signal → nested `messages` object | ✓ WIRED | Lines 175-186; `contactsEnabled`/`othersEnabled` flat signals mapped to nested shape only inside the handler (no dotted data-bind anywhere in the file — grep confirms). |

### Requirements Coverage

No formal `.planning/REQUIREMENTS.md` exists for this milestone; per the phase's own frontmatter and CONTEXT.md, the D5-01..D5-10 decisions in 05-CONTEXT.md serve as the requirements contract.

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| D5-01 | 05-01, 05-03 | Contacts = kind-3 follow list | ✓ SATISFIED | `classifyDmSender`, `isContact`, both listeners |
| D5-02 | 05-01, 05-03 | Unavailable follow list → others | ✓ SATISFIED (logic) / ? NEEDS HUMAN (live timeout path) | `isContact`'s timeout fallback code-reviewed; not live-tested |
| D5-03 | 05-01 | Reactive re-categorization | ✓ SATISFIED (code) / ? NEEDS HUMAN (live reactivity) | `contacts$` built over live `user$`, no snapshot; not live-tested |
| D5-04 | 05-02 | Per-category enabled only, shared filters | ✓ SATISFIED | services/config.ts type shape |
| D5-05 | 05-02 | New-install default contacts=true/others=false | ✓ SATISFIED | DEFAULT_MESSAGES_CONFIG + test |
| D5-06 | 05-02 | Migration preserves existing behavior | ✓ SATISFIED | migrateConfig + regression tests |
| D5-07 | 05-03 | Layered gate, category before shouldNotify | ✓ SATISFIED | evaluateDmNotificationGates + real ordering test |
| D5-08 | 05-02 | Two-section UI | ✓ SATISFIED (code) / ? NEEDS HUMAN (interactive round-trip) | pages/messages.tsx |
| D5-09 | 05-03 | Both DM types gated, correct sender | ✓ SATISFIED | Both listeners, `sender`/`rumor.pubkey` |
| D5-10 | 05-02 | Sync compat with old-peer fallback | ✓ SATISFIED | asMessagesCategories + PREFS_VERSION=2 + tests |

No orphaned requirements found — all D5-01 through D5-10 are claimed across the three plans' `requirements` frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| tests/notifications/messages.test.ts | 34 | `TODO(WR-04, tracked follow-up, matches groups.test.ts's caveat)` | ℹ️ Info | References a tracked follow-up (WR-04) and an existing codebase-wide precedent (groups.test.ts has the identical caveat) — not a phase-introduced gap; `shouldNotify`'s own internal gate order remains mirror-tested only, unchanged from Phases 1/3/4. Not a blocker per the debt-marker gate (references formal follow-up work). |

No unreferenced TBD/FIXME/XXX markers, no stub returns, no hardcoded empty data, no console.log-only implementations found in any of the 9 files touched by this phase.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full test suite green | `bun test` | 104 pass, 0 fail, 197 expect() calls, 10 files | ✓ PASS |
| Whole-project typecheck clean | `bun run lint` | `tsc --noEmit` — no output, exit 0 | ✓ PASS |
| D5-07 ordering invariant (single named test, real production function) | `bun test tests/notifications/messages.test.ts` | 17 pass, 0 fail — includes "category-disabled short-circuits BEFORE shouldNotify is even called" asserting `shouldNotifyCalled === false` | ✓ PASS |
| All phase-relevant commits exist in history | `git log --oneline --all \| grep <hash>` | All 10 documented commits (9a837af, bb33e2f, 3373e02, 72a584b, 6200f07, 4599f25, bca2a1c, f2ce47a, 5b79074, 95a4059) found | ✓ PASS |

### Probe Execution

No probes declared for this phase (no `scripts/*/tests/probe-*.sh` files exist in the repo, none referenced in PLAN/SUMMARY). Skipped.

## Human Verification Required

Automated checks (unit tests, lint, code wiring, ordering-invariant test) all pass. The following require a live signer, real relays, real follow-list data, and/or a running browser session — deferred per 05-VALIDATION.md's explicit Manual-Only classification, not treated as failures since the underlying code paths are correctly implemented and wired.

### 1. Live categorization + gating across both DM transports

**Test:** Connect a real signer with a populated kind-3 follow list. Receive a DM from a followed pubkey (NIP-04 and NIP-17) with `contacts.enabled=true` and confirm it notifies. Receive a DM from a non-followed pubkey (both transports) with `others.enabled=false` and confirm it is suppressed; flip `others.enabled=true` and confirm it now notifies.
**Expected:** Category classification + gate ordering behaves identically across both transports, using the real sender pubkey per transport.
**Why human:** Requires live relay traffic, a real follow list, and real incoming DMs; the gate ORDERING itself is proven by a real-function unit test, but full end-to-end classification against genuine data is Manual-Only per 05-VALIDATION.md.

### 2. Reactive re-classification on follow/unfollow

**Test:** Follow a previously-unfollowed pubkey, then receive a DM from it; confirm it now classifies as "contacts" on the very next message (not just after an app restart).
**Expected:** `contacts$` re-emits and `isContact` reflects the change immediately.
**Why human:** Requires a live signer + real follow-list mutation + a real incoming DM; not unit-tested (matches the existing `groups$`/`mutedPubkeys$` untested-reactive-observable precedent in this codebase).

### 3. `/messages` two-section UI save/reload round-trip

**Test:** Open `/messages`, toggle Contacts and Others independently, save, reload, confirm both persist correctly and independently.
**Expected:** Both category toggles round-trip through the PATCH handler and survive a page reload.
**Why human:** Requires a running web server and browser interaction; the markup, signal bindings, and PATCH handler are code-verified but the interactive round-trip is not exercised by any automated test.

### 4. Multi-device kind-30078 sync, including an old-schema peer

**Test:** With two devices synced via the encrypted kind-30078 prefs event, change a category flag on device A and confirm device B applies it; separately confirm a simulated pre-Phase-5 peer payload (old schema) does not silently disable both categories on an upgraded device.
**Expected:** Sync round-trips correctly; old-schema payloads seed both flags from the legacy `enabled` value rather than defaulting to false.
**Why human:** The pure serialize/sanitize/merge functions (including the old-schema fallback) are unit-tested, but the live multi-device relay round-trip is Manual-Only per 05-VALIDATION.md.

## Gaps Summary

No gaps found. All ten D5 decisions (D5-01 through D5-10) are implemented in the live codebase with correct wiring, confirmed by direct code reading (not just grep) and by a green `bun test` (104/104) + `bun run lint` (clean). The D5-05 correction (contacts=true/others=FALSE, not "both ON") is correctly reflected in `DEFAULT_MESSAGES_CONFIG` and its regression test. The D5-07 layering invariant — the highest-risk item, since a bug here could bypass the existing mute/whitelist/blacklist protections — is proven by a real behavioral test against the actual production function (`evaluateDmNotificationGates`), not merely a hand-written mirror, following a code-review fix (05-REVIEW-FIX.md) that also hardened `migrateConfig` against malformed configs (CR-01) and guarded an unhandled-rejection risk in both listeners (WR-01).

The two items marked ⚠️ PRESENT_BEHAVIOR_UNVERIFIED (live reactive follow-list classification, and the interactive `/messages` UI round-trip) are present and correctly wired in code but require a live signer/relay session or a running browser to exercise — exactly the Manual-Only items 05-VALIDATION.md already anticipated. They are not failures; they route to human verification per the escalation-gate pattern.

---

_Verified: 2026-07-10T19:16:55Z_
_Verifier: Claude (gsd-verifier)_
