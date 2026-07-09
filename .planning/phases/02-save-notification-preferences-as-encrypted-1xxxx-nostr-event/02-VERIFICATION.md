---
phase: 02-save-notification-preferences-as-encrypted-1xxxx-nostr-event
verified: 2026-07-09T00:00:00Z
status: human_needed
score: 18/22 must-haves verified
behavior_unverified: 4
overrides_applied: 0
behavior_unverified_items:
  - truth: "On a local rules change (debounced ~1.5s), when a signer is connected, the app NIP-44-self-encrypts the serialized prefs, signs a kind-30078 event with a stable d-tag, and publishes it to the user's outbox relays (D2-02/D2-03/D2-07/D2-10)"
    test: "Connect a live NIP-46 bunker, change a notification rule, wait >1.5s"
    expected: "A kind-30078 event is signed and published to the connected user's outbox relays (visible via relay REQ from a second client or relay log)"
    why_human: "Requires a live NIP-46 bunker session and reachable relays — not available in this execution environment"
  - truth: "Inbound kind-30078 events for the user's own pubkey+namespace are received via a live pool.subscription and reactive eventStore.replaceable read, decrypted, validated, and applied via mergePrefs+updateConfig only when strictly newer than the last applied created_at (D2-08/D2-11)"
    test: "From a second nostr client (or manual event publish), publish a newer kind-30078 event with the same d-tag for the connected user's pubkey"
    expected: "The running app decrypts the event, validates it, and updates config$/config.json with the merged rules"
    why_human: "Requires a live inbound relay event and a live signer session to decrypt — not available in this execution environment"
  - truth: "Applying a remote update sets the last-known-payload marker so the subsequent config$ emission does not re-publish — no relay republish loop (D2-09)"
    test: "Apply a remote update (as above) and observe whether a second, redundant kind-30078 event is published back to relays"
    expected: "No republish occurs after the remote update is applied"
    why_human: "Confirming the absence of a republish requires a live end-to-end round trip (inbound apply -> config$ emission -> publish pipeline no-op) with real relay traffic to observe"
  - truth: "Every signer round-trip (nip44.encrypt, nip44.decrypt via unlockAppData, signEvent) is wrapped in an ~8s timeout; a timeout or rejection degrades to local-only with a log() and never hangs the pipeline (D2-14/D2-15)"
    test: "Connect a bunker, then simulate it going unresponsive/offline, and trigger a rules change"
    expected: "After ~8s the pipeline logs a timeout error and the app remains responsive; the local config.json save already succeeded"
    why_human: "Requires deliberately inducing an unresponsive bunker session — not simulatable without a live NIP-46 connection"
overrides: []
gaps: []
---

# Phase 2: Save notification preferences as encrypted NIP-78 kind-30078 nostr event Verification Report

**Phase Goal:** Persist user notification preferences (per NIP-29 group and for public nostr in general) as an encrypted NIP-78 kind-30078 replaceable Nostr event (D2-01 supersedes the literal "1xxxx" wording) so settings survive restarts, sync across devices/clients over nostr, allow other simple web apps to modify them, and let the notification server subscribe for updates.
**Verified:** 2026-07-09
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

Must-haves were sourced from all four plans' `must_haves.truths` frontmatter (Steps 2b/2c) — ROADMAP.md has no separate bulleted Success Criteria list for Phase 2, only the goal statement, so the plan-level truths constitute the full must-haves contract.

