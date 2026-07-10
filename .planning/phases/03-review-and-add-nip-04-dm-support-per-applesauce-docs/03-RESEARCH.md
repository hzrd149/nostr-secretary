# Phase 3: Review and add NIP-04 DM support per applesauce docs - Research

**Researched:** 2026-07-09
**Domain:** NIP-04 legacy encrypted DM handling (applesauce SDK v6.2.x, NIP-46 remote signing, RxJS)
**Confidence:** HIGH

## Summary

This is a **harden, not build** phase. The NIP-04 kind-4 decrypt path already exists in
`notifications/messages.ts:99-150` and already calls applesauce's documented
`unlockLegacyMessage(event, self, signer)` helper exactly as applesauce's own
`examples/messages/legacy.tsx` example does it. Reading applesauce's installed v6.2.x source
directly (`node_modules/applesauce-common/dist/helpers/legacy-messages.js` and
`node_modules/applesauce-core/dist/helpers/encrypted-content.js`) confirms the real, concrete bug:
`unlockLegacyMessage` routes kind-4 decryption through `signer.nip04.decrypt(...)`
(`EventContentEncryptionMethod[4] = "nip04"`), and `NostrConnectSigner` always exposes a
`.nip04` object (constructed unconditionally), but the underlying NIP-46 RPC call
(`nip04_decrypt`) is rejected by any bunker that was not granted that permission at connect
time. `const.ts:20-24`'s `SIGNER_PERMISSIONS` requests `nip44_encrypt`/`nip44_decrypt` but never
`nip04_decrypt` — so every NIP-46 bunker connection made through this app today is silently
unable to decrypt legacy DMs. This is the "one true bug" (D3-02) and it is a one-line,
low-risk fix in a single file.

The remaining gaps are exactly what D3-05–D3-09 describe: no `catchError` on the NIP-04 mergeMap
(one bad/corrupted DM currently has the potential to kill the whole messages subscription — the
NIP-17 gift-wrap path already has this protection at `notifications/messages.ts:166-173` and is
the correct template to mirror), a dead deprecated import, no click deep-link, an unverified
config-migration default for `sendContent`, and zero test coverage. Research also surfaced a
non-obvious, high-value finding: the existing test precedent in this repo
(`tests/notifications/groups.test.ts`) explicitly avoids importing any `notifications/*.ts`
module directly because those modules self-subscribe to the real `services/nostr.ts` singleton
at import time — and that singleton's `eventStore.replaceable(...)`/`eventStore.profile(...)`
calls are wired to a real network-fetching `eventLoader`. This constrains how
`tests/notifications/messages.test.ts` (D3-09) can safely be written; see Common Pitfall 1 and
the Validation Architecture section below.

**Primary recommendation:** Add `"nip04_decrypt"` (via `Permission.Nip04Decrypt` from
`applesauce-signers/helpers`) to `SIGNER_PERMISSIONS` in `const.ts`; wrap the NIP-04 decrypt
`mergeMap` block (profile fetch + `unlockLegacyMessage`) in `catchError(() => EMPTY)` mirroring
the NIP-17 path exactly; remove the dead `getLegacyMessageCorraspondant` import; thread the raw
`event` through to the `sendNotification` call so `click: buildOpenLink(event)` can be added
(matching the exact pattern already used by `replies.ts:106` and `zaps.ts:111`); fix the
`sendContent` migration default in `services/config.ts:113` to `false`; add a small
module-level "reconnect hint" signal mirroring the `services/preferences.ts` `enabled$` /
`pages/notifications.tsx` `SyncStatusHint()` pattern; and write
`tests/notifications/messages.test.ts` using `PrivateKeySigner` + real `unlockLegacyMessage` for
decrypt coverage, and a local mirror function (matching `tests/notifications/groups.test.ts`'s
documented WR-04 pattern) for the `shouldNotify` gate truth table — **do not** drive tests
through the real singleton `eventStore.profile()`/`isMuted()` calls without the safeguards
described in Common Pitfall 1.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| NIP-46 permission negotiation | Service Layer (`services/signer.ts`, `const.ts`) | — | Permissions are requested once, at connect time, and apply to both QR (`getPendingSignerConnectUrl`) and bunker-URI (`saveBunkerSigner`) flows via the single `SIGNER_PERMISSIONS` constant |
| Kind-4 event ingestion | Service Layer (`services/nostr.ts` `tagged$`) | — | Already wired; no change needed — `tagged$` already carries kind-4 events tagged to the user |
| NIP-04 decrypt orchestration | Notification Listener Layer (`notifications/messages.ts`) | Backend/API tier equivalent for this server-only app | Decrypt-and-gate-and-notify is a background RxJS pipeline, not a UI concern |
| `shouldNotify` gating (mute/whitelist/blacklist) | Notification Listener Layer (`notifications/messages.ts`) | Service Layer (reads `services/nostr.ts` mute/list observables) | Existing per-module duplication (CONCERNS.md) — out of scope to consolidate this phase (D3-10) |
| Non-blocking reconnect hint | Presentation Component Layer (`pages/messages.tsx` or `pages/notifications.tsx`) | Notification Listener Layer (emits the signal) | Mirrors the existing `services/preferences.ts#enabled$` → `pages/notifications.tsx#SyncStatusHint()` split: listener emits a reactive boolean/flag, a page renders it |
| DM click deep-link | Notification Listener Layer (`notifications/messages.ts`, calling `helpers/link.ts#buildOpenLink`) | — | Identical shape to the already-shipped `replies.ts`/`zaps.ts` pattern; zero new helper code needed |
| `sendContent` privacy default | Service Layer (`services/config.ts` migration logic) | — | Config migration boundary, not UI |

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

- **D3-01 (review & harden, not rebuild):** The NIP-04 flow already exists and already uses
  applesauce's `unlockLegacyMessage(event, pubkey, signer)` (`notifications/messages.ts:123`).
  Deliverable is to fix the real gaps (permission, error handling, tests, deep-link), not to
  rebuild the pipeline.
- **D3-02 (add `nip04_decrypt` — REQUIRED):** Expand `SIGNER_PERMISSIONS` (`const.ts:20-24`)
  to also request `nip04_decrypt`. This is the concrete bug: kind-4 decryption delegates to
  `signer.nip04.decrypt`, and a NIP-46 bunker rejects methods it was not granted at connect
  time. Use the applesauce constant `Permission.Nip04Decrypt = "nip04_decrypt"`. Passed at
  connect in `services/signer.ts:116` (QR) and `:156` (bunker URI). Do NOT add `nip04_encrypt`
  — no send path (D3-03).
