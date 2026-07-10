# Phase 4: Add NIP-17 DM notifications support per applesauce docs - Research

**Researched:** 2026-07-10
**Domain:** NIP-17/NIP-59 gift-wrapped DM notification hardening (applesauce SDK v6.2.x `applesauce-relay`/`applesauce-common`, RxJS)
**Confidence:** HIGH

## Summary

This is a **review/harden, not rebuild** phase, exactly like Phase 3. The NIP-17 gift-wrap
listener already exists in `notifications/messages.ts` and already calls applesauce's documented
`unlockGiftWrap(event, signer)` and filters `rumor.kind === kinds.PrivateDirectMessage`. The one
real correctness bug — `giftWraps$`'s `limit: 1` + `skip(1)` hack in `services/nostr.ts:217-240`
— was investigated directly against the installed `applesauce-relay`/`applesauce-common` v6.2.x
source (not training-data recollection) and confirmed exactly as CONCERNS.md describes: since
NIP-59 deliberately randomizes gift-wrap `created_at` (verified empirically in this session — see
below), `since:`-based filtering cannot distinguish "new" from "historical," and `skip(1)` is a
coin-flip that drops the first genuinely-new DM whenever a relay's initial batch is empty or has
more than one event.

**Applesauce does not ship a named "notify only on new events" helper.** This was confirmed by
reading `references/encryption.md`, `references/patterns.md`, `references/packages/relay.md`, and
applesauce's own official worked example `assets/examples/messages/gift-wrap.tsx` (a full NIP-17
inbox app) via the applesauce skill. That example's own solution to "avoid re-processing history"
is architecturally *not* a notify-gate at all: it renders a full reactive model of **all** known
messages (`WrappedMessagesModel`), so re-delivery of an already-known gift wrap is harmless (the
`EventStore` just no-ops on the duplicate id). This project's use case is different — a
one-shot, fire-a-push-notification pipeline — so the "only new" boundary genuinely matters here in
a way it doesn't in the official example.

The correct, protocol-grounded mechanism *is* present in applesauce, just one layer below where
this project currently calls it. `RelayPool.subscription()`/`RelayGroup.subscription()` return
`Observable<NostrEvent>` — **EOSE markers are already discarded** at that level (confirmed by
reading `node_modules/applesauce-relay/dist/{pool,group,types}.d.ts` directly), which is exactly
why the code could never distinguish backlog from live using `.subscription()` alone. But
`RelayPool.request()`/`RelayGroup.request()` (already documented in `references/patterns.md`
under "Loaders — load X once", and already re-exported from the public `applesauce-relay` entry)
is a **one-shot fetch that completes deterministically on EOSE** and internally dedupes through an
injected `EventStore`. Composing `pool.request()` (a bounded "seed" fetch of the current backlog,
completing on EOSE, never emitted downstream) with the existing `pool.subscription()` (the
persistent "live" feed, `{ reconnect: Infinity }` unchanged) via a small extracted, injectable
RxJS combinator gives exactly the "seed the store without notifying, then notify on new inserts"
pattern D4-02 asks for — using only already-public, already-documented applesauce primitives, with
zero reliance on the randomized `created_at` field.