#### Plan 01 — Pure preferences helpers (`helpers/preferences.ts`)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `serializePrefs` returns exactly the D2-04 rules subset + `version`, nothing else | ✓ VERIFIED | `helpers/preferences.ts:53-81` builds the object field-by-field; `tests/helpers/preferences.test.ts:64-96` asserts `toEqual` on the exact shape. `bun test` green. |
| 2 | `serializePrefs` never emits `pubkey`/`signer`/`server`/`topic`/`email`/`lookupRelays`/`sendContent`/`groupLink` | ✓ VERIFIED | `helpers/preferences.ts:53-81` never spreads whole sub-objects; `tests/helpers/preferences.test.ts:98-114` asserts the serialized JSON string excludes all eight forbidden substrings. |
| 3 | `mergePrefs` overwrites synced fields, preserves current's local secrets | ✓ VERIFIED | `helpers/preferences.ts:167-192` spreads `current` first, then `current.messages`/`current.groups` before overwriting only synced keys; `tests/helpers/preferences.test.ts:121-193` asserts every local field survives and every synced field comes from `incoming`. |
| 4 | `sanitizeSyncedPrefs` rejects non-object input and drops invalid whitelist/blacklist/mode entries | ✓ VERIFIED | `helpers/preferences.ts:115-157` (`asStringArray`, `asModes`, `isGroupNotificationMode` reuse); `tests/helpers/preferences.test.ts:196-245` covers null/42/"x"/[] rejection, mixed-type array filtering, and invalid `groups.modes` value dropping. |
| 5 | `isNewerPrefs` strict high-water-mark (`>`, not `>=`) | ✓ VERIFIED | `helpers/preferences.ts:199-204`; `tests/helpers/preferences.test.ts:248-260` covers equal/older/newer cases. |
| 6 | `samePrefsPayload` equality + merge-then-reserialize loop-prevention precondition | ✓ VERIFIED | `helpers/preferences.ts:212-214`; `tests/helpers/preferences.test.ts:262-298` includes the exact `samePrefsPayload(serializePrefs(mergePrefs(C,P)), P) === true` precondition test. |
| 7 | A manually-built kind-30078 EventTemplate, NIP-44 self-encrypted and signed, decrypts back to the identical `SyncedPrefs` via applesauce's app-data helpers | ✓ VERIFIED | `tests/helpers/preferences.test.ts:301-326` runs a real `PrivateKeySigner`, builds the exact `{kind:30078, tags:[["d",PREFS_NAMESPACE]], content}` template, NIP-44 self-encrypts, signs, and asserts `unlockAppData`+`getAppDataContent` deep-equals the original payload. This test executes in-process (no live relay needed) and passes. |