- **D3-03 (receive-only — no DM sending):** Do not build a NIP-04 send/reply flow. No sending
  surface exists anywhere in the app. The app is a notification secretary; "sending" from the
  roadmap goal is out of scope. Recorded as a deferred idea.
- **D3-04 (privacy-safe `sendContent`):** Keep `messages.sendContent` off by default, and
  ensure existing/migrated users are off unless they explicitly opted in — decrypted DM
  plaintext must not silently start flowing to the third-party ntfy server. `sendContent` stays
  a local-only toggle (deliberately excluded from the kind-30078 sync per phase-2
  `helpers/preferences.ts`). Planning should verify the config migration (`services/config.ts:110-119`)
  does not default upgraders to `sendContent: true`; if it does, flip it to require explicit opt-in.
- **D3-05 (generic title, gated body):** Keep the generic notification title
  ("<displayName> sent you a message"); include the decrypted message body only when
  `sendContent` is on, else the existing "[content omitted]" placeholder. No content snippet in
  the title.
- **D3-06 (deep-link):** Add a click deep-link to DM notifications via the `appLink` template
  (`helpers/link.ts`), so tapping opens the DM/conversation in the user's client — consistent
  with the click behavior other notification types already set. NIP-04 DM notifications
  currently set no `click`.
- **D3-07 (non-blocking reconnect hint):** Already-connected signers do not retroactively gain
  `nip04_decrypt`. When a NIP-04 decrypt fails due to a missing/denied permission, `log()` it and
  surface a non-blocking hint prompting the user to reconnect their signer to grant DM
  decryption. Mirror the phase-2 D2-14 feature-detect/notice pattern — degrade, do not throw or
  force a reconnect.
- **D3-08 (catchError parity — REQUIRED):** Wrap the NIP-04 `unlockLegacyMessage` path in
  `catchError(() => EMPTY)` (or equivalent inside the `mergeMap`) so a single decrypt
  rejection/undecryptable event does not tear down the messages subscription — parity with the
  NIP-17 path (`notifications/messages.ts:166-173`). Remove the unused
  `getLegacyMessageCorraspondant` import (`:4`).
- **D3-09 (tests):** Add `tests/notifications/messages.test.ts` covering NIP-04 decryption and
  the `shouldNotify` mute/whitelist/blacklist gates, using a `PrivateKeySigner` fixture (exposes
  `.nip04` directly, as in `tests/helpers/preferences.test.ts`). Add a `SIGNER_PERMISSIONS` case
  to `tests/const.test.ts` asserting `nip04_decrypt` is present. Never import the
  `notifications/index.ts` barrel in tests (side effects); import the specific module.
- **D3-10 (tight boundary):** Do not modify the NIP-17 gift-wrap path beyond leaving it working;
  do not implement the contacts/others split (Phase 5); do not perform the cross-cutting
  `shouldNotify` dedup refactor (deferred tech debt spanning replies/zaps/groups).

### Claude's Discretion

- Exact wording/placement of the reconnect hint (which page/card, log message text).
- Exact `catchError` placement and whether to add a lightweight per-event log on decrypt failure.
- Deep-link target encoding for a DM (npub of sender vs. an nevent of the message) — pick what
  the existing `appLink` placeholders and `helpers/link.ts` support most cleanly.
- Whether to add a small applesauce-pattern alignment tweak (e.g. using
  `getLegacyMessageParent`/correspondent helpers) if it improves correctness — as long as it
  stays within the NIP-04 review scope.

### Deferred Ideas (OUT OF SCOPE)

- **NIP-04 DM sending/reply** — no send surface exists; out of scope for a notification
  secretary (D3-03). Revisit only if the app grows a compose feature.
- **NIP-17 gift-wrap review/hardening** — explicitly Phase 4.
- **Contacts vs. others DM split** — explicitly Phase 5.
- **Cross-cutting `shouldNotify` dedup factory** (replies/zaps/messages/groups) — deferred tech
  debt (CONCERNS.md); too broad and risky to fold into this focused DM phase.
- **`giftWraps$` `skip(1)` fragility fix** — a NIP-17 concern; address with Phase 4.

</user_constraints>

<phase_requirements>
## Phase Requirements

No formal REQ-IDs exist for this phase; CONTEXT.md's D3-01..D3-10 decisions are the requirements
contract. Mapping each to the research that supports it:

| ID | Description | Research Support |
|----|-------------|------------------|
| D3-01 | Review & harden, not rebuild | Confirmed via `node_modules` source read: current `unlockLegacyMessage` usage exactly matches applesauce's own `examples/messages/legacy.tsx` pattern — no pipeline redesign needed. See Architecture Patterns §1. |
| D3-02 | Add `nip04_decrypt` permission | Confirmed via `node_modules/applesauce-signers/dist/helpers/nostr-connect.js` — `Permission.Nip04Decrypt = "nip04_decrypt"`, exported from `applesauce-signers/helpers`. See Code Examples §1 and Don't Hand-Roll. |
| D3-03 | No send path | Confirmed via grep — no `nip04.encrypt`/send-DM call site exists anywhere; `SendLegacyMessage` action (applesauce-actions) is not installed as a dependency. |
| D3-04 | Privacy-safe `sendContent` migration default | Confirmed bug in `services/config.ts:113` — `sendContent: parsed.directMessageNotifications`. See Common Pitfall 3. |
| D3-05 | Generic title, gated body | Already correctly implemented at `notifications/messages.ts:145-149` — no change needed, confirm-only. |
| D3-06 | Click deep-link | `replies.ts:106`/`zaps.ts:111` establish the exact `click: buildOpenLink(event)` pattern to mirror; requires threading the raw `event` through the NIP-04 mergeMap's return value. See Code Examples §2. |
| D3-07 | Non-blocking reconnect hint | `services/preferences.ts#enabled$` + `pages/notifications.tsx#SyncStatusHint()` is the established mirror-pattern (from D2-14). See Architecture Patterns §3 and Common Pitfall 2 (no standardized bunker error format). |
| D3-08 | `catchError` parity | NIP-17 template read directly at `notifications/messages.ts:166-173`. See Code Examples §3 for the exact NIP-04 mirror, including the additional `getValue(eventStore.profile(...))` fragility already present and unguarded. |
| D3-09 | Tests | `tests/notifications/groups.test.ts`'s documented avoidance of importing self-subscribing notification modules is the binding precedent. See Validation Architecture and Common Pitfall 1. |
| D3-10 | Tight boundary | Confirmed scope: only `notifications/messages.ts`, `const.ts`, `services/config.ts`, and a small hint surface are touched; NIP-17 block (`:152-205`) is read-only reference. |

</phase_requirements>

## Standard Stack