This session **executed** a real `GiftWrapFactory.create()` → `unlockGiftWrap()` round trip
against the installed package (not just read the source) to ground the D4-02/D4-04 claims: it
confirms (a) the outer gift-wrap's `created_at` is indeed randomized away from the actual send
time (about 30 minutes in this run, well within NIP-59's up-to-~2-days window), (b) the outer
gift-wrap's `pubkey` is a random one-time key (never the real sender), and (c) the unwrapped rumor
correctly carries the real sender's pubkey, matching `kind 14`, with the plaintext content intact
— and that `helpers/link.ts#buildOpenLink`'s underlying `getEventPointerForEvent` only ever reads
`.id`/`.kind`/`.pubkey` off its argument, so it works correctly (at runtime) on the **unsigned**
rumor despite `Rumor` lacking the `sig` field `NostrEvent` nominally requires — answering the
D4-04 deep-link question directly: point at the rumor (cast through `as unknown as NostrEvent`),
not the gift wrap.

**Primary recommendation:** Rewrite `giftWraps$` (`services/nostr.ts:217-240`) to compose a
one-shot `pool.request(messageInboxes, filter, { eventStore, timeout: 10_000 })` "seed" phase
(catchError-guarded, `ignoreElements()`d) with the existing `pool.subscription(messageInboxes,
filter, { reconnect: Infinity })` "live" phase, through a new, dependency-free, unit-testable
combinator `notifyNewGiftWraps(seed$, live$)` in `helpers/gift-wrap-subscription.ts`; extract the
NIP-17 unwrap-and-classify step into `notifications/gift-wrap-messages.ts` (mirroring Phase 3's
`legacy-messages.ts`); add `click: buildOpenLink(rumor as unknown as NostrEvent)` and the
`error instanceof Error` guard to `notifications/messages.ts`'s NIP-17 block; and delete the now-dead
`skip` import from `services/nostr.ts`. No `const.ts` permission change is needed (D4-03 already
satisfied — confirmed `nip44_decrypt` is present in `SIGNER_PERMISSIONS` today). No UI change is
needed (D4-05 explicitly forbids a reconnect hint for NIP-17).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Gift-wrap backlog vs. live boundary (D4-02) | Service Layer (`services/nostr.ts` `giftWraps$`) | Helper Layer (`helpers/gift-wrap-subscription.ts`, the pure combinator) | Relay-subscription plumbing is a service-layer concern; the pure decision logic is factored out for testability, mirroring `helpers/lists.ts`/`helpers/observable.ts` |
| Gift-wrap unwrap + rumor-kind classification | Notification Listener Layer (`notifications/messages.ts`, delegating to `notifications/gift-wrap-messages.ts`) | — | Decrypt-and-classify is a background RxJS pipeline concern, not a UI concern — same tier as the NIP-04 block (Phase 3) |
| `shouldNotify` gating (mute/whitelist/blacklist) | Notification Listener Layer (`notifications/messages.ts`) | Service Layer (reads `services/nostr.ts` mute/list observables) | Unchanged from Phase 3 — pre-existing duplication (CONCERNS.md), out of scope here (D4-08) |
| DM click deep-link (rumor → nevent) | Notification Listener Layer (`notifications/messages.ts`, calling `helpers/link.ts#buildOpenLink`) | — | Identical shape to `replies.ts`/`zaps.ts`/Phase 3's NIP-04 deep-link; zero new helper code |
| No reconnect-hint surface for NIP-17 (D4-05) | — (deliberately no tier) | — | Explicitly excluded; gift-wrap decrypt failures are expected/normal, not permission-shaped |

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

- **D4-01 (review & harden, not rebuild):** The NIP-17 flow already exists and already uses
  applesauce's `unlockGiftWrap(event, signer)` and filters `rumor.kind === PrivateDirectMessage`.
  Deliverable is to fix the real gaps (the `skip(1)` fragility, deep-link, error-guard, tests),
  not to rebuild the pipeline.
- **D4-02 (fix `skip(1)`/`limit:1` fragility — REQUIRED):** Replace the `limit: 1` + `skip(1)`
  approach in `giftWraps$` (`services/nostr.ts:217-240`) with seen-event-id dedup / high-water-mark
  logic so genuinely-new gift wraps are never dropped and startup historical wraps are not
  re-notified. Because gift-wrap `created_at` is randomized, do NOT rely on `since:`; instead track
  processed event IDs (or the set of ids present in the store at startup) and notify only on ids not
  seen before. Follow applesauce's documented NIP-17 subscription pattern — the researcher must
  confirm the recommended approach (e.g. an initial "seed the store without notifying" pass, then
  notify on new inserts). Keep the `#p: [user]`, `kinds: [GiftWrap]`, `messageInboxes$` (DM-relay)
  subscription and `{ reconnect: Infinity }`.
- **D4-03 (no permission change):** NIP-17 gift-wrap unwrap uses NIP-44 decryption; `nip44_decrypt`
  is already in `SIGNER_PERMISSIONS` (added in Phase 2, D2-13). No `const.ts` permission change is
  needed. Do NOT add any NIP-04 permission here (that was Phase 3).

### Consistency with the NIP-04 phase (Phase 3)

- **D4-04 (deep-link):** Add a click deep-link to NIP-17 DM notifications via
  `buildOpenLink(event)`, consistent with Phase 3's NIP-04 deep-link (D3-06) and
  `replies.ts`/`zaps.ts`. Thread the raw gift-wrap (or an appropriate pointer) through to the
  notification's `click`.
- **D4-05 (NO reconnect hint for NIP-17 — deliberate):** Do NOT drive the `nip04DecryptDegraded$`
  reconnect hint (or a NIP-17 analogue) on gift-wrap decrypt failures. Unlike a NIP-04 decrypt
  failure while connected (which strongly implies a missing `nip04_decrypt` permission — Phase 3
  D3-07), a failed **gift-wrap** unwrap is common and expected: anyone can send the user a gift wrap,
  and spam/malformed/not-for-this-key wraps routinely fail to decrypt. Surfacing a "reconnect your
  signer" hint on those would be a noisy false positive. Keep the existing `catchError(() => EMPTY)`
  + `log()` per-message isolation; do not add a degraded signal for NIP-17.
- **D4-06 (safe error-guard):** Apply the safe error-extraction guard
  (`error instanceof Error ? error.message : String(error)`) to the NIP-17 gift-wrap `catchError`'s
  `log(...)` call. This is the exact one-line improvement that was symmetrically applied then
  reverted at the end of Phase 3 to honor the D3-10 boundary — it now legitimately belongs to this
  phase. It prevents a `TypeError` when a rejection reason is a non-`Error` primitive.

### Content, boundary & tests

- **D4-07 (generic title, gated body):** Keep the generic notification title and include the
  decrypted message body **only** when `messages.sendContent` is on (the existing gate). No content
  in the title. NIP-17 already respects `sendContent` — do not regress the privacy gate.
- **D4-08 (tight boundary):** NIP-17 only. Do NOT modify the NIP-04 legacy path (Phase 3, done);
  do NOT implement the contacts/others split (Phase 5); do NOT add rate limiting (Phases 6-7); do
  NOT do a cross-cutting `shouldNotify` dedup refactor.
- **D4-09 (tests):** Add network-safe NIP-17 tests covering gift-wrap unwrap, the
  `rumor.kind === PrivateDirectMessage` filter, the `shouldNotify` gates, and — most importantly —
  the new dedup/high-water logic (a historical wrap present at startup is NOT notified; a new wrap
  arriving after startup IS). Extract the testable decision logic into a pure, injectable unit
  (mirroring Phase 3's `notifications/legacy-messages.ts`) so tests don't import the self-subscribing
  `notifications/messages.ts` or `services/nostr.ts` (network-via-loader). Use a `PrivateKeySigner`
  fixture (exposes `.nip44`).

### Claude's Discretion

- The exact dedup mechanism (a `Set<string>` of processed ids vs. a store-seeded high-water) — let
  research/planning pick what applesauce documents and what fits the RxJS singleton pattern.
- Where the extracted pure unit lives (`notifications/gift-wrap-messages.ts` vs. adding to
  `legacy-messages.ts`) — follow the Phase 3 precedent.
- Deep-link pointer encoding for a gift-wrapped DM (sender npub vs. an event pointer) — use what
  `helpers/link.ts` / `buildOpenLink` supports cleanly for the unwrapped rumor's author.

### Deferred Ideas (OUT OF SCOPE)

- **NIP-17 DM sending / replies** — receive-only notification secretary; no send surface (mirrors
  D3-03). Out of scope.
- **Contacts vs. others DM split** — explicitly Phase 5 (applies to both NIP-04 and NIP-17).
- **Rate limiting / grouped overflow for DM bursts** — Phases 6-7.
- **A NIP-17 decrypt-degraded reconnect hint** — deliberately excluded (D4-05); would be a noisy
  false positive on ordinary spam-wrap decrypt failures.
- **`messageInboxes$` 10s-timeout silent-complete fragility** (CONCERNS.md) — a broader relay-loader
  resilience issue, not scoped here unless it directly blocks D4-02.

</user_constraints>

<phase_requirements>
## Phase Requirements

No formal REQ-IDs exist for this phase; CONTEXT.md's D4-01..D4-09 decisions are the requirements
contract. Mapping each to the research that supports it:

| ID | Description | Research Support |
|----|-------------|------------------|
| D4-01 | Review & harden, not rebuild | Confirmed: current `unlockGiftWrap`/`rumor.kind` usage is exactly the documented pattern (see Architecture Patterns §1). Only `giftWraps$`'s subscription mechanics change. |
| D4-02 | Fix `skip(1)`/`limit:1` fragility | Root-caused via `node_modules/applesauce-relay` source read (pool/group/types `.d.ts`) plus an executed `GiftWrapFactory`→`unlockGiftWrap` round trip confirming randomized `created_at`. Fix: `pool.request()` (seed, completes on EOSE) + `pool.subscription()` (live) composed via a new pure combinator. See Code Examples §1-2 and Don't Hand-Roll. |
| D4-03 | No permission change | Confirmed via direct read of `const.ts` — `nip44_decrypt` (needed for gift-wrap/NIP-44 decrypt) is already present in `SIGNER_PERMISSIONS`; nothing to add. |
| D4-04 | Deep-link | Confirmed via an executed test that `getEventPointerForEvent` (which `buildOpenLink` calls) only reads `.id`/`.kind`/`.pubkey` — works on the unsigned rumor via an `as unknown as NostrEvent` cast, producing an `nevent` whose `author` is the real sender. See Code Examples §3. |
| D4-05 | No reconnect hint for NIP-17 | No code changes needed — confirmed by inspecting the existing `catchError(() => EMPTY)` isolation; this decision constrains the planner to NOT add a `giftWrapDecryptDegraded$`-style signal. |
| D4-06 | Safe error-guard | `notifications/messages.ts`'s existing NIP-04 block already demonstrates the exact guard (`error instanceof Error ? error.message : String(error)`, applied post-Phase-3); mirror it onto the NIP-17 `catchError`'s `log()` call (currently `Reflect.get(error, "message")`). See Code Examples §4. |
| D4-07 | Generic title, gated body | Already correctly implemented at `notifications/messages.ts:242-246` — no change needed, confirm-only. |
| D4-08 | Tight boundary | Confirmed scope: `services/nostr.ts` (`giftWraps$`), `notifications/messages.ts` (NIP-17 block only), two new pure modules, and tests. NIP-04 block, `const.ts`, and all UI pages are read-only reference. |
| D4-09 | Tests | New `helpers/gift-wrap-subscription.ts` (dedup combinator) and `notifications/gift-wrap-messages.ts` (unwrap+classify) have zero singleton imports, mirroring the `legacy-messages.ts`/`legacy-messages.test.ts` network-safety precedent. See Validation Architecture. |

</phase_requirements>

## Standard Stack

No new dependencies are required for this phase. All work uses already-installed
`applesauce-*` packages plus RxJS operators already used elsewhere in the codebase.

### Core (already installed — verified against `node_modules` source read directly)

| Library | Installed Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `applesauce-relay` | ^6.2.1 [VERIFIED: package.json + node_modules source read] | `RelayPool.request()` (one-shot, completes on EOSE, dedupes via injected `EventStore`), `RelayPool.subscription()` (persistent live feed) | `request()` is documented in the applesauce skill's `references/patterns.md` ("Loaders — load X once") and is the one-shot-fetch-with-EOSE-completion primitive this fix needs; `subscription()` is already in use |
| `applesauce-common` | ^6.2.0 [VERIFIED: package.json + node_modules source read; round-trip executed this session] | `unlockGiftWrap`, `GiftWrapFactory` (test fixture builder), `Rumor` type | Canonical NIP-17/NIP-59 unwrap surface; already in use in `notifications/messages.ts` |
| `applesauce-core` | ^6.2.0 [VERIFIED: package.json + node_modules source read] | `mapEventsToStore`/`filterDuplicateEvents` (id-based EventStore dedup — confirmed `EventStore.add()` returns the *same* stored reference for a duplicate id), `getEventPointerForEvent` (confirmed only reads `.id`/`.kind`/`.pubkey`, never `.sig`) | Underlies both the dedup fix and the deep-link fix |
| `applesauce-signers` | ^6.2.2 [VERIFIED: package.json + node_modules source read] | `PrivateKeySigner` — test fixture signer (exposes `.nip44` for gift-wrap round-trip tests) | Already the project's standard test-fixture signer (Phase 3 precedent) |
| `nostr-tools` | ^2.23.9 [VERIFIED: package.json] | `kinds.GiftWrap` (1059), `kinds.PrivateDirectMessage` (14), `kinds.Seal` (13) — confirmed numeric values by reading `node_modules/nostr-tools/lib/cjs/kinds.js` directly | Already in use throughout the codebase |
| `rxjs` | ^7.8.2 [VERIFIED: package.json] | `concat`, `ignoreElements`, `tap`, `catchError`, `filter` — all standard operators, some newly needed in `services/nostr.ts` | Already the app's reactive backbone |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `bun:test` | bundled with Bun (project already uses it) | Test runner | New `tests/helpers/gift-wrap-subscription.test.ts` and `tests/notifications/gift-wrap-messages.test.ts` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pool.request()` seed + `pool.subscription()` live (recommended) | Drop to the lower-level `pool.req()` (returns `GroupReqMessage` including explicit `type: "EOSE"` per relay) and gate on a `scan`-based "all relays EOSE'd" boolean within a single REQ | Protocol-purist and avoids a second round-trip re-fetching the same backlog, but is a bigger deviation from the current `pool.subscription()`-shaped code, requires hand-rolling the exact EOSE-aggregation logic `RelayGroup.completeOnAllEose()` already implements internally (not exported for reuse as a gate, only as a stream-*completion* condition), and changes `giftWraps$`'s message type from `NostrEvent` to a raw protocol message the rest of the pipeline doesn't expect. Rejected for this phase as higher-risk for the same outcome; documented here in case a future phase wants to eliminate the double backlog fetch. |
| A `Set<string>` of "seen" ids maintained inside `giftWraps$`'s `switchMap` (recommended) | Track a persisted high-water `created_at` and filter with `since:` | Explicitly rejected by D4-02 itself — gift-wrap `created_at` is randomized (confirmed empirically this session: ~30 min off in one run, NIP-59 allows up to ~2 days), so a `since:` filter is not just fragile but actively wrong |
| `pool.request()` with a real `EventStore` dedup option (recommended) | A brand-new temporary `EventMemory()` (the default if no `eventStore` option is passed) | Passing the real, global `eventStore` means the "seed" phase's historical gift wraps are actually persisted into the app's single `EventStore` (satisfying the applesauce hard rule "every incoming event must reach `eventStore.add(...)`"), not silently discarded after the seed completes |

**Installation:** None — no new packages.

**Version verification:**
```bash
$ npm view applesauce-relay version   # not run — already installed, confirmed via package.json + node_modules dist source (v6.2.1 tree matches ^6.2.1 range)
```
All version/behavior claims in this document were verified by reading the actual installed
`node_modules/applesauce-*/dist/**/*.{js,d.ts}` source directly, and several of the most
load-bearing claims (gift-wrap `created_at` randomization, the unwrapped rumor's real sender
pubkey, `buildOpenLink`'s tolerance of a `sig`-less rumor) were additionally **verified by
executing real code against the installed packages in this session** (see Sources).

## Package Legitimacy Audit

**Not applicable.** This phase installs zero new external packages — it modifies existing files
(`services/nostr.ts`, `notifications/messages.ts`) and adds two new pure modules plus test files
using only already-installed, already-vetted dependencies (`applesauce-*`, `nostr-tools`, `rxjs`,
`bun:test`).

**Packages removed due to [SLOP] verdict:** none — no packages evaluated.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ services/nostr.ts — giftWraps$ (REWRITTEN for D4-02)                       │
│                                                                              │
│  combineLatest([user$, messageInboxes$.defined()])                         │
│        │ switchMap([user, messageInboxes])                                 │
│        ▼                                                                    │
│   giftWrapFilter = { "#p": [user], kinds: [GiftWrap] }                     │
│        │                                                                    │
│        ├─ seed$  = pool.request(messageInboxes, giftWrapFilter,           │
│        │            { eventStore, timeout: 10_000 })                       │
│        │            → one-shot, completes on EOSE (pool.request's         │
│        │              default complete condition)                          │
│        │            → catchError(() => EMPTY)  (a seed failure must not   │
│        │              block the live phase below)                          │
│        │                                                                    │
│        ├─ live$  = pool.subscription(messageInboxes, giftWrapFilter,      │
│        │            { reconnect: Infinity })                               │
│        │            → persistent; a fresh REQ resends the whole backlog   │
│        │              too (NIP-01 semantics) -- must still be deduped     │
│        │                                                                    │
│        ▼                                                                    │
│   notifyNewGiftWraps(seed$, live$)   [helpers/gift-wrap-subscription.ts]   │
│        - seed$ events: tap(seen.add(id)) -> ignoreElements() (never       │
│          reach subscribers; historical, no notification)                   │
│        - live$ events: filter(!seen.has(id)) -> tap(seen.add(id))          │
│          (only genuinely-new ids pass through)                             │
│        │                                                                    │
│        ▼                                                                    │
│   mapEventsToStore(eventStore)  (unchanged — real EventStore dedup)        │
│        │ share()                                                            │
│        ▼                                                                    │
└────────┬─────────────────────────────────────────────────────────────────┘
         │  genuinely-new NostrEvent (kind 1059)
         ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ notifications/messages.ts — NIP-17 listener                               │
│                                                                              │
│  enabledSigner.switchMap(signer =>                                         │
│    giftWraps$.mergeMap(event =>                                            │
│      unlockPrivateDirectMessage(event, signer, { unlock, log })            │
│        [notifications/gift-wrap-messages.ts — pure, testable]              │
│        - unlockGiftWrap(event, signer) -> rumor                            │
│        - filter rumor.kind === PrivateDirectMessage                        │
│        - catchError: log(error instanceof Error ? error.message            │
│                          : String(error))   ← D4-06 fix                    │
│                       return EMPTY  (no reconnect-hint signal — D4-05)     │
│    )                                                                        │
│  ).subscribe(async (rumor) => {                                            │
│      shouldNotify(rumor.pubkey) gate (unchanged)                           │
│      profile = getValue(eventStore.profile(rumor.pubkey))                  │
│      sendNotification({                                                    │
│        title: `${getDisplayName(profile)} sent you a message`,             │
│        message: sendContent ? rumor.content : "[content omitted]",         │
│        icon: getProfilePicture(profile),                                   │
│        click: buildOpenLink(rumor as unknown as NostrEvent),  ← D4-04 fix  │
│      })                                                                    │
│  })                                                                         │
└────────┬─────────────────────────────────────────────────────────────────┘
         ▼
   services/ntfy.ts → ntfy server → mobile push
```

### Recommended Project Structure

```
services/nostr.ts                    # D4-02: giftWraps$ rewrite (imports the new combinator)
helpers/gift-wrap-subscription.ts    # NEW — D4-02: notifyNewGiftWraps() pure combinator
notifications/gift-wrap-messages.ts  # NEW — D4-09: unlockPrivateDirectMessage() pure unit
notifications/messages.ts            # D4-04/D4-06: deep-link + error-guard in the NIP-17 block
tests/helpers/gift-wrap-subscription.test.ts    # NEW — D4-02/D4-09
tests/notifications/gift-wrap-messages.test.ts  # NEW — D4-09
```

No changes to `const.ts` (D4-03), any `pages/*.tsx` (D4-05 forbids a UI hint), or the NIP-04
block (D4-08).

### Pattern 1: Applesauce's documented gift-wrap unwrap shape (already correctly followed)

**What:** applesauce's own official example (`assets/examples/messages/gift-wrap.tsx`, obtained
via the applesauce skill) unwraps a gift wrap with exactly:
```ts
import { unlockGiftWrap } from "applesauce-common/helpers";
const rumor = await unlockGiftWrap(gift, signer);
```
`notifications/messages.ts:207` already calls this identically:
`return from(unlockGiftWrap(event, signer))...`, followed by
`.pipe(filter((rumor) => rumor.kind === kinds.PrivateDirectMessage))`.

**Conclusion for D4-01:** no pipeline redesign is needed for the decrypt/classify step itself —
only the subscription mechanics feeding it (`giftWraps$`) need to change.

**Source:** [VERIFIED: node_modules/applesauce-common source, read directly]
```ts
// node_modules/applesauce-common/dist/helpers/gift-wrap.js
export async function unlockGiftWrap(gift, signer) {
    if (isGiftWrapUnlocked(gift)) return getGiftWrapRumor(gift);
    await unlockEncryptedContent(gift, gift.pubkey, signer);
    let seal = getGiftWrapSeal(gift);
    if (!seal) throw new Error("Failed to read seal in gift wrap");
    const rumor = await unlockSeal(seal, signer);
    notifyEventUpdate(gift);
    return rumor;
}
```

### Pattern 2: `pool.subscription()` silently discards the EOSE boundary (why the bug is structural, not a typo)

**What:** `RelayGroup.subscription()`'s implementation (`node_modules/applesauce-relay/dist/group.js:172-185`)
calls the low-level `relay.req(filters, opts)` (which emits `{type: "EVENT"|"EOSE"|"OPEN"|"CLOSED"}`
messages) but then immediately does:
```js
.pipe(
  filter((message) => message.type === "EVENT"),
  map((message) => message.event),
  ...
)
```
— discarding every `EOSE` message before the caller ever sees it. This is confirmed by the type
signature difference: `Relay.subscription()` returns `Observable<RelaySubscriptionResponse>`
(`= NostrEvent | "EOSE"`, per `types.d.ts:111`), but `RelayPool.subscription()` /
`RelayGroup.subscription()` return `Observable<NostrEvent>` — the EOSE information genuinely does
not survive past the group/pool layer.

**Why this matters for D4-02:** this is *why* the original author reached for `limit: 1` +
`skip(1)` — there was no `since:`-independent way to say "give me only what's new" using
`pool.subscription()` alone. The fix is not a better flag on `.subscription()` (none exists); it's
composing a *second*, EOSE-aware primitive (`pool.request()`, which does not discard EOSE — it
uses it as its completion signal) to establish the seed/live boundary before opening the live feed.

### Pattern 3: `pool.request()` — the documented one-shot, EOSE-completing fetch (the seed phase)

**What:** `references/patterns.md`'s "Loaders — load X once" section documents
`createEventLoader`/`createAddressLoader` as the *loader*-package equivalent, but the
`applesauce-relay` package itself already exports the primitive the loaders are built on:
`RelayPool.request(relays, filters, opts)`. Its default completion condition
(`RelayGroup.completeOnAny(RelayGroup.completeAfterFirstRelay(5_000), RelayGroup.completeOnAllEose())`,
plus a hard `timeout({first: opts?.timeout ?? 30_000})`) means the returned observable reliably
**completes** once the relay(s) have sent their stored backlog — exactly the boundary needed to
know "seeding is done."

**Source:** [VERIFIED: node_modules/applesauce-relay source, read directly]
```js
// node_modules/applesauce-relay/dist/group.js
request(filters, opts) {
    const complete = opts?.complete ??
        RelayGroup.completeOnAny(RelayGroup.completeAfterFirstRelay(5_000), RelayGroup.completeOnAllEose());
    return this.internalSubscription((relay) => relay.req(filters, { ...opts, reconnect: opts?.reconnect ?? relay.requestReconnect })).pipe(
        complete ? completeWhen(complete) : identity,
        timeout({ first: opts?.timeout ?? 30_000 }),
        filter((message) => message.type === "EVENT"),
        map((message) => message.event),
        opts?.eventStore === null ? identity : filterDuplicateEvents(opts?.eventStore ?? new EventMemory()),
        share());
}
```
Note `filterDuplicateEvents(opts?.eventStore ?? new EventMemory())` is a literal alias for
`mapEventsToStore(store, true)` (confirmed in `applesauce-core/dist/observable/map-events-to-store.js`)
— passing the real, global `eventStore` here means the seed phase directly persists historical
gift wraps into the app's single `EventStore`, satisfying applesauce's "every incoming event must
reach `eventStore.add(...)`" hard rule, with no separate insert call needed.

### Pattern 4: `EventStore.add()` dedup — why `distinct()`-based filtering actually works

**What:** `EventStore.add(event)` (`node_modules/applesauce-core/dist/event-store/event-store.js:190-192`)
returns the **same stored reference** when called again with an already-known id:
```js
const existing = this.memory.add(event);
if (existing && existing !== event) {
    // ... this is a duplicate event
    return existing;
}
```
This is why `mapEventsToStore`'s `distinct()` stage (`node_modules/applesauce-core/dist/observable/map-events-to-store.js`)
correctly filters out re-delivered duplicates: `store.add(event)` for a duplicate id always
resolves to the identical object reference, and RxJS's `distinct()` (no key selector) compares by
reference/value equality against everything seen so far in that stream.

**Why this alone isn't sufficient for D4-02:** `distinct()`/`EventStore` dedup only prevents
*re-processing the same id twice within one process*. It does nothing to solve "the very first
batch the relay sends back is the entire historical backlog, and none of those ids have been seen
by this fresh process yet" — which is exactly why the seed/live split (Pattern 3) is still needed
on top of dedup, not instead of it.

### Anti-Patterns to Avoid

- **Relying on `created_at`/`since:` for gift wraps:** explicitly wrong per D4-02 and empirically
  confirmed this session (randomized by NIP-59, up to ~2 days). Never gate gift-wrap notification
  logic on timestamps.
- **Shadowing the imported RxJS `filter` operator with a local variable named `filter`:**
  `services/nostr.ts` already does `import { ..., filter, ... } from "rxjs"`. The new gift-wrap
  query object must be named something else (e.g. `giftWrapFilter`), not `filter` — a naming
  collision here would silently shadow the operator inside the same module scope.
- **Passing the rumor to `buildOpenLink` without a cast:** `Rumor` (from
  `applesauce-common/helpers`) is `UnsignedEvent & { id: string }` — it has no `sig` field, so it
  does not structurally satisfy `NostrEvent`. `buildOpenLink`'s parameter type is `NostrEvent`.
  TypeScript will reject a direct pass; use `rumor as unknown as NostrEvent` (confirmed safe at
  *runtime* — `buildOpenLink`'s internal `getEventPointerForEvent`/`getAddressPointerForEvent`
  never read `.sig`). This exact double-cast pattern already exists in the codebase
  (`tests/helpers/preferences.test.ts:34,131`).
- **Deep-linking to the outer gift-wrap event instead of the rumor:** the gift wrap's `.pubkey` is
  a random, one-time NIP-59 key (confirmed empirically this session — different from the real
  sender every time), and most relays are not expected to retain 1059-kind events long-term. A
  link built from the gift wrap would encode the wrong author and likely be unresolvable. Always
  build the link from the unwrapped rumor.
- **Letting a seed-phase failure (timeout/relay error) kill the whole `giftWraps$` pipeline:**
  `pool.request()` has a hard 30s default timeout and can reject/error if EOSE never arrives.
  Without a `catchError(() => EMPTY)` around the seed phase, one unresponsive DM relay would break
  the entire `switchMap`, and the live subscription would never even start — a regression *worse*
  than the current bug (total notification outage instead of an occasional edge case).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Gift-wrap decryption | A manual seal/rumor JSON-parse + `signer.nip44.decrypt` call chain | `unlockGiftWrap(event, signer)` from `applesauce-common/helpers` | Already handles the seal→rumor two-layer unwrap, author-match verification (`rumor.pubkey !== seal.pubkey` throws), and caches the unlocked state on the event's symbols so repeated calls are free |
| "Only new" gift-wrap filtering | A hand-rolled `since:`/timestamp high-water mark | The seed (`pool.request()`, EOSE-completing) + live (`pool.subscription()`) composition documented above | `created_at` is randomized by design (NIP-59) — timestamp-based dedup is provably wrong, not just fragile |
| Cross-relay event dedup within one fetch | A manual `Set` keyed by relay+id | `pool.request()`'s built-in `filterDuplicateEvents(eventStore)` option (pass the real `eventStore`) | Already implemented and already wired to the exact same `EventStore` the rest of the app uses |
| Deep-link building for a gift-wrapped DM | A bespoke npub/nevent template just for gift-wraps | `buildOpenLink(rumor as unknown as NostrEvent)` from `helpers/link.ts` | Zero new helper code — confirmed at runtime this session that `getEventPointerForEvent` only reads `.id`/`.kind`/`.pubkey`, all present on the rumor |

**Key insight:** every piece of this phase's actual code change composes *already-exported,
already-documented* applesauce primitives (`unlockGiftWrap`, `pool.request()`, `pool.subscription()`,
`mapEventsToStore`, `buildOpenLink`) — the only genuinely new code is the small glue combinator
(`notifyNewGiftWraps`) that sequences two of them, which is exactly the shape of extraction Phase 3
already established with `legacy-messages.ts`.

## Common Pitfalls

### Pitfall 1: A relay's fresh REQ resends the whole backlog on the "live" phase too — the dedup must still run there

**What goes wrong:** Assuming that once the seed phase (`pool.request()`) completes, the
subsequent `pool.subscription()` call will magically only receive "new" events from the relay.

**Why it happens:** NIP-01 REQ semantics are: a relay replies with all currently-matching stored
events, then EOSE, then continues streaming newly-published matching events — for *every* REQ,
including the second one opened by `pool.subscription()` a moment after the first
(`pool.request()`) closed. The relay has no memory of "I already sent you this backlog once."

**How to avoid:** `notifyNewGiftWraps`'s `live$` stage must still check `seen.has(event.id)` on
every event (not just during the seed phase) — the `seen` set is not a one-time gate, it's a
running filter for the lifetime of that subscription.

**Warning signs:** A test that only asserts "seed events are filtered" but not "the *live*
observable re-sending the same id is also filtered" would pass while missing this exact class of
regression — the extracted test suite (see Validation Architecture) must exercise both.

### Pitfall 2: `giftWraps$`'s `skip` import becomes dead code after the fix

**What goes wrong:** `services/nostr.ts` imports `skip` from `"rxjs"` (line ~39) used *only* at
the current `skip(1)` call being removed. Leaving the import in place after the fix is unused
dead code (mirrors Phase 3's D3-08 "remove the unused `getLegacyMessageCorraspondant` import"
precedent).

**How to avoid:** Grep-confirm `skip(` has no other call sites in `services/nostr.ts` before
removing the import (confirmed this session — line 237 is the only usage).

### Pitfall 3: Naming the gift-wrap query filter object `filter` shadows the imported RxJS operator

**What goes wrong:** `services/nostr.ts` already does `import { ..., filter, ... } from "rxjs"`
(used elsewhere, e.g. in `tagged$`). Naming the new local gift-wrap filter object `filter` (a very
natural name given the variable holds a NIP-01 filter) silently shadows the RxJS operator within
that scope, which either breaks other code in the same function or causes a confusing
"filter is not a function" error if the operator is used later in the same closure.

**How to avoid:** Name the local variable `giftWrapFilter` (as used throughout this document's
code examples), not `filter`.

### Pitfall 4: A profile-lookup failure in the NIP-17 `.subscribe()` callback is not currently guarded (pre-existing, related but NOT required by D4-06)

**What goes wrong:** `notifications/messages.ts:238`'s NIP-17 subscribe callback does
`const profile = await getValue(eventStore.profile(sender));` with no `.catch()` — if this
5-second-timeout-bounded promise rejects (e.g. the sender's kind-0 profile never resolves), the
rejection is unhandled inside an `async` subscribe callback.

**Why it happens:** This is structurally the same class of bug Phase 3 fixed for NIP-04 via the
`decryptLegacyDirectMessage`/WR-01 pattern (`getProfile: (sender) => ... .catch(() => undefined)`),
but for NIP-17 it lives entirely inside the `.subscribe()` body (not the `mergeMap`/`catchError`
D4-06 targets), so it is a **different code location** than the one D4-06 explicitly names.

**How to avoid (recommendation, not a locked decision):** Given D4-08's tight-boundary framing
covers "the NIP-17 block" broadly and this is a one-line, local, low-risk parity fix already
proven safe in Phase 3, the planner may choose to add a `.catch(() => undefined)` here too for
symmetry — but this is **not** one of the 9 locked D4 decisions, so treat it as optional/discretionary
unless the planner explicitly elects to include it (see Open Questions).

## Code Examples

### Example 1: `giftWraps$` rewrite (D4-02) — `services/nostr.ts`

```ts
// services/nostr.ts
// Imports to ADD: catchError, concat, ignoreElements (from "rxjs")
// Import to REMOVE: skip (its only call site is being replaced — Pitfall 2)
import { notifyNewGiftWraps } from "../helpers/gift-wrap-subscription";

/** An observable of all messages sent to the users direct message relays.
 *  Only emits GENUINELY NEW gift wraps -- historical wraps fetched during
 *  the seed phase (below) are stored but never emitted here (D4-02). */
export const giftWraps$ = combineLatest([
  user$,
  messageInboxes$.pipe(defined()),
]).pipe(
  switchMap(([user, messageInboxes]) => {
    const giftWrapFilter = { "#p": [user], kinds: [kinds.GiftWrap] };

    // Seed: one-shot fetch of the current backlog, completes on EOSE
    // (pool.request's default complete condition). Persisted directly into
    // the real eventStore; never reaches subscribers of this observable.
    const seed$ = pool
      .request(messageInboxes, giftWrapFilter, {
        eventStore,
        timeout: 10_000,
      })
      .pipe(catchError(() => EMPTY)); // a seed failure must not block live below

    // Live: persistent subscription, reconnect forever (unchanged shape).
    const live$ = pool.subscription(messageInboxes, giftWrapFilter, {
      reconnect: Infinity,
    });

    return notifyNewGiftWraps(seed$, live$);
  }),
  mapEventsToStore(eventStore),
  share(),
);
```

### Example 2: The extracted, network-free combinator (D4-02/D4-09) — `helpers/gift-wrap-subscription.ts`

```ts
// helpers/gift-wrap-subscription.ts
// No top-level singleton imports (no pool, no eventStore, no signer$) --
// safe to import directly in tests, mirroring notifications/legacy-messages.ts's
// network-safety precedent.
import type { NostrEvent } from "nostr-tools";
import { concat, filter, ignoreElements, Observable, tap } from "rxjs";

/**
 * Combines a one-shot "seed" observable (expected to complete -- the
 * historical backlog) with a persistent "live" observable so that only
 * events NOT already seen during the seed phase (or a prior live emission)
 * are emitted downstream. This is the D4-02 fix: notify only on genuinely
 * new gift wraps, never on the historical backlog fetched at (re)subscribe
 * time -- and never rely on `created_at`, which NIP-59 randomizes.
 *
 * `seed$` events are consumed for their side effect only (recording seen
 * ids) via `ignoreElements()` -- they are never emitted downstream.
 * `live$` events are checked against `seen` on EVERY emission, not just
 * during the seed phase, because a relay resends its whole backlog on any
 * fresh REQ (Pitfall 1) -- including the one `live$` itself opens.
 */
export function notifyNewGiftWraps(
  seed$: Observable<NostrEvent>,
  live$: Observable<NostrEvent>,
  seen: Set<string> = new Set(),
): Observable<NostrEvent> {
  return concat(
    seed$.pipe(
      tap((event) => seen.add(event.id)),
      ignoreElements(),
    ),
    live$.pipe(
      filter((event) => {
        if (seen.has(event.id)) return false;
        seen.add(event.id);
        return true;
      }),
    ),
  );
}
```

### Example 3: Test coverage for the D4-02 dedup contract (D4-09) — `tests/helpers/gift-wrap-subscription.test.ts`

```ts
import { describe, test, expect } from "bun:test";
import { of, Subject } from "rxjs";
import type { NostrEvent } from "nostr-tools";
import { notifyNewGiftWraps } from "../../helpers/gift-wrap-subscription";

function fakeEvent(id: string): NostrEvent {
  return {
    id,
    pubkey: "sender",
    created_at: 0,
    kind: 1059,
    tags: [],
    content: "",
    sig: "sig",
  };
}

describe("notifyNewGiftWraps (D4-02 contract)", () => {
  test("a historical wrap present during seeding is NOT emitted, even if the relay resends it live", () => {
    const historical = fakeEvent("historical-id");
    const seed$ = of(historical); // completes immediately -- simulates EOSE
    const live$ = new Subject<NostrEvent>();

    const emitted: NostrEvent[] = [];
    notifyNewGiftWraps(seed$, live$).subscribe((e) => emitted.push(e));

    // Simulate the relay resending the same historical event on the fresh
    // live REQ (NIP-01 semantics -- Pitfall 1).
    live$.next(historical);

    expect(emitted).toEqual([]);
  });

  test("a new wrap arriving after seeding completes IS emitted", () => {
    const historical = fakeEvent("historical-id");
    const brandNew = fakeEvent("new-id");
    const seed$ = of(historical);
    const live$ = new Subject<NostrEvent>();

    const emitted: NostrEvent[] = [];
    notifyNewGiftWraps(seed$, live$).subscribe((e) => emitted.push(e));

    live$.next(brandNew);

    expect(emitted).toEqual([brandNew]);
  });

  test("an empty seed (zero historical events) still notifies for the first live event", () => {
    const seed$ = of<NostrEvent>(); // completes with nothing -- the exact
    // "relay returned 0 historical events" case that broke skip(1)
    const live$ = new Subject<NostrEvent>();

    const emitted: NostrEvent[] = [];
    notifyNewGiftWraps(seed$, live$).subscribe((e) => emitted.push(e));

    const brandNew = fakeEvent("new-id");
    live$.next(brandNew);

    expect(emitted).toEqual([brandNew]);
  });

  test("the same live id is never emitted twice", () => {
    const seed$ = of<NostrEvent>();
    const live$ = new Subject<NostrEvent>();

    const emitted: NostrEvent[] = [];
    notifyNewGiftWraps(seed$, live$).subscribe((e) => emitted.push(e));

    const brandNew = fakeEvent("new-id");
    live$.next(brandNew);
    live$.next(brandNew); // reconnect resend, or duplicate relay delivery

    expect(emitted).toEqual([brandNew]);
  });
});
```

### Example 4: Extracted unwrap+classify unit (D4-09) — `notifications/gift-wrap-messages.ts`

```ts
// notifications/gift-wrap-messages.ts
// No top-level singleton imports -- safe to import directly in tests,
// mirroring notifications/legacy-messages.ts.
import { unlockGiftWrap, type Rumor } from "applesauce-common/helpers";
import type { NostrEvent } from "nostr-tools";
import { kinds } from "nostr-tools";

export type UnwrapGiftWrapDeps = {
  unlock: typeof unlockGiftWrap;
};

/**
 * Unwraps a gift-wrap `event` and returns the inner rumor IF it is a
 * NIP-17 private direct message (kind 14); returns `undefined` for any
 * other rumor kind (e.g. a group-chat rumor this app does not notify on).
 * Callers are expected to wrap this in their own error handling (a failed
 * unwrap is common/expected -- spam/malformed/not-for-this-key wraps --
 * and must never be conflated with a signer-permission problem, D4-05).
 */
export async function unlockPrivateDirectMessage(
  event: NostrEvent,
  signer: Parameters<typeof unlockGiftWrap>[1],
  deps: UnwrapGiftWrapDeps = { unlock: unlockGiftWrap },
): Promise<Rumor | undefined> {
  const rumor = await deps.unlock(event, signer);
  if (rumor.kind !== kinds.PrivateDirectMessage) return undefined;
  return rumor;
}
```

```ts
// tests/notifications/gift-wrap-messages.test.ts
import { describe, test, expect } from "bun:test";
import { PrivateKeySigner } from "applesauce-signers";
import { GiftWrapFactory } from "applesauce-common/factories";
import { kinds } from "nostr-tools";
import { unlockPrivateDirectMessage } from "../../notifications/gift-wrap-messages";

describe("unlockPrivateDirectMessage (D4-09)", () => {
  test("unwraps a real gift wrap and returns the rumor for a PrivateDirectMessage", async () => {
    const senderSigner = new PrivateKeySigner();
    const senderPubkey = await senderSigner.getPublicKey();
    const receiverSigner = new PrivateKeySigner();
    const receiverPubkey = await receiverSigner.getPublicKey();

    const gift = await GiftWrapFactory.create(senderSigner, receiverPubkey, {
      kind: kinds.PrivateDirectMessage,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", receiverPubkey]],
      content: "hello from a test",
    });

    const rumor = await unlockPrivateDirectMessage(gift, receiverSigner);

    expect(rumor?.content).toBe("hello from a test");
    expect(rumor?.pubkey).toBe(senderPubkey); // the REAL sender, not the gift wrap's random pubkey
    expect(gift.pubkey).not.toBe(senderPubkey); // confirms NIP-59 anonymization occurred
  });

  test("returns undefined for a rumor kind that is not PrivateDirectMessage", async () => {
    const senderSigner = new PrivateKeySigner();
    const receiverSigner = new PrivateKeySigner();
    const receiverPubkey = await receiverSigner.getPublicKey();

    const gift = await GiftWrapFactory.create(senderSigner, receiverPubkey, {
      kind: 9, // e.g. a group-chat message rumor, not a DM
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: "not a dm",
    });

    const rumor = await unlockPrivateDirectMessage(gift, receiverSigner);
    expect(rumor).toBeUndefined();
  });
});
```

*Both tests above use the exact `GiftWrapFactory.create()` → unwrap round trip that was executed
directly against the installed `applesauce-common` v6.2.x package in this research session
(confirmed working — see Sources).*

### Example 5: `notifications/messages.ts`'s NIP-17 block — D4-04 + D4-06 applied

```ts
// notifications/messages.ts — NIP-17 block, final shape
import { unlockPrivateDirectMessage } from "./gift-wrap-messages";

enabledSigner
  .pipe(
    switchMap((signer) =>
      giftWraps$.pipe(
        mergeMap((event) => {
          log("Unlocking gift wrap", { event: event.id, signer: signer.pubkey });

          return from(unlockPrivateDirectMessage(event, signer)).pipe(
            catchError((error) => {
              log("Failed to unlock gift wrap", {
                event: event.id,
                signer: signer.pubkey,
                // D4-06: safe guard -- was Reflect.get(error, "message") || "Unknown error"
                error: error instanceof Error ? error.message : String(error),
              });
              // D4-05: deliberately NO reconnect-hint signal here -- a
              // failed gift-wrap unwrap is common/expected (spam, wraps
              // not addressed to this key), not permission-shaped.
              return EMPTY;
            }),
          );
        }),
        defined(), // unlockPrivateDirectMessage returns undefined for non-DM rumors
      ),
    ),
  )
  .subscribe(async (rumor) => {
    const { pubkey, messages } = getConfig();
    if (!pubkey) return;

    const sender = rumor.pubkey;

    if (!(await shouldNotify(sender)))
      return log("Skipping notification for blacklisted/non-whitelisted sender", { sender });

    const profile = await getValue(eventStore.profile(sender));
    const content = rumor.content;
    const displayName = getDisplayName(profile);

    await sendNotification({
      title: `${displayName} sent you a message`,
      message: messages.sendContent ? content : "[content omitted]",
      icon: getProfilePicture(profile),
      // D4-04: buildOpenLink only reads .id/.kind/.pubkey internally (verified
      // this session) -- safe on the unsigned rumor despite missing `.sig`.
      click: buildOpenLink(rumor as unknown as NostrEvent),
    });
  });
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `limit: 1` + `skip(1)` as a "first event is stale, rest are new" heuristic | Seed (`pool.request()`, EOSE-bounded) + live (`pool.subscription()`) composed via an explicit seen-id set | This fix (D4-02) | Correct in all cases: 0, 1, or N historical events on first sync; no dependency on relay-specific `limit` behavior |
| NIP-04 (kind 4) as the primary DM encryption scheme | NIP-17 (gift-wrapped, NIP-44) as the recommended scheme; NIP-04 retained as legacy/interop | NIP-17 spec finalized ~2024 | Already implemented in this app for both (Phase 3 hardened NIP-04, this phase hardens NIP-17) |

**Deprecated/outdated:**
- The `skip` RxJS import in `services/nostr.ts` becomes dead code once `giftWraps$` no longer uses
  `skip(1)` (Pitfall 2) — remove it, mirroring Phase 3's D3-08 dead-import cleanup precedent.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A single "seed" fetch per `[user, messageInboxes]` change (i.e. re-seeding whenever the DM relay list changes) is the correct re-seeding boundary, rather than seeding only once per process lifetime | Code Example 1 (`switchMap` re-runs the whole seed+live composition on every relay-list change) | If wrong (user wants "seed only once ever, even across relay-list changes"), a relay-list change would cause a brief re-seed window where already-notified DMs could theoretically be considered "historical" again if their id were somehow re-emitted — low risk since ids are globally unique and `seen` only grows, but the *boundary* itself (a fresh seed treats anything not yet in `seen` as needing seeding) is a reasonable, low-risk default that matches the existing `switchMap` re-subscribe behavior already in the code today |
| A2 | `pool.request()`'s default timeout (30s) and complete condition (first-relay-EOSE + 5s settle, or all-relay-EOSE) are acceptable for the seed phase without further tuning, given a 10s explicit timeout override is applied | Code Example 1 | If the 10s override is too aggressive for slow relays, some historical gift wraps might not be seeded before the timeout fires and `catchError(() => EMPTY)` skips the seed entirely -- worst case is a handful of historical DMs get treated as "new" (a spurious notification), not a dropped genuinely-new DM. This asymmetry (fail-open toward "safe to over-notify slightly" rather than "unsafe to under-notify") is the same tradeoff CONCERNS.md's own suggested fix implicitly accepts |
| A3 | Pitfall 4 (unguarded profile lookup in the NIP-17 `.subscribe()` callback) is out of scope for this phase's locked decisions | Common Pitfalls §4 | If the planner or user actually wants this folded in (it is a one-line, low-risk, Phase-3-precedented fix), the fix is trivial to add later; flagging it as optional avoids silently expanding D4-08's stated tight boundary without user sign-off |

**If this table is empty:** N/A — see above.

## Open Questions

1. **Should the unguarded `getValue(eventStore.profile(sender))` in the NIP-17 `.subscribe()`
   callback (Pitfall 4) be fixed in this phase for parity with Phase 3's WR-01 fix?**
   - What we know: it is the same class of bug Phase 3 fixed for NIP-04, and the fix pattern
     (`.catch(() => undefined)`) is already proven safe and low-risk.
   - What's unclear: it is not named by any of the 9 locked D4 decisions, and D4-08's tight
     boundary language could be read either way.
   - Recommendation: leave it out of the initial plan (respect D4-08 literally), but note it as a
     one-line optional follow-up task the planner can include at their discretion without
     expanding the phase's risk profile meaningfully.

2. **Is a single "first relay to EOSE" seed boundary (i.e. `pool.request()`'s default
   `completeAfterFirstRelay(5000)` behavior when it fires before `completeOnAllEose()`) an
   acceptable trade for multi-relay `messageInboxes` setups?**
   - What we know: `pool.request()`'s default complete condition is `completeOnAny(...)`, so
     whichever relay condition is met FIRST wins — a fast-EOSE relay plus a slow-EOSE relay could
     mean the seed completes 5s after the fast relay's EOSE, potentially before the slow relay has
     finished sending its own backlog.
   - What's unclear: whether any of this project's typical DM-relay setups (usually 1-3 relays)
     realistically hit this edge case in practice.
   - Recommendation: accept the default (documented, already-built-in behavior) rather than
     hand-rolling a custom `complete` option — the failure mode (an occasional historical DM
     re-notified from a slow relay) is a false positive, not data loss, consistent with this
     research's overall fail-open bias for D4-02.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun runtime + `bun:test` | Running the new test suite | Yes (already used by 6 existing test files) | matches `@types/bun ^1.3.14` in package.json | — |
| Installed `applesauce-*` v6.2.x packages | `pool.request()`, `GiftWrapFactory`, `unlockGiftWrap` | Yes — confirmed via direct `node_modules` reads AND by executing real code against them in this session | `applesauce-relay@^6.2.1`, `applesauce-common@^6.2.0` | — |
| A live NIP-46 bunker connection or a real multi-relay gift-wrap backlog | Full manual/UAT verification of the actual "historical wrap at startup NOT notified, live DM after startup IS notified" behavior against real relays | Not verifiable in this research session (requires a live signer session and a real relay round trip, same constraint noted for phases 1-3 in STATE.md) | — | Automated tests (D4-09, see Code Examples §3) cover the dedup contract deterministically without any relay; full end-to-end confirmation is deferred to human UAT |

**Missing dependencies with no fallback:** none — a live signer/relay session is only needed for
final human UAT, not for implementation or automated testing.

**Missing dependencies with fallback:** live signer/relay session (see above) — automated tests
substitute for the deterministic dedup-contract behavior; a live session is still recommended for
confirming real-world relay EOSE timing is well-behaved.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (bundled with Bun; already used — 6 existing test files) |
| Config file | `bunfig.toml` (`[test] preload = ["./tests/setup.ts"]` — isolates `CONFIG` env so tests never touch the real `config.json`) |
| Quick run command | `bun test tests/helpers/gift-wrap-subscription.test.ts tests/notifications/gift-wrap-messages.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D4-02 | A historical gift wrap present at "seed" time is NOT emitted, even if resent on the live REQ | unit | `bun test tests/helpers/gift-wrap-subscription.test.ts` | ❌ Wave 0 — new file |
| D4-02 | A genuinely-new gift wrap arriving after seeding IS emitted, including the "0 historical events" edge case that broke `skip(1)` | unit | `bun test tests/helpers/gift-wrap-subscription.test.ts` | ❌ Wave 0 — new file |
| D4-01/D4-09 (unwrap) | `unlockGiftWrap` correctly decrypts a real `GiftWrapFactory`-built gift wrap and returns the rumor with the real sender's pubkey | unit | `bun test tests/notifications/gift-wrap-messages.test.ts` | ❌ Wave 0 — new file |
| D4-01/D4-09 (kind filter) | `rumor.kind === PrivateDirectMessage` filter correctly rejects a non-DM rumor kind | unit | `bun test tests/notifications/gift-wrap-messages.test.ts` | ❌ Wave 0 — new file |
| D4-09 (shouldNotify) | Mute-list, per-type blacklist/whitelist, and global whitelist/blacklist precedence for gift-wrap senders | unit | `bun test tests/notifications/messages.test.ts` (existing file, already has an equivalent `decide()` mirror for NIP-04's `shouldNotify` — the same function is shared code, so this may already be adequately covered; confirm no NIP-17-specific gate divergence exists before adding a duplicate) | ✅ existing coverage likely sufficient — verify only |
| D4-04 | `buildOpenLink(rumor as unknown as NostrEvent)` produces a valid `nevent` whose `author` is the real sender | unit (optional) | No dedicated `helpers/link.ts` test file exists in the repo today (confirmed via `find tests/`); `buildOpenLink` itself is unchanged, only its NIP-17 call site is new — same optional/non-blocking status as Phase 3's D3-06 gap | ❌ no file exists (optional, non-blocking gap) |

### Sampling Rate

- **Per task commit:** `bun test tests/helpers/gift-wrap-subscription.test.ts tests/notifications/gift-wrap-messages.test.ts`
- **Per wave merge:** `bun test` (full suite) and `bun run lint` (`tsc --noEmit`, per `package.json` script and this project's `.planning/config.json` `build_command`)
- **Phase gate:** Full suite green + lint clean before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/helpers/gift-wrap-subscription.test.ts` — covers D4-02's dedup/high-water contract (historical-not-notified, new-is-notified, zero-historical edge case, no-double-notify)
- [ ] `tests/notifications/gift-wrap-messages.test.ts` — covers D4-01/D4-09's real unwrap + rumor-kind-filter behavior using `GiftWrapFactory` + `PrivateKeySigner` (both confirmed working via an executed round trip this session)
- [ ] `helpers/link.ts` — confirmed via `find tests/` this file still has no dedicated test file (same gap noted in Phase 3's research); optional/non-blocking for D4-04

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | No auth surface touched by this phase |
| V3 Session Management | No | — |
| V4 Access Control | No | — |
| V5 Input Validation | Yes | A gift-wrap event's seal/rumor JSON is parsed by `unlockGiftWrap` internally (`JSON.parse(content)` inside `getGiftWrapSeal`) — a malformed/malicious wrap can throw, which is exactly what the D4-06 `catchError` guard (and the pre-existing `catchError(() => EMPTY)` isolation) must continue to absorb without crashing the subscription |
| V6 Cryptography | Yes | Gift-wrap decryption uses NIP-44 via `unlockGiftWrap`/`unlockEncryptedContent` (delegated to the connected signer's `.nip44`). Never hand-roll the seal/rumor decrypt chain — always go through `unlockGiftWrap` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| A malformed/garbage gift wrap (or one not actually addressed to this key) throws inside `unlockGiftWrap`, potentially killing the whole gift-wrap notification subscription | Denial of Service | Existing `catchError(() => EMPTY)` (already present, D4-06 only improves the *logged* error message's safety) |
| Spam gift wraps (anyone can send one) causing excessive failed-decrypt log noise or, if a reconnect hint existed, false "reconnect your signer" prompts | (soft) Denial of Service / user-trust erosion | D4-05's explicit decision to NOT add a reconnect-hint signal for NIP-17 — this is exactly the mitigation for this threat pattern |
| Logging raw decrypt-error objects that might embed ciphertext or plaintext fragments | Information Disclosure | D4-06's guard logs only `error.message` (a string), never the raw `error` object or the gift-wrap `content`/rumor `content` |
| The seed-phase `pool.request()` fetch retrieving and persisting an unbounded historical backlog of gift wraps into the real `EventStore` (memory growth) | (soft) Denial of Service (resource exhaustion) | Bounded implicitly by relay-side retention/response-size limits; the existing "Single-process, in-memory event store" scaling limit (CONCERNS.md) already documents this as an accepted, pre-existing project-wide constraint, not something this phase newly introduces |

## Sources

### Primary (HIGH confidence)

- `node_modules/applesauce-relay/dist/{pool,group,relay,types}.{js,d.ts}` — `RelayPool.request()`/`RelayPool.subscription()`, `RelayGroup.request()`/`.subscription()`/`.completeAfterFirstRelay()`/`.completeOnAllEose()`, `RelaySubscriptionResponse` type, `RelayReqMessage` type (installed v6.2.1, read directly)
- `node_modules/applesauce-common/dist/{helpers/gift-wrap,factories/gift-wrap,factories/wrapped-message}.{js,d.ts}` — `unlockGiftWrap`, `GiftWrapFactory.create`, `Rumor` type (installed v6.2.x, read directly)
- `node_modules/applesauce-core/dist/{observable/map-events-to-store,event-store/event-store,helpers/pointers}.{js,d.ts}` — `mapEventsToStore`/`filterDuplicateEvents`, `EventStore.add()`/`.hasEvent()` dedup semantics, `getEventPointerForEvent` (installed v6.2.x, read directly)
- `node_modules/nostr-tools/lib/cjs/kinds.js` — confirmed `GiftWrap = 1059`, `Seal = 13`, `PrivateDirectMessage = 14` numeric values (installed v2.23.x, read directly)
- **Executed code in this session** (not just read) against the installed packages:
  - `GiftWrapFactory.create(senderSigner, receiverPubkey, rumorTemplate)` → `unlockGiftWrap(gift, receiverSigner)` round trip — confirmed the rumor's `pubkey` equals the real sender (not the gift wrap's random pubkey), `content` and `kind` survive intact
  - Confirmed `gift.created_at !== now` (randomized, ~30 minutes off in this run) — grounds the D4-02 "do not rely on `since:`" requirement empirically, not just by citation
  - Confirmed `getEventPointerForEvent(rumor)` (the function `buildOpenLink` calls internally) succeeds and returns `{ id, kind, author: <real sender pubkey> }` despite the rumor lacking `.sig` — grounds the D4-04 deep-link recommendation
- Project source: `services/nostr.ts`, `notifications/messages.ts`, `notifications/legacy-messages.ts`, `notifications/replies.ts`, `notifications/zaps.ts`, `helpers/link.ts`, `helpers/observable.ts`, `services/config.ts`, `const.ts`, `tests/notifications/{legacy-messages,groups,messages}.test.ts`, `tests/setup.ts`, `bunfig.toml`, `package.json`, `.planning/config.json`, `.planning/STATE.md`, `.planning/codebase/CONCERNS.md`, `.planning/phases/03-.../03-RESEARCH.md` — all read directly this session

### Secondary (MEDIUM confidence)

- `applesauce` skill reference bundle (`~/.claude/skills/applesauce/references/{encryption,patterns,packages/relay,troubleshooting}.md`) [CITED: applesauce skill curated docs, sourced from applesauce.build]
- `~/.claude/skills/applesauce/assets/examples/messages/gift-wrap.tsx` — official worked NIP-17 inbox example; used to confirm the *lack* of a documented "notify only new" helper and to identify `pool.request()`/`pool.sync()` as the two EOSE-aware primitives applesauce actually offers [CITED: applesauce skill curated example, sourced from applesauce.build/examples]

### Tertiary (LOW confidence)

- None — no ungrounded WebSearch-only claims were needed for this phase; every technical claim was verifiable directly against the installed package source, and the most load-bearing claims (randomized `created_at`, rumor's real-sender pubkey, `buildOpenLink`'s sig-tolerance) were additionally confirmed by executing real code in this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all version/behavior claims verified against installed `node_modules` source, several confirmed by executing real code against the installed packages
- Architecture: HIGH — the seed+live composition uses only already-exported, already-documented applesauce primitives (`pool.request`, `pool.subscription`, `mapEventsToStore`), and the core empirical claims (randomized `created_at`, sig-tolerant `getEventPointerForEvent`) were executed, not assumed
- Pitfalls: HIGH — Pitfall 1 (relay resends backlog on the live REQ too) follows directly from documented NIP-01 REQ semantics; Pitfalls 2-3 (dead `skip` import, `filter` name collision) were confirmed by direct grep against the current file
- Security domain: MEDIUM — the seed-phase memory-growth concern is a real but pre-existing, already-documented project-wide constraint (CONCERNS.md's "single-process, in-memory event store"), not independently load-tested against a real high-volume relay in this session

**Research date:** 2026-07-10
**Valid until:** 30 days (stable, low-churn domain — applesauce v6.2.x is the pinned range; a `bun update` that jumps a major version would invalidate the exact source line numbers cited here, per CONCERNS.md's existing "applesauce-* v6 suite (recently migrated)" risk note)