#### Plan 02 — SIGNER_PERMISSIONS expansion + wiring (`const.ts`, `pages/signer.tsx`, `pages/home.tsx`)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 8 | `SIGNER_PERMISSIONS` includes `get_public_key`, `sign_event:22242`, `sign_event:30078`, `nip44_encrypt`, `nip44_decrypt` | ✓ VERIFIED | `const.ts:17-21`; `tests/const.test.ts` 5 assertions, all pass. |
| 9 | Every NIP-46 signer-connect call site passes `permissions: SIGNER_PERMISSIONS` | ✓ VERIFIED | `pages/signer.tsx:33-36` (`getNostrConnectURI`), `pages/signer.tsx:313-316` (`fromBunkerURI`), `pages/home.tsx:256-259` (`getNostrConnectURI`) — all three call sites confirmed by direct read. |
| 10 | The QR-encoded nostr-connect URI carries the permissions (not just the on-screen text) | ✓ VERIFIED | `pages/signer.tsx:37` and `pages/home.tsx:260` both derive `qrCodeUrl` from the already-permissions-bearing `connectUrl` variable — no second bare `getNostrConnectURI()` call remains. |
| 11 | `NostrConnectSigner.fromBunkerURI` is called with `{ permissions: SIGNER_PERMISSIONS }` | ✓ VERIFIED | `pages/signer.tsx:313-316`, confirmed by direct read (multi-line due to Prettier formatting, functionally identical to the plan's single-line acceptance grep). |

#### Plan 03 — Reactive publish/subscribe service (`services/preferences.ts`, `index.ts`)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 12 | On local rules change (debounced ~1.5s), with a signer connected, the app NIP-44-self-encrypts, signs a kind-30078 event with a stable d-tag, and publishes to outbox relays | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Code path fully present and correctly wired: `services/preferences.ts:189-200` debounced pipeline (`skip(1)`, `distinctUntilChanged`, `debounceTime(1500)`) → `publishPreferences()` (`:118-182`) does `getPublicKey` → `serializePrefs` → `nip44.encrypt(ownPubkey, ...)` (self-encrypt, D2-02) → manual `EventTemplate{kind:30078, tags:[["d",PREFS_NAMESPACE]]}` (D2-01/D2-03) → `signEvent` → outbox-relay-targeted `pool.publish` (D2-10, `:162-170`). No test exercises the actual network publish (correctly — Pitfall 6 forbids importing this module in tests). Routed to human verification. |
| 13 | With no signer connected, no publish/subscribe is attempted; local config.json save is untouched | ✓ VERIFIED | `services/preferences.ts:119-121` (`const signer = signer$.value; if (!signer) return;`) and the subscribe pipeline's `switchMap(([user,...]) => user ? ... : NEVER/EMPTY)` gates on `user$`/`signer$` presence — deterministic, inspectable synchronous logic, not a live-network behavior. `services/config.ts:126-128` (save-on-change) is confirmed byte-for-byte unmodified by this phase (`git diff` shows no change to `services/config.ts` across all four plans' commits). |
| 14 | Inbound kind-30078 events are received via live `pool.subscription` + reactive `eventStore.replaceable`, decrypted in `switchMap(async)`, validated, and applied only when strictly newer | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Code path present and correct by inspection: `services/preferences.ts:97-108` (`preferencesEvent$`, object-form `replaceable({kind,pubkey,identifier:PREFS_NAMESPACE})`, Pitfall 2 compliant), `:205-221` (live REQ, `reconnect:Infinity, resubscribe:true`, `authors:[user]`), `:228-264` (apply pipeline: `isNewerPrefs` gate before decrypt, `withTimeout(unlockAppData(...))`, `sanitizeSyncedPrefs`, `mergePrefs`+`updateConfig`). No live inbound event was exercised. Routed to human verification. |
| 15 | Applying a remote update sets the last-known-payload marker before the resulting config$ emission, so no republish loop occurs | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Code ordering confirmed correct by inspection: `services/preferences.ts:246-251` sets `lastAppliedCreatedAt` and `lastKnownPayloadJSON = JSON.stringify(serializePrefs(merged))` synchronously *before* calling `updateConfig(merged)` — matching the D2-09 ordering requirement exactly. The end-to-end absence-of-republish-loop behavior over a live round trip is not exercisable without a live signer + relay session. Routed to human verification. |
| 16 | Every signer round-trip is wrapped in an ~8s timeout; timeout/rejection degrades to local-only with `log()` and never hangs | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `withTimeout()` helper (`services/preferences.ts:68-79`) wraps `getPublicKey` (`:124-128`), `nip44.encrypt` (`:143-147`), `signEvent` (`:156-160`), and `unlockAppData` (`:236`) — all four signer round-trips confirmed wrapped. Actual timeout-firing behavior against an unresponsive bunker requires a live disconnect scenario. Routed to human verification. |
| 17 | A publish failure is caught and logged; local save is never lost; config PATCH handler never blocked on the nostr publish | ✓ VERIFIED | `publishPreferences()` is wrapped in `try/catch` (`:123-181`) that only logs on failure and never throws; the publish pipeline invokes it fire-and-forget (`void publishPreferences()`, `:199`) from a `config$` subscription entirely decoupled from any page's PATCH handler (no page awaits or imports `publishPreferences`). This is deterministic code structure, verifiable by inspection without a live signer. |
| 18 | `enabled$` reflects sync-active state derived from `config$` AND `signer$` | ✓ VERIFIED | `services/preferences.ts:85-89` — `combineLatest([config$, signer$]).pipe(map(([, signer]) => Boolean(signer)), distinctUntilChanged(), shareAndHold())`. |
| 19 | `services/preferences.ts` self-subscribes at import and boots via `index.ts` | ✓ VERIFIED | Module-scope `.subscribe()` calls at `:196`, `:221`, `:264` execute at import time; `index.ts:16` (`import "./services/preferences";`) confirmed present alongside the pre-existing `import "./notifications";`. |