No new dependencies are required for this phase. All work uses already-installed
`applesauce-*` packages (verified installed versions below) plus existing project code.

### Core (already installed — verified against `node_modules` and `package.json`)

| Library | Installed Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `applesauce-common` | ^6.2.0 [VERIFIED: package.json + node_modules source read] | `unlockLegacyMessage`, `getLegacyMessageReceiver`/`getLegacyMessageCorrespondent`, `getLegacyMessageParent` | Canonical applesauce NIP-04 helper surface; already in use |
| `applesauce-core` | ^6.2.0 [VERIFIED: package.json + node_modules source read] | `EncryptedContentSymbol`/`unlockEncryptedContent`/`getEncryptedContentEncryptionMethods` (the routing table that maps kind 4 → `nip04`) | Underlies `unlockLegacyMessage`; confirms the exact failure mode being fixed |
| `applesauce-signers` | ^6.2.2 [VERIFIED: package.json + node_modules source read] | `NostrConnectSigner`, `Permission` enum (`applesauce-signers/helpers`), `PrivateKeySigner` | Signer permission model + test fixture signer |
| `nostr-tools` | ^2.23.9 [VERIFIED: package.json] | `kinds.EncryptedDirectMessage` (= 4), `generateSecretKey`/`getPublicKey` for test fixtures | Already in use throughout the codebase |
| `rxjs` | ^7.8.2 [VERIFIED: package.json] | `catchError`, `EMPTY`, `mergeMap`, `from` | Already the app's reactive backbone |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `bun:test` | bundled with Bun (project already uses it) | Test runner | `tests/notifications/messages.test.ts`, `tests/const.test.ts` additions |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `unlockLegacyMessage` (current) | Manually calling `signer.nip04.decrypt(correspondent, event.content)` | Rejected — `unlockLegacyMessage` also handles the encrypted-content cache (`EncryptedContentSymbol`) and correspondent resolution; hand-rolling loses caching and the `EncryptedContentModel` reactivity applesauce's docs describe |
| Local mirror function for `shouldNotify` test (current recommendation, see Pitfall 1) | Exporting `shouldNotify` and calling it directly in tests | Exporting is feasible (one-line change, does not touch replies/zaps/groups, does not violate D3-10's "no cross-cutting refactor") but still requires guarding `isMuted()`/`loadLists()` against the real singleton's ~2s timeout-fallback and (if a `pubkey` is set in test config) a live-network `eventLoader` fetch attempt — see Pitfall 1 for the exact guard needed either way |

**Installation:** None — no new packages.

**Version verification:**
```bash
$ npm view applesauce-common version   # not run — already installed, confirmed via package.json + node_modules dist source (v6.2.x tree matches ^6.2.0 range)
```
All version/behavior claims in this document were verified by reading the actual installed
`node_modules/applesauce-*/dist/**/*.js` and `.d.ts` source directly (not training-data
recollection), since the installed version is the ground truth for this repo's build. This is
tagged `[VERIFIED: node_modules source]` throughout rather than `[VERIFIED: npm registry]`
because no registry network call was made — the installed tree is more authoritative than the
registry for confirming actual runtime behavior.

## Package Legitimacy Audit

**Not applicable.** This phase installs zero new external packages — it modifies existing files
(`const.ts`, `notifications/messages.ts`, `services/config.ts`) and adds test files using only
already-installed, already-vetted dependencies (`applesauce-*`, `nostr-tools`, `rxjs`, `bun:test`).

**Packages removed due to [SLOP] verdict:** none — no packages evaluated.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```text
┌───────────────────────────────────────────────────────────────────┐
│ services/nostr.ts:tagged$  (real relay subscription, unchanged)   │
│   filter: event."#p" == user AND event.pubkey != user             │
└───────────────────────────┬───────────────────────────────────────┘
                            │ kind-4 events
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│ notifications/messages.ts — NIP-04 listener                       │
│                                                                     │
│  enabledSigner (config.messages.enabled && signer present)         │
│        │                                                           │
│        ▼ switchMap(signer)                                        │
│  tagged$.filter(kind===4)                                          │
│        │                                                           │
│        ▼ mergeMap(event) — NOW WRAPPED IN catchError (D3-08)       │
│    ┌─────────────────────────────────────────────────────────┐    │
│    │ 1. getLegacyMessageReceiver(event, pubkey) → sender      │    │
│    │ 2. getValue(eventStore.profile(sender))  ─┐ can throw    │    │
│    │ 3. unlockLegacyMessage(event, pubkey,     │ TimeoutError │    │
│    │    signer)  → signer.nip04.decrypt(...)  ─┘ or bunker    │    │
│    │    "not authorized" style error if perm   missing (NEW:  │    │
│    │    fixed by D3-02 SIGNER_PERMISSIONS entry)               │    │
│    │ → on failure: log() + EMPTY (never throws downstream)    │    │
│    │ → on decrypt-permission-shaped failure: also flip a      │    │
│    │   "reconnect hint" signal (D3-07)                         │    │
│    └─────────────────────────────────────────────────────────┘    │
│        │ {sender, profile, content, event}  (event now threaded)  │
│        ▼ defined()                                                 │
│  .subscribe(): shouldNotify(sender) gate → sendNotification({      │
│      title, message (gated by sendContent, D3-05),                 │
│      icon, click: buildOpenLink(event)  ← NEW (D3-06)              │
│  })                                                                 │
└───────────────────────────┬───────────────────────────────────────┘
                            ▼
                    services/ntfy.ts → ntfy server → mobile push
```

### Recommended Project Structure

No new files or directories beyond tests. Existing structure (`STRUCTURE.md`) is followed exactly:

```
const.ts                        # D3-02: SIGNER_PERMISSIONS += nip04_decrypt
notifications/messages.ts       # D3-06/D3-07/D3-08: catchError, click, hint trigger
services/config.ts              # D3-04: fix sendContent migration default
services/signer.ts               # unchanged — already passes SIGNER_PERMISSIONS at both call sites
pages/messages.tsx (or notifications.tsx)  # D3-07: render the reconnect hint
tests/notifications/messages.test.ts   # NEW — D3-09
tests/const.test.ts             # D3-09: add nip04_decrypt assertion
```

### Pattern 1: Applesauce's documented legacy-message decrypt shape (already correctly followed)

**What:** applesauce's own example (`examples/messages/legacy.tsx`, part of the applesauce skill's
bundled reference set) decrypts a kind-4 event with exactly:
```ts
import { unlockLegacyMessage } from "applesauce-common/helpers";
await unlockLegacyMessage(message, pubkey, signer);
```
`notifications/messages.ts:123` already calls this identically:
`const content = await unlockLegacyMessage(event, pubkey, signer);`

**When to use:** Any time a kind-4 event's content must be decrypted. Do not call
`signer.nip04.decrypt(...)` directly — `unlockLegacyMessage` also resolves the correspondent via
`getLegacyMessageCorrespondent` and caches the plaintext on the event via
`setEncryptedContentCache` (so `EncryptedContentModel`/`getEncryptedContent` see it too).

**Source:** [VERIFIED: node_modules/applesauce-common source] `unlockLegacyMessage` implementation:
```ts
// node_modules/applesauce-common/dist/helpers/legacy-messages.js
export async function unlockLegacyMessage(message, self, signer) {
    const cached = getEncryptedContent(message);
    if (cached) return cached;
    const correspondent = getLegacyMessageCorrespondent(message, self);
    if (!correspondent) throw new Error("No correspondent found");
    return await unlockEncryptedContent(message, correspondent, signer);
}
```

**Conclusion for D3-01:** no pipeline redesign is needed or recommended. The bug is entirely in
the permission grant, not in how decryption is invoked.

### Pattern 2: Kind → encryption-method routing (why the permission bug exists)

**What:** applesauce's `EventContentEncryptionMethod` table statically maps
`kinds.EncryptedDirectMessage` (4) → `"nip04"`. `unlockEncryptedContent` calls
`getEncryptedContentEncryptionMethods(event.kind, signer)`, which does
`signer[method]` (i.e. `signer.nip04`) and then `.decrypt(pubkey, event.content)`.

**Source:** [VERIFIED: node_modules/applesauce-core source]
```ts
// node_modules/applesauce-core/dist/helpers/encrypted-content.js
export const EventContentEncryptionMethod = {
    [kinds.EncryptedDirectMessage]: "nip04",
    [kinds.Seal]: "nip44",
    [kinds.GiftWrap]: "nip44",
};
```

**Why the bug is real (not theoretical):** `NostrConnectSigner`'s constructor unconditionally
sets `this.nip04 = { encrypt: ..., decrypt: this.nip04Decrypt.bind(this) }`
(`node_modules/applesauce-signers/dist/signers/nostr-connect-signer.js:73-75`) — so
`signer.nip04` is **never undefined** for a connected bunker signer, meaning
`getEncryptedContentEncryptionMethods` never throws its own "Signer does not support nip04
encryption" client-side guard. The failure instead happens one layer deeper: `nip04Decrypt`
calls `this.makeRequest(NostrConnectMethod.Nip04Decrypt, [pubkey, ciphertext])`, which is a real
NIP-46 relay round-trip; if the bunker was never granted `nip04_decrypt` at connect time, the
bunker's remote response is expected to reject the request (`response.error` set), and
`makeRequest` rejects with `new Error(response.error)`
(`node_modules/applesauce-signers/dist/signers/nostr-connect-signer.js:170`).

### Pattern 3: Non-blocking degrade-and-hint (mirror of D2-14, for D3-07)

**What:** `services/preferences.ts` already implements the exact shape D3-07 asks for, for a
different feature (prefs sync instead of DM decrypt):
```ts
// services/preferences.ts:85-89 — reactive "is this degraded" signal
export const enabled$ = combineLatest([config$, signer$]).pipe(
  map(([, signer]) => Boolean(signer)),
  distinctUntilChanged(),
  shareAndHold(),
);
```
```tsx
// pages/notifications.tsx:362-382 — async component reads it, renders a hint, never throws
async function SyncStatusHint() {
  const syncEnabled = await firstValueFrom(prefsSyncEnabled$).catch(() => false);
  if (syncEnabled) return <div class="sync-hint sync-enabled">...</div>;
  return (
    <div class="sync-hint">
      Connect a signer to sync your settings across devices.{" "}
      <a href="/signer">Connect a signer</a>
    </div>
  );
}
```

**When to use for D3-07:** Export a small reactive flag from `notifications/messages.ts` (e.g.
`export const nip04DecryptDegraded$ = new BehaviorSubject(false)`), flip it to `true` inside the
new `catchError` handler when a decrypt attempt fails, and read it from a `messages.tsx` (or
`notifications.tsx`) async component using the exact `firstValueFrom(...).catch(() => false)`
guard shown above — never let a failure to read the hint throw into page rendering.

**Important caveat (see Common Pitfall 2):** there is no standardized NIP-46 error code for
"permission denied" — `response.error` is a free-text string set by whatever bunker implementation
is on the other end. Treat **any** NIP-04 decrypt failure while a signer is connected as
hint-worthy (best-effort), not just ones that string-match a permission-denied message.

### Anti-Patterns to Avoid

- **Calling `signer.nip04.decrypt` directly instead of `unlockLegacyMessage`:** loses the
  encrypted-content cache and correspondent resolution; also loses the (potential) future benefit
  of `EncryptedContentModel` reactivity if the app ever adopts model-based rendering for DMs.
- **Wrapping only `unlockLegacyMessage` in `catchError`, leaving `getValue(eventStore.profile(...))`
  unguarded:** the profile-fetch step (`notifications/messages.ts:113-115`) can also throw
  (`getValue`'s `simpleTimeout` rejects with `TimeoutError` if the profile never resolves — a
  pre-existing fragility already documented in CONCERNS.md's "helpers/observable.ts#getValue"
  entry). Since D3-08 says "or equivalent inside the `mergeMap`", the recommended, low-risk fix is
  to wrap the *entire* async body (profile fetch + decrypt) for the NIP-04 listener in one
  `catchError`, not just the decrypt call — this is a strictly local change to `messages.ts`'s
  NIP-04 block and does not touch the NIP-17 path or any other module (respects D3-10).
- **Expanding `SIGNER_PERMISSIONS` with `nip04_encrypt`:** explicitly excluded by D3-02/D3-03 —
  there is no send path, so requesting encrypt permission over-broadens what a bunker approves.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Kind-4 decryption | A manual `signer.nip04.decrypt(...)` call | `unlockLegacyMessage(event, self, signer)` from `applesauce-common/helpers` | Handles correspondent resolution + plaintext caching; already the pattern in use |
| Correspondent/sender resolution | Manual `event.pubkey === self ? getTagValue(event, "p") : event.pubkey` | `getLegacyMessageReceiver` (= `getLegacyMessageCorrespondent`) from `applesauce-common/helpers` | Already imported and correctly used at `notifications/messages.ts:110`; do not reimplement |
| NIP-46 permission strings | Hand-typed `"nip04_decrypt"` string literal | `Permission.Nip04Decrypt` from `applesauce-signers/helpers` | Avoids typos, matches the exact string the `NostrConnectMethod` enum on the other side of the RPC expects; both are `"nip04_decrypt"` today but importing the constant is the applesauce-recommended, future-proof approach |
| Deep-link building for a Nostr event | A bespoke npub/nevent template just for DMs | `buildOpenLink(event)` from `helpers/link.ts` | Zero new code — `replies.ts:106` and `zaps.ts:111` already call this identically for their own event types; kind-4 is not addressable, so `buildOpenLink` naturally encodes an `nevent` |