#### Plan 04 — No-signer sync hint (`pages/notifications.tsx`)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 20 | When no signer is connected, `/notifications` shows a non-blocking hint linking to `/signer` | ✓ VERIFIED | `pages/notifications.tsx:362-382` (`SyncStatusHint`) — when `syncEnabled` is false, renders `.sync-hint` div with `<a href="/signer">Connect a signer</a>`, no form/modal. |
| 21 | When a signer IS connected, the hint doesn't block/error; shows a subtle enabled state instead | ✓ VERIFIED | `pages/notifications.tsx:367-374` renders a `.sync-hint.sync-enabled` confirmation message, no error path; `.catch(() => false)` (`:363-365`) guarantees the page always renders even if the signal throws. |
| 22 | The hint reads the same `enabled$` signal the sync listener uses | ✓ VERIFIED | `pages/notifications.tsx:10` — `import { enabled$ as prefsSyncEnabled$ } from "../services/preferences";` (the exact same exported observable verified in truth #18). |

**Score:** 18/22 truths verified (4 present + wired, behavior not exercised — routed to human verification per this phase's live-signer scope note).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `helpers/preferences.ts` | 9 exports: `PREFS_KIND`, `PREFS_NAMESPACE`, `PREFS_VERSION`, `SyncedPrefs`, `serializePrefs`, `mergePrefs`, `sanitizeSyncedPrefs`, `isNewerPrefs`, `samePrefsPayload` | ✓ VERIFIED | All 9 exports present; no `services/nostr` import (`grep -c "services/nostr" helpers/preferences.ts` = 0). |
| `tests/helpers/preferences.test.ts` | Full behavior-block suite incl. event round-trip | ✓ VERIFIED | 15 tests, all pass in `bun test`. |
| `const.ts` | `SIGNER_PERMISSIONS` expanded | ✓ VERIFIED | Lines 17-21, built via `buildSigningPermissions([kinds.ClientAuth, 30078])` + 2 literals. |
| `tests/const.test.ts` | 5 membership assertions | ✓ VERIFIED | All 5 pass. |
| `pages/signer.tsx` | Both `getNostrConnectURI` + `fromBunkerURI` pass `permissions` | ✓ VERIFIED | Confirmed at lines 33-36, 313-316. |
| `pages/home.tsx` | `getNostrConnectURI` passes `permissions` | ✓ VERIFIED | Confirmed at lines 256-259. |
| `services/preferences.ts` | `enabled$`, `preferencesEvent$`, publish + subscribe pipelines, conflict state, timeout helper | ✓ VERIFIED | All present (lines 53-264); wired to real `config$`/`signer$`/`pool`/`eventStore` singletons — no stub/placeholder returns. |
| `index.ts` | Side-effect import of `./services/preferences` | ✓ VERIFIED | Line 16. |
| `pages/notifications.tsx` | Non-blocking sync hint gated on `enabled$` | ✓ VERIFIED | Lines 10, 362-382, 392. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `helpers/preferences.ts` | `services/config` | `import type { AppConfig }` | ✓ WIRED | Line 1, type-only import confirmed; no runtime side effect. |
| `helpers/preferences.ts` | `helpers/groups` | `isGroupNotificationMode` reuse | ✓ WIRED | Line 2, used in `asModes` (line 100). |
| `tests/helpers/preferences.test.ts` | `applesauce-signers`/`applesauce-common/helpers/app-data` | `PrivateKeySigner`, `unlockAppData`, `getAppDataContent` | ✓ WIRED | Confirmed imports (lines 2-8), used in the round-trip test, passes. |
| `pages/signer.tsx`/`pages/home.tsx` | `const.ts` | `SIGNER_PERMISSIONS` import | ✓ WIRED | Both files import and pass it at all 3 call sites. |
| `services/preferences.ts` | `services/nostr` | `signer$, pool, user$, mailboxes$, eventStore` | ✓ WIRED | Line 26, all used. |
| `services/preferences.ts` | `services/config` | `config$, getConfig, updateConfig` | ✓ WIRED | Line 27, all used. |
| `services/preferences.ts` | `helpers/preferences` | `PREFS_KIND, PREFS_NAMESPACE, serializePrefs, mergePrefs, sanitizeSyncedPrefs, isNewerPrefs, samePrefsPayload` | ✓ WIRED | Lines 29-36, all used. |
| `services/preferences.ts` | `applesauce-common/helpers/app-data` | `unlockAppData, getAppDataContent` deep import | ✓ WIRED | Lines 4-7, used in apply pipeline (lines 236-237). |
| `index.ts` | `services/preferences.ts` | side-effect import | ✓ WIRED | Line 16. |
| `pages/notifications.tsx` | `services/preferences` | `enabled$ as prefsSyncEnabled$` | ✓ WIRED | Line 10, used in `SyncStatusHint` (line 363). |

### Data-Flow Trace (Level 4)

Not applicable in the classic sense (this phase has no dashboard/table rendering real DB rows) — the relevant "data flow" is the sync payload itself, already traced above: `config$` (real live BehaviorSubject with real user-edited data) → `serializePrefs` → encrypt/sign/publish, and inbound event → decrypt/validate → `mergePrefs`/`updateConfig` → `config$`. No hardcoded/static stand-in data was found anywhere in this pipeline.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Preferences helper round-trip test exists and passes | `bun test tests/helpers/preferences.test.ts` (subset of full run) | 15/15 pass | ✓ PASS |
| Full workspace suite, run once | `bun test` | 45 pass, 0 fail, 86 expect() calls, 5 files | ✓ PASS |
| Strict typecheck | `bun run lint` (`tsc --noEmit`) | Clean, no errors | ✓ PASS |
| Live publish/subscribe/timeout round trip | N/A — no live NIP-46 bunker session available in this environment | N/A | ? SKIP (routed to human verification) |

### Probe Execution

No `scripts/*/tests/probe-*.sh` files exist in this repository and neither PLAN nor SUMMARY files reference any probe script. Step 7c: SKIPPED (no probes declared or conventionally present).

### Requirements Coverage

All 15 D2-xx decisions from `02-CONTEXT.md` are declared across the four plans' `requirements:` frontmatter with no gaps in the union:

- Plan 01: D2-01, D2-02, D2-03, D2-04, D2-05, D2-06, D2-08, D2-09
- Plan 02: D2-13
- Plan 03: D2-01, D2-02, D2-03, D2-07, D2-08, D2-09, D2-10, D2-11, D2-12, D2-14, D2-15
- Plan 04: D2-12

Union = {D2-01 .. D2-15} — all 15 accounted for. No orphaned requirements.

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| D2-01 | 01, 03 | NIP-78 kind 30078, stable d-tag | ✓ SATISFIED | `PREFS_KIND=30078`, `PREFS_NAMESPACE` constant, used in both publish and subscribe paths |
| D2-02 | 01, 03 | NIP-44 v2 self-encrypt to own pubkey | ✓ SATISFIED | `nip44.encrypt(ownPubkey, plaintext)` in `publishPreferences` |
| D2-03 | 01, 03 | Manual EventTemplate build (no applesauce-factory) | ✓ SATISFIED | Manual `EventTemplate` literal in both the helper test and `services/preferences.ts` |
| D2-04 | 01 | Sync rules only, exclude ntfy delivery config | ✓ SATISFIED | `serializePrefs` field-by-field construction |
| D2-05 | 01 | Never sync `signer`/`pubkey`/`lookupRelays` | ✓ SATISFIED | Negative-assertion test + field-by-field build |
| D2-06 | 01 | Plain JSON subset + version field, subset merge | ✓ SATISFIED | `SyncedPrefs` type + `mergePrefs` |
| D2-07 | 03 | Automatic bidirectional sync, debounced | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `debounceTime(1500)` pipeline present; live publish not exercised |
| D2-08 | 01, 03 | Newest-created_at-wins high-water-mark | ✓ SATISFIED | `isNewerPrefs` + gate before decrypt |
| D2-09 | 01, 03 | Loop-prevention via payload equality | ✓ SATISFIED (ordering) / ⚠️ (live loop absence) | `lastKnownPayloadJSON` ordering correct; live round-trip not exercised |
| D2-10 | 03 | Publish to NIP-65 outbox relays, fallback lookupRelays | ✓ SATISFIED | Relay selection logic in `publishPreferences` and subscribe pipeline |
| D2-11 | 03 | Subscribe via replaceable + live pool.subscription | ✓ SATISFIED (wiring) / ⚠️ (live receipt) | `preferencesEvent$` + REQ pipeline present |
| D2-12 | 03, 04 | Local-only + non-blocking UI hint when no signer | ✓ SATISFIED | `enabled$` gate + `/notifications` hint |
| D2-13 | 02 | Expand SIGNER_PERMISSIONS, wire into call sites | ✓ SATISFIED | `const.ts` + 3 call sites |
| D2-14 | 03 | Feature-detect nip44, degrade gracefully | ✓ SATISFIED | `if (!nip44) throw ...` inside try/catch, degrades per D2-15 |
| D2-15 | 03 | Publish failure never blocks/loses local save | ✓ SATISFIED | try/catch + fire-and-forget decoupling from config.ts save |

### Anti-Patterns Found

None. Scanned all phase-modified files (`helpers/preferences.ts`, `const.ts`, `services/preferences.ts`, `index.ts`, `pages/signer.tsx`, `pages/home.tsx`, `pages/notifications.tsx`, `tests/helpers/preferences.test.ts`, `tests/const.test.ts`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` — zero matches. No stub returns (`return null`/`return {}`/`return []`/`=> {}`), no hardcoded-empty data flowing to rendered output, no console.log-only implementations.

### Human Verification Required

These items are code-complete and structurally correct by inspection (confirmed above), but their end-to-end runtime behavior requires a live NIP-46 bunker session and reachable relays, which are not available in this execution environment. Each plan's own `<verification>` section explicitly defers these to `/gsd-verify-work`.

### 1. Live publish round trip

**Test:** Connect a real NIP-46 bunker (QR scan or bunker:// URI) to the app, then change a notification rule (e.g. toggle messages enabled) and wait ~2 seconds.
**Expected:** A kind-30078 event appears on the connected user's outbox relays containing NIP-44-self-encrypted content that decrypts to the changed rules; a second nostr client subscribed to `{kinds:[30078], authors:[pubkey], "#d":["nostr-secretary/notification-prefs"]}` receives it.
**Why human:** Requires an actual NIP-46 signing session and reachable relay infrastructure not present in this sandboxed environment.

### 2. Live subscribe-and-apply round trip

**Test:** From a second client (or by manually publishing a crafted, newer, validly self-encrypted kind-30078 event for the same pubkey/d-tag), publish an update while the app is running with a connected signer.
**Expected:** The running app decrypts, validates, and merges the update into its local config, and `config.json` reflects the new rules.
**Why human:** Requires live relay event delivery and a live decrypting signer.

### 3. Loop-prevention (no republish) over a live round trip

**Test:** Perform check #2 above, then observe relay traffic for ~5 seconds afterward.
**Expected:** No second/redundant kind-30078 event is published as an echo of the just-applied remote update.
**Why human:** Requires observing live relay traffic following a live apply, not reproducible via static analysis.

### 4. Timeout-triggered graceful degradation

**Test:** Connect a bunker, then make it unresponsive (e.g. close its process/network) and trigger a rules change.
**Expected:** After ~8 seconds, a "timed out" error is logged via `log()`, no page/pipeline hangs, and the local `config.json` save (independent of the nostr publish) still succeeded.
**Why human:** Requires deliberately inducing bunker unresponsiveness, not simulatable through static code inspection.

### 5. Manual bunker connect / QR permission grant (D2-13 manual verification note)

**Test:** Scan the QR code (or paste a bunker:// URI) with a real NIP-46-compatible signer app.
**Expected:** The signer app prompts for (or silently grants, per its own policy) `sign_event:22242`, `sign_event:30078`, `nip44_encrypt`, `nip44_decrypt` — all requested by the connect URI/options.
**Why human:** Requires a live signer app's permission-prompt UI, not observable via static code.

### Gaps Summary

No gaps found. All 22 must-have truths across the four plans are either fully verified by passing automated tests / deterministic code inspection (18/22), or are present-and-correctly-wired code paths whose final runtime confirmation depends on a live NIP-46 signer session unavailable in this environment (4/22, explicitly deferred to `/gsd-verify-work` by each plan's own `<verification>` section). `bun test` (45/45) and `bun run lint` (clean `tsc --noEmit`) both pass with no regressions. `services/config.ts` is confirmed unmodified across the whole phase, preserving the pre-existing local-save guarantee (D2-15). No requirement ID (D2-01 through D2-15) is orphaned — all are claimed and satisfied (or correctly deferred) across the four plans.

---

_Verified: 2026-07-09_
_Verifier: Claude (gsd-verifier)_