**Key insight:** every piece of this phase's actual code change already has an established,
working precedent elsewhere in this exact codebase (NIP-17's `catchError`, replies/zaps'
`buildOpenLink`, phase-2's reconnect-hint pattern). The work is precedent-matching, not
invention — deviating from these precedents (e.g. inventing a new hint UI pattern, or a new
deep-link encoding) increases review risk for no benefit.

## Common Pitfalls

### Pitfall 1: Tests that import `notifications/messages.ts` (or drive `shouldNotify`/`isMuted` for real) can silently attempt real network I/O

**What goes wrong:** `notifications/messages.ts` self-subscribes to `enabledSigner` and the
`tagged$`/`giftWraps$` observables at import time (side effect on import, documented in
CONCERNS.md and ARCHITECTURE.md). Those observables transitively depend on
`services/nostr.ts`'s `eventStore`, which has `eventStore.eventLoader = eventLoader` wired to a
real `RelayPool` via `createEventLoaderForStore(eventStore, pool, { lookupRelays })`
(`services/nostr.ts:66-68`). `[VERIFIED: node_modules/applesauce-core source]` — the model
framework's `event()`/`replaceable()` accessors (`node_modules/applesauce-core/dist/models/base.js`)
call `store.eventLoader(pointer)` whenever the requested event is not already cached, which means
**any code path that calls `eventStore.profile(...)` or `eventStore.replaceable(...)` for an
address not already in the store will attempt a real relay fetch** if a `pubkey` happens to be
configured in the test's `AppConfig`.

**Why it happens:** `tests/notifications/groups.test.ts` already hit this and documents its
workaround in a comment: it explicitly does **not** import `notifications/groups.ts`, and instead
re-implements a local `decide()` mirror function that calls the real, pure, exported
`passesGroupModeGate` helper — with an explicit `TODO(WR-04)` acknowledging this only covers the
gate logic in isolation, not the real wiring.

**How to avoid (for `tests/notifications/messages.test.ts`, D3-09):**
1. **NIP-04 decrypt coverage:** test `unlockLegacyMessage` directly with a `PrivateKeySigner`
   fixture and a manually-built kind-4 `NostrEvent` (`kind: kinds.EncryptedDirectMessage`,
   encrypted via `signer.nip04.encrypt(recipientPubkey, plaintext)`, mirroring the round-trip test
   shape already used for NIP-44 in `tests/helpers/preferences.test.ts`'s
   `"event round-trip"` describe block). This never touches `notifications/messages.ts` or
   `services/nostr.ts` at all.
2. **`shouldNotify` gate coverage:** since `shouldNotify` is not currently exported, either (a)
   add `export` to it (a one-line, local, non-cross-cutting change — does not touch
   replies/zaps/groups, so it does not violate D3-10) and call the real function, **or** (b)
   follow the `groups.test.ts` WR-04 precedent and write a local mirror. If (a) is chosen: **do
   not set a `pubkey` in the test's `AppConfig` fixture** — leaving it unset keeps `isMuted()`
   bounded to its documented 2-second `timeout({first:2000, with: () => of(new Set())})` fallback
   (`services/nostr.ts:290-298`) with zero network calls, because `mutedPubkeys$`'s
   `combineLatest` source never emits without a `user$` value. Setting a `pubkey` would instead
   activate the real `eventStore.replaceable({kind: Mutelist, pubkey})` chain, which **would**
   attempt a live-network `eventLoader` fetch.
3. Keep the per-module `whitelists`/`blacklists` arrays in the test config **empty** — a non-empty
   array triggers `loadLists(...)`, which unconditionally calls
   `firstValueFrom(mailboxes$.pipe(timeout({first:2000, with: () => of(undefined)})))` as its
   first line even for coordinate-less input, adding another bounded-but-slow 2s tax.
4. Budget test runtime accordingly: exercising `shouldNotify` even once will cost ~2s (the
   `isMuted` timeout) plus, on the very first call in the process, an additional ~2s×2 for
   `whitelist$`/`blacklist$`'s own first-subscription `loadLists` calls (they are `shareReplay(1)`
   so subsequent calls in the same test run are instant). Group `shouldNotify` assertions into as
   few `test()` blocks as practical, or raise Bun's per-test timeout, to avoid flaky timeouts.

**Warning signs:** A test that hangs for much longer than 2-8 seconds, or one that fails
intermittently in CI (no network) but passes locally (network present), is a sign this guard was
not followed.

### Pitfall 2: No standardized NIP-46 error format for "permission not granted"

**What goes wrong:** Assuming a decrypt failure due to missing permission can be reliably
distinguished (by error message string-matching) from a decrypt failure due to a corrupted/garbage
ciphertext.

**Why it happens:** `[VERIFIED: node_modules/applesauce-signers source]` — `makeRequest` rejects
with `new Error(response.error)` where `response.error` is whatever free-text string the remote
bunker implementation chooses to send back for a denied/unauthorized request. NIP-46 does not
specify a structured error code for this case; different bunkers (nsec.app, Amber, etc.) may phrase
it differently or not distinguish it from other failures at all.

**How to avoid:** Treat any NIP-04 decrypt failure while a signer is connected as reconnect-hint-
worthy (best-effort degrade), rather than trying to parse the bunker's free-text error for a
specific "permission denied" phrase. Log the raw error message (`Reflect.get(error, "message")`,
matching the existing NIP-17 `catchError` log shape) for diagnosis, but do not gate the hint on
string content.

**Warning signs:** A hint that never appears (because the string-match never fires) despite DMs
consistently failing to decrypt for a genuinely un-permissioned signer.

### Pitfall 3: `sendContent` migration silently opts existing users into leaking DM plaintext

**What goes wrong:** `services/config.ts:110-119`'s migration for the old
`directMessageNotifications` boolean field does:
```ts
parsed.messages = {
  enabled: parsed.directMessageNotifications,
  sendContent: parsed.directMessageNotifications, // Default to same value
  ...
};
```
Any user who had `directMessageNotifications: true` in their pre-migration config is silently
upgraded to `sendContent: true` — sending decrypted DM plaintext to the (often third-party,
`ntfy.sh`) notification server without an explicit opt-in.

**Why it happens:** The migration author conflated "notifications for DMs are on" with "include DM
content in notifications," which were not the same setting in the old schema (the old schema had
no content-inclusion toggle at all).

**How to avoid:** Change line 113 to `sendContent: false,` unconditionally, regardless of the old
`directMessageNotifications` value. This is exactly what D3-04 requires and what CONCERNS.md
already recommends ("Flip the migration default to `false` and require explicit opt-in").

**Warning signs:** None visible to the user at runtime — this is a silent, one-time migration bug;
verify by reading the migration code directly (already done in this research) rather than trying
to reproduce it live.

### Pitfall 4: Deprecated helper alias imported but unused

**What goes wrong:** `notifications/messages.ts:4` imports `getLegacyMessageCorraspondant`
(misspelled, deprecated) but never calls it — `getLegacyMessageReceiver` is used instead.

**Why it happens:** `[VERIFIED: node_modules/applesauce-common source]` —
`getLegacyMessageCorraspondant` is a deprecated alias:
```ts
/** @deprecated use {@link getLegacyMessageCorrespondent} instead */
export const getLegacyMessageCorraspondant = getLegacyMessageCorrespondent;
```
Likely left over from an earlier applesauce version/typo-fix; `getLegacyMessageReceiver` (also an
alias of `getLegacyMessageCorrespondent`) is the one actually used.

**How to avoid:** Delete the unused import per D3-08. No behavior change — this is dead code
removal only.

## Code Examples

### Example 1: Const.ts permission fix (D3-02)

```ts
// Source: node_modules/applesauce-signers/dist/helpers/nostr-connect.js (verified, installed v6.2.2)
// export var Permission; Permission["Nip04Decrypt"] = "nip04_decrypt";

import { Permission } from "applesauce-signers/helpers";
import {
  NostrConnectSigner,
  type NostrConnectionClassMethods,
} from "applesauce-signers";
import { kinds } from "nostr-tools";

export const SIGNER_PERMISSIONS = [
  ...NostrConnectSigner.buildSigningPermissions([kinds.ClientAuth, 30078]),
  "nip44_encrypt",
  "nip44_decrypt",
  Permission.Nip04Decrypt, // "nip04_decrypt" — D3-02: fixes NIP-04 decrypt for new connections
];
```
Both call sites (`services/signer.ts:114-118` QR flow and `:152-161` bunker-URI flow) already
read `SIGNER_PERMISSIONS` from `const.ts` — no changes needed at either call site.

### Example 2: Threading `event` through for the deep-link (D3-06)

```ts
// notifications/messages.ts — NIP-04 mergeMap return value, add `event`:
return { sender, profile, content, event };

// ...and in .subscribe():
await sendNotification({
  title: `${displayName} sent you a message`,
  message: messages.sendContent ? content : "[content omitted]",
  icon: getProfilePicture(profile),
  click: buildOpenLink(event), // Source: pattern from notifications/replies.ts:106, zaps.ts:111
});
```
`buildOpenLink` (`helpers/link.ts:28-42`) already handles the non-addressable-kind branch
correctly for kind 4 — no changes to `helpers/link.ts` are needed. Do not add `click` to the
NIP-17 `sendNotification` call in this phase (D3-10 — that path is out of scope beyond "leave it
working").

### Example 3: `catchError` parity for the NIP-04 path, mirroring the NIP-17 shape (D3-08)

```ts
// Source: pattern mirrored from notifications/messages.ts:152-177 (existing NIP-17 block)
enabledSigner
  .pipe(
    switchMap((signer) =>
      tagged$.pipe(
        filter((event) => event.kind === kinds.EncryptedDirectMessage),
        mergeMap((event) => {
          const { pubkey } = getConfig();
          if (!pubkey) return EMPTY;

          const sender = getLegacyMessageReceiver(event, pubkey);
          if (!sender) return EMPTY;

          return from(
            (async () => {
              const profile = await getValue(
                eventStore.profile(sender).pipe(defined()),
              );

              log("Unlocking legacy message", {
                event: event.id,
                sender,
                signer: signer.pubkey,
              });

              const content = await unlockLegacyMessage(event, pubkey, signer);
              if (!content) return undefined;

              return { sender, profile, content, event };
            })(),
          ).pipe(
            catchError((error) => {
              log("Failed to unlock legacy message", {
                event: event.id,
                signer: signer.pubkey,
                error: Reflect.get(error, "message") || "Unknown error",
              });
              // D3-07: flip the reconnect hint on any decrypt failure
              nip04DecryptDegraded$.next(true);
              return EMPTY;
            }),
          );
        }),
      ),
    ),
    defined(),
  )
  .subscribe(async ({ sender, profile, content, event }) => {
    // ... unchanged shouldNotify + sendNotification, with click: buildOpenLink(event) added
  });
```
This wraps **both** the profile-fetch step and the decrypt step in one `catchError`, which is a
strictly local, in-scope improvement over only wrapping `unlockLegacyMessage` — the profile fetch
(`getValue(eventStore.profile(sender).pipe(defined()))`) can also reject with a `TimeoutError`
(CONCERNS.md's documented `helpers/observable.ts#getValue` fragility) and was previously entirely
unguarded.

### Example 4: NIP-04 decrypt test using `PrivateKeySigner` (D3-09)

```ts
// Source: pattern mirrored from tests/helpers/preferences.test.ts's NIP-44 round-trip test,
// adapted to NIP-04 using unlockLegacyMessage.
import { describe, test, expect } from "bun:test";
import { PrivateKeySigner } from "applesauce-signers";
import { unlockLegacyMessage } from "applesauce-common/helpers";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { kinds, type NostrEvent } from "nostr-tools";

describe("unlockLegacyMessage (NIP-04)", () => {
  test("decrypts a kind-4 event addressed to self", async () => {
    const senderSigner = new PrivateKeySigner();
    const senderPubkey = await senderSigner.getPublicKey();

    const receiverSecretKey = generateSecretKey();
    const receiverPubkey = getPublicKey(receiverSecretKey);

    const plaintext = "hello from a test";
    const ciphertext = await senderSigner.nip04.encrypt(receiverPubkey, plaintext);

    const event: NostrEvent = {
      id: "id",
      pubkey: senderPubkey,
      created_at: 0,
      kind: kinds.EncryptedDirectMessage,
      tags: [["p", receiverPubkey]],
      content: ciphertext,
      sig: "sig",
    };

    const receiverSigner = new PrivateKeySigner(receiverSecretKey);
    const decrypted = await unlockLegacyMessage(event, receiverPubkey, receiverSigner);
    expect(decrypted).toBe(plaintext);
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| NIP-04 (kind 4) as the primary DM encryption scheme | NIP-17 (gift-wrapped, NIP-44) as the recommended scheme; NIP-04 retained as legacy/interop | NIP-17 spec finalized ~2024 | This app already implements both; NIP-04 remains widely used by older/lighter clients, hence this phase's continued investment in it |
| `getLegacyMessageCorraspondant` (typo'd name) | `getLegacyMessageCorrespondent` (correct spelling) | applesauce added the correctly-spelled export and marked the typo'd one `@deprecated` (still present as an alias in the installed v6.2.x tree) | This codebase currently imports the deprecated alias without using it (dead import) — remove per D3-08 |

**Deprecated/outdated:**
- `getLegacyMessageCorraspondant`: deprecated alias of `getLegacyMessageCorrespondent`, retained
  in the package only for backward compatibility. Do not import it going forward.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Any NIP-04 decrypt failure (not just permission-shaped ones) should trigger the reconnect hint, since NIP-46 has no standardized "permission denied" error code to string-match against | Pattern 3 / Pitfall 2 | If wrong, the hint could fire too eagerly on unrelated/transient failures (e.g. a genuinely corrupted DM from a third party), creating hint fatigue. Mitigate by making the hint dismissible/non-blocking (already required by D3-07) |
| A2 | The reconnect-hint UI belongs on `pages/messages.tsx` (or `pages/notifications.tsx`, mirroring `SyncStatusHint`) rather than `pages/signer.tsx` | Architectural Responsibility Map | Low risk — this is explicitly Claude's Discretion per CONTEXT.md; either placement is easy to relocate later |
| A3 | Adding `export` to `shouldNotify` in `messages.ts` (to enable direct testing of the real implementation) is in-scope and does not violate D3-10's "no cross-cutting refactor" restriction, since it is a local, single-file, non-behavior-changing visibility change | Common Pitfall 1 / Alternatives Considered | If the planner reads D3-10 more strictly, the fallback is the `groups.test.ts`-style local mirror function (also documented above), which carries the same WR-04-style coverage gap already accepted elsewhere in this codebase |
| A4 | `click: buildOpenLink(event)` should be added only to the NIP-04 `sendNotification` call, not the NIP-17 one, in this phase | Code Example 2 | If wrong (i.e., the user actually wants both), this is a trivial one-line follow-up; D3-10's explicit "leave NIP-17 path working" language and D3-06's NIP-04-specific wording support the narrower reading |

## Open Questions

1. **Does the reconnect hint need a "dismiss" affordance, or is re-render-until-fixed acceptable?**
   - What we know: D2-14's `SyncStatusHint` precedent has no dismiss button — it just reflects
     current state on every page load.
   - What's unclear: Whether the DM-decrypt hint should behave identically (always show while
     degraded) given Pitfall 2 means it may fire more often/broadly than a true permission issue.
   - Recommendation: Mirror `SyncStatusHint` exactly (no dismiss) for consistency and minimal
     scope; the planner/user can add a dismiss later if hint fatigue becomes a real issue.

2. **Should the `nip04DecryptDegraded$` flag reset once a decrypt succeeds again (e.g. after
   reconnect), or persist for the process lifetime?**
   - What we know: The phase-2 precedent (`preferences.ts#enabled$`) is a pure function of current
     `signer$`/`config$` state, not a sticky flag — it clears automatically.
   - What's unclear: A `BehaviorSubject<boolean>` set to `true` on failure would need an explicit
     reset-on-success write to avoid staying permanently "on" after a successful reconnect.
   - Recommendation: Reset `nip04DecryptDegraded$.next(false)` at the top of the mergeMap's happy
     path (right after a successful `unlockLegacyMessage` resolves), so the hint clears itself
     once decryption starts working again.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun runtime + `bun:test` | Running the new test suite | ✓ (already used by 5 existing test files) | matches `@types/bun ^1.3.14` in package.json | — |
| A live NIP-46 bunker connection | Full manual/UAT verification of the actual permission fix (a real bunker must grant `nip04_decrypt` and a real kind-4 DM must arrive) | Not verifiable in this research session (requires a live signer session, same constraint noted for phases 1/2 in STATE.md) | — | Automated tests (D3-09) cover the decrypt/gate logic without a live bunker; full end-to-end confirmation is deferred to human UAT, consistent with how phases 1 and 2 already deferred their live-signer verification steps |

**Missing dependencies with no fallback:** none — a live bunker is only needed for final human UAT,
not for implementation or automated testing.

**Missing dependencies with fallback:** live bunker session (see above) — automated tests substitute.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (bundled with Bun; already used — 5 existing test files) |
| Config file | `bunfig.toml` (`[test] preload = ["./tests/setup.ts"]` — isolates `CONFIG` env so tests never touch the real `config.json`) |
| Quick run command | `bun test tests/const.test.ts tests/notifications/messages.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D3-02 | `SIGNER_PERMISSIONS` includes `nip04_decrypt` | unit | `bun test tests/const.test.ts` | ✅ (file exists; new `test()` case to add) |
| D3-08/D3-09 (decrypt) | `unlockLegacyMessage` correctly decrypts a manually-built kind-4 event via `PrivateKeySigner` | unit | `bun test tests/notifications/messages.test.ts` | ❌ Wave 0 — new file |
| D3-09 (shouldNotify gates) | Mute-list, per-type blacklist/whitelist, and global whitelist/blacklist precedence for DM senders | unit | `bun test tests/notifications/messages.test.ts` | ❌ Wave 0 — new file (see Pitfall 1 for how to avoid real network I/O in these cases) |
| D3-04 | Config migration never sets `sendContent: true` for upgrading users | unit | `bun test tests/services/config.test.ts` (existing file — confirmed via grep to have zero existing coverage of `sendContent`/migration; add a new case) | ❌ Wave 0 — no existing coverage |
| D3-06 | `buildOpenLink(event)` produces a link for a kind-4 event (non-addressable branch) | unit | Optional — `helpers/link.ts` has no dedicated test file at all today; `buildOpenLink` itself is unchanged, only its NIP-04 call site is new | ❌ no file exists (optional, non-blocking gap) |

### Sampling Rate

- **Per task commit:** `bun test tests/const.test.ts tests/notifications/messages.test.ts`
- **Per wave merge:** `bun test` (full suite) and `bun run lint` (`tsc --noEmit`, per `package.json` script and this project's `.planning/config.json` `build_command`)
- **Phase gate:** Full suite green + lint clean before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/notifications/messages.test.ts` — covers D3-08/D3-09 (NIP-04 decrypt + shouldNotify gates)
- [ ] `tests/const.test.ts` — add one `test()` case asserting `SIGNER_PERMISSIONS` contains `"nip04_decrypt"` (D3-02)
- [ ] `tests/services/config.test.ts` — confirmed via grep this file has **zero** matches for `sendContent`/`directMessageNotifications`/`migrat` today, i.e. the D3-04 migration-default fix currently has no regression test. Add a case that seeds a legacy `{ directMessageNotifications: true }` config fixture and asserts the migrated `messages.sendContent === false`.
- [ ] `helpers/link.ts` — confirmed via `find tests/` this file has **no** dedicated test file at all (`tests/` contains only `const.test.ts`, `fixtures/`, `helpers/{groups,preferences}.test.ts`, `notifications/groups.test.ts`, `services/config.test.ts`, `setup.ts`). Adding deep-link-specific coverage for D3-06 is optional/nice-to-have (not blocking) since `buildOpenLink` itself is unchanged code — only its NIP-04 call site is new.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | No auth surface touched by this phase (existing app-wide "no auth on HTTP routes" gap per CONCERNS.md is out of scope here) |
| V3 Session Management | No | — |
| V4 Access Control | No | — |
| V5 Input Validation | Yes | Kind-4 event shape is validated implicitly by `applesauce`'s `isValidLegacyMessage`/`getLegacyMessageCorrespondent` (returns `undefined` for malformed events, already gated by the existing `if (!sender) return;` check) — no new validation needed, but the new `catchError` must not let a malformed event crash the pipeline (D3-08) |
| V6 Cryptography | Yes | NIP-04 decryption uses `signer.nip04.decrypt` (delegated to the connected signer — `PrivateKeySigner`'s NIP-04 implementation uses `applesauce-core/helpers/encryption`'s `nip04` module, or the remote bunker's own implementation for `NostrConnectSigner`). Never hand-roll AES-CBC/ECDH — always go through `unlockLegacyMessage`/`signer.nip04` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Decrypted DM plaintext exfiltrated to a third-party ntfy server | Information Disclosure | `sendContent` toggle, off by default; D3-04 closes the migration gap that could silently flip this on for existing users |
| One malformed/undecryptable kind-4 event kills the whole notification subscription (DoS against the user's own notification pipeline) | Denial of Service | `catchError(() => EMPTY)` (D3-08) — already the established pattern for NIP-17; applying it to NIP-04 closes this specific gap |
| A NIP-46 bunker granting less than requested (or silently ignoring the `nip04_decrypt` request) leaves the user thinking DMs will decrypt when they won't | Tampering / (soft) Denial of Service | D3-07's non-blocking reconnect hint — this is a UX mitigation, not a security control; no cryptographic guarantee exists that a bunker actually honors a requested permission (see Pitfall 2 / Assumption A1) |
| Logging raw decrypt-error objects that might embed ciphertext or plaintext fragments | Information Disclosure | Existing convention already followed by the NIP-17 `catchError` block: log only `Reflect.get(error, "message")`, never the raw `error` object or event `content` — apply identically to the new NIP-04 `catchError` |

## Sources

### Primary (HIGH confidence)

- `node_modules/applesauce-common/dist/helpers/legacy-messages.js` and `.d.ts` — `unlockLegacyMessage`, `getLegacyMessageCorrespondent`/`getLegacyMessageReceiver`/`getLegacyMessageCorraspondant`, `getLegacyMessageParent`, `isValidLegacyMessage` (installed v6.2.x, read directly)
- `node_modules/applesauce-core/dist/helpers/encrypted-content.js` and `.d.ts` — `EventContentEncryptionMethod`, `getEncryptedContentEncryptionMethods`, `unlockEncryptedContent` (installed v6.2.x, read directly)
- `node_modules/applesauce-signers/dist/signers/nostr-connect-signer.js` — `NostrConnectSigner.nip04`/`nip04Decrypt`/`makeRequest` (installed v6.2.2, read directly)
- `node_modules/applesauce-signers/dist/helpers/nostr-connect.js` and `.d.ts` — `Permission` enum, `buildSigningPermissions` (installed v6.2.2, read directly)
- `node_modules/applesauce-signers/dist/signers/private-key-signer.js` — `PrivateKeySigner.nip04` fixture confirmation (installed v6.2.x, read directly)
- `node_modules/applesauce-core/dist/models/base.js` — confirms `eventLoader` is invoked by `event()`/`replaceable()` model accessors when an event is not cached (installed v6.2.x, read directly)
- Project source: `notifications/messages.ts`, `const.ts`, `services/signer.ts`, `services/config.ts`, `services/nostr.ts`, `services/ntfy.ts`, `helpers/link.ts`, `helpers/lists.ts`, `helpers/observable.ts`, `services/preferences.ts`, `pages/notifications.tsx`, `pages/messages.tsx`, `tests/notifications/groups.test.ts`, `tests/helpers/groups.test.ts`, `tests/helpers/preferences.test.ts`, `tests/const.test.ts`, `tests/setup.ts`, `bunfig.toml`, `package.json` — all read directly this session

### Secondary (MEDIUM confidence)

- `applesauce` skill reference bundle (`~/.claude/skills/applesauce/references/encryption.md`, `references/packages/signers.md`, `references/patterns.md`, `references/troubleshooting.md`) [CITED: applesauce skill curated docs, sourced from applesauce.build]
- `~/.claude/skills/applesauce/assets/examples/messages/legacy.tsx` — official worked example confirming the current codebase's `unlockLegacyMessage` usage matches the documented pattern [CITED: applesauce skill curated example, sourced from applesauce.build/examples]

### Tertiary (LOW confidence)

- None — no ungrounded WebSearch-only claims were needed for this phase; all technical claims were verifiable directly against the installed package source and the project's own codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all version/behavior claims verified against installed `node_modules` source, not training-data recollection
- Architecture: HIGH — every recommended change mirrors an already-shipped, working pattern in this exact codebase (NIP-17 catchError, replies/zaps buildOpenLink, phase-2 reconnect hint)
- Pitfalls: HIGH — the test-safety pitfall (Pitfall 1) was independently verified by reading both the existing test precedent (`groups.test.ts`'s documented avoidance) and the actual `EventStore` model-loader wiring (`models/base.js`) that explains *why* that precedent exists
- Security domain: MEDIUM — the "no standardized permission-denied error code" finding (Pitfall 2 / A1) is grounded in the installed signer source, but bunker-side behavior across different NIP-46 host implementations (nsec.app, Amber, etc.) was not independently tested and is inherently implementation-variable

**Research date:** 2026-07-09
**Valid until:** 30 days (stable, low-churn domain — applesauce v6.2.x is the pinned range; a `bun update` that jumps a major version would invalidate the exact source line numbers cited here, per CONCERNS.md's existing "applesauce-* v6 suite (recently migrated)" risk note)
