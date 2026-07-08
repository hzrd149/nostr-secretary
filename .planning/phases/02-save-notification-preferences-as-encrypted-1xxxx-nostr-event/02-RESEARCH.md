# Phase 2: Save notification preferences as encrypted 1xxxx nostr event - Research

**Researched:** 2026-07-07
**Domain:** NIP-78 application-data events, NIP-44 self-encryption, NIP-46 remote-signer permissions, RxJS bidirectional sync
**Confidence:** HIGH (all API facts below were confirmed by reading the installed `node_modules/applesauce-*@6.1.0` `.d.ts`/`.js` sources directly, and the encryption-binding behavior was additionally confirmed by **running real code** against a `PrivateKeySigner` — see `## Sources`)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Event format & encryption**
- **D2-01 (kind):** Use **NIP-78 kind 30078** (Application-specific Data, parameterized-replaceable) with a stable `d`-tag namespace (e.g. `d: "nostr-secretary/notification-prefs"`). Chosen over the roadmap's literal "1xxxx" range because interop ("let other simple web apps modify them") is an explicit goal and 30078 is the recognized, collision-safe, library-supported app-data standard. The roadmap phase title still says "1xxxx" — this decision supersedes it; planning should note the divergence.
- **D2-02 (encryption):** **NIP-44 v2**, self-encrypted to the user's own pubkey (`signer.nip44.encrypt(ownPubkey, JSON.stringify(prefs))`); ciphertext stored in the event `.content`. This mirrors the NIP-51 hidden-content / NIP-60 self-encrypt pattern the app already consumes on the read side. NIP-04 is deprecated and not used.
- **D2-03 (publish path):** Build events **manually** — `applesauce-factory` is not installed and will not be added for this phase. Construct an `EventTemplate` (`kind: 30078`, `tags: [["d", ...]]`, encrypted `content`) → `signer$.value.signEvent(template)` → `pool.publish(relays, signed)`.
  > **Research flags this decision for reconsideration — see "IMPORTANT: D2-03 premise correction" below. Not overridden here; presented as an option for the planner/user.**

**Payload scope (what syncs)**
- **D2-04 (rules only):** Sync **notification rules only** — `messages`, `replies`, `zaps`, `groups` (including `groups.modes` and each section's `enabled`/`whitelists`/`blacklists`), the global `whitelists`/`blacklists`, and `appLink`. **Do NOT** sync ntfy **delivery** config (`server`, `topic`, `email`) — delivery stays per-device (the ntfy topic is effectively a push-channel secret).
- **D2-05 (never synced):** **Never** include the `signer` blob (serialized account — sensitive, device-specific) or `pubkey` (identity, redundant/derivable) in the payload. Also exclude `lookupRelays` (device/network-local infra choice) unless planning finds a strong reason.
- **D2-06 (schema):** Serialize the synced subset as a **plain JSON object** (the same field shape as `AppConfig`'s synced slice) inside the encrypted `.content`. Include a small `version` field for forward-compat. Keep it a subset merge, not a whole-config replace, so unsynced/local fields (signer, ntfy, pubkey) are preserved.

**Sync model & conflict resolution**
- **D2-07 (automatic bidirectional):** Publish on local change (**debounced**, e.g. ~1–2s, to coalesce rapid edits) AND subscribe for remote updates; apply inbound updates into `config$`. No manual sync buttons required (a manual "sync now" is an allowed nicety but not the primary mechanism).
- **D2-08 (newest wins):** On boot and on any inbound event, reconcile by **`created_at` high-water-mark** — the newest event wins. Track the last-applied and last-published `created_at`; ignore events not newer than what's already applied.
- **D2-09 (loop prevention — REQUIRED):** Guard against the inbound-update → `config$.next` → save-on-change → republish loop. Do **not** republish an event that merely reflects a just-applied inbound change: compare the candidate payload/`created_at` against the high-water-mark before publishing, and guard the `config.ts:126` save-on-change subscription so a remote-origin update does not immediately re-trigger a publish. (See CONCERNS.md `giftWraps$` `skip(1)` fragility as a cautionary pattern.)
- **D2-10 (publish relays):** Publish to the user's **NIP-65 outbox relays** (`mailboxes$.outboxes`); fall back to `lookupRelays` if outboxes are empty.
- **D2-11 (subscribe):** Mirror `groups$` / `mutedPubkeys$` — a `combineLatest([user$, mailboxes$]) → switchMap → eventStore.replaceable({ kind: 30078, pubkey, ... })` reactive value, plus (for guaranteed live push) a `pool.subscription(relays, { kinds:[30078], authors:[pubkey], "#d":[namespace] }, { reconnect: Infinity, resubscribe: true })` piped through `onlyEvents()` + `mapEventsToStore(eventStore)`, decrypting inside a `switchMap(async ...)` like `mutedPubkeys$`.

**Read-only / no-signer degradation & permissions**
- **D2-12 (local-only + hint):** With **no signer connected**, keep persisting to `config.json` (unchanged current behavior) but **skip publish/subscribe**, and show a **non-blocking UI hint** ("connect a signer to sync your settings across devices"). Existing read-only users are unaffected. Derive the sync listener's `enabled$` from `config$` **and** `signer$` (only active when a signer is present).
- **D2-13 (SIGNER_PERMISSIONS — REQUIRED):** Expand `SIGNER_PERMISSIONS` (`const.ts:11-13`, currently only `kinds.ClientAuth`/22242) to also request **`sign_event` for kind 30078** and **`nip44_encrypt` + `nip44_decrypt`**, or the bunker will reject signing/encryption. New NIP-46 connections must request these up front; consider how already-connected signers are handled (re-request/notice).
  > **Research finding: `SIGNER_PERMISSIONS` is currently dead code — see Pitfall 4. This is bigger than "expand the constant."**
- **D2-14 (feature-detect nip44):** `signer.nip44` is optional on remote bunkers. **Feature-detect** `signer$.value?.nip44` at runtime; if absent, degrade to local-only and surface a notice rather than throwing.
  > **Research finding: for the only wired signer type (`NostrConnectAccount`/`NostrConnectSigner`), `.nip44` is NEVER undefined — see Pitfall 3. The premise needs correcting; feature-detection must happen by attempting-and-catching, not a null check.**
- **D2-15 (failure handling):** If publish fails (bunker offline/latency), keep the local save (never lose the setting) and log via `log()`; a lightweight retry or next-change republish is acceptable. Do not block the config PATCH handler on the nostr publish.

### Claude's Discretion
- Exact `d`-tag namespace string, `version` value, debounce interval, and whether to add an optional manual "sync now" control are left to planning.
- Where the new code lives (`services/preferences.ts` vs. an addition to `services/nostr.ts`) — follow STRUCTURE.md "Where to Add New Code": a new `$`-suffixed observable/singleton that self-subscribes at import.
- Whether/how to show sync status in the UI (which page/card) beyond the no-signer hint.

### Deferred Ideas (OUT OF SCOPE)
- Syncing ntfy **delivery** config (server/topic/email) across devices — deliberately excluded (D2-04); revisit only if users ask for full cross-device provisioning (overlaps with backlog 999.4 guided setup).
- Supporting non-NIP-46 signer types (NIP-07 extension, local nsec) for signing the prefs event — currently only `"nostr-connect"` is wired app-wide; out of scope here.
- A dedicated preferences-management web page / richer sync-status UI — overlaps with backlog 999.3 (web config reimagining).
- Encrypted-event schema versioning/migration beyond a simple `version` field.
</user_constraints>

## Summary

This phase adds a new self-subscribing service (`services/preferences.ts`, following the `groups$`/`mutedPubkeys$` template in `services/nostr.ts`) that serializes a rules-only subset of `AppConfig`, NIP-44-self-encrypts it, and publishes/subscribes it as a NIP-78 kind 30078 parameterized-replaceable event. Every primitive the phase needs — `eventStore.replaceable()` with an `identifier` (d-tag) parameter, NIP-44 self-encryption via the signer, NIP-46 permission strings, `pool.publish`/`pool.subscription` — already exists in the exact shape the codebase's existing patterns (`groups$`, `mutedPubkeys$`, `giftWraps$`) use. No new relay logic, no new event-loading pattern is required.

Three research findings materially change what the planner should build, all **empirically verified against the installed `applesauce-*@6.1.0` packages**, not assumed from training data:

1. **`applesauce-common@6.1.0` (already installed, zero new dependencies) ships a purpose-built NIP-78 helper module** (`applesauce-common/helpers/app-data`: `APP_DATA_KIND`, `hasAppData`, `unlockAppData`, `getAppDataContent`, `lockAppData`) that is safe and correct to use for the **read/decrypt side** of this phase. It is a drop-in fit for "mirror `mutedPubkeys$`'s decrypt-in-`switchMap(async...)` pattern."
2. **The bundled `AppDataFactory.create(id, data, true)` write-side helper has a signer-binding bug** — confirmed by running it — and must **not** be used to build the encrypted event. The manual/lower-level `EventFactory.encryptedContent()` builder (also bundled in already-installed `applesauce-core`, distinct from the unrelated, NOT-installed `applesauce-factory` npm package that D2-03 correctly declined) **does** work correctly and is a legitimate "manual-ish" middle ground worth flagging to the planner even though D2-03 locks in fully-manual `EventTemplate` construction.
3. **`SIGNER_PERMISSIONS` (`const.ts:11-13`) is currently unused everywhere in the codebase.** Neither `pages/signer.tsx` nor `pages/home.tsx` passes `permissions` to `getNostrConnectURI()` or `NostrConnectSigner.fromBunkerURI()`. D2-13 ("expand `SIGNER_PERMISSIONS`") is necessary but not sufficient — this phase must also **wire the constant into all three signer-creation call sites**, or the expanded permission list has no effect at all.
4. **`NostrConnectSigner.nip44` is never `undefined`** for the only wired signer type — it's an always-present bound-method object that proxies to a NIP-46 round trip. A bunker that doesn't support NIP-44 will not present as `signer.nip44 === undefined`; it will either reject the round-trip (if it sends an error response) or **hang the returned promise forever** (there is no built-in timeout in `NostrConnectSigner.makeRequest`). D2-14's "feature-detect via null check" premise needs correcting to "attempt-with-timeout-and-catch."

**Primary recommendation:** Build the event with `EventFactory.fromKind(30078).modifyPublicTags(tags => [...tags, ["d", NAMESPACE]]).encryptedContent(ownPubkey, JSON.stringify(payload), "nip44").as(signer).sign()` (verified working, zero new dependencies) as the write path, and `applesauce-common/helpers/app-data`'s `unlockAppData`/`getAppDataContent` as the read path — but if the user wants to keep D2-03's literal "raw `EventTemplate` + `signer.signEvent`" instruction, that path also works and is documented in full below. Either way: wrap every signer round-trip (`signEvent`, `nip44.encrypt`, `nip44.decrypt`) in an explicit `timeout()`, and wire `SIGNER_PERMISSIONS` into all 3 existing signer-creation call sites, not just `const.ts`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Serialize rules-subset of `AppConfig` → JSON | Service Layer (`helpers/preferences.ts`, pure) | — | Pure transform, no I/O; must be independently unit-testable per WR-04 precedent (see Pitfall 6) |
| Merge inbound JSON → `AppConfig` | Service Layer (`helpers/preferences.ts`, pure) | — | Same as above — pure, testable, no `services/nostr` import |
| NIP-44 self-encrypt/decrypt | Service Layer (`services/preferences.ts`) | Nostr Core (`signer$`) | Requires the live signer; belongs beside `mutedPubkeys$`'s decrypt pattern |
| Build + sign kind 30078 event | Service Layer (`services/preferences.ts`) | Nostr Core (`services/nostr.ts` exports `signer$`/`pool`) | Mirrors no existing publish code (this is the first publish path in the app) — new, but same singleton-service convention |
| Publish to outbox relays | Nostr Core (`pool.publish`) | Service Layer (caller) | `pool` is the one process-wide `RelayPool` singleton; no new relay infra |
| Subscribe for remote updates | Nostr Core (`pool.subscription`, `eventStore.replaceable`) | Service Layer (decrypt/apply) | Exactly the `groups$`/`giftWraps$`/`tagged$` pattern already in `services/nostr.ts` |
| Debounce + loop-prevent local publish | Service Layer (`services/preferences.ts`) | Config Store (`config$`) | RxJS operator chain over `config$`, analogous to but must NOT reuse the fragile `giftWraps$` `skip(1)` idiom |
| NIP-46 permission strings | Nostr Core / Signer Setup (`const.ts`, `pages/signer.tsx`, `pages/home.tsx`) | — | Permissions are requested at connect-time in 3 places; all 3 must be updated (Pitfall 4) |
| No-signer UI hint | HTTP/Page Layer (`pages/notifications.tsx` or `pages/signer.tsx`) | — | Presentational only, gated on `enabled$` |

## Standard Stack

### Core (all already installed — zero new dependencies)

| Library | Installed Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `applesauce-core` | `^6.1.0` (confirmed installed `6.1.0`) | `EventStore.replaceable()`, `EventFactory` base builder, `unixNow()`, hidden-content helpers | Already the app's event/model layer |
| `applesauce-common` | `^6.1.0` (confirmed installed `6.1.0`) | `applesauce-common/helpers/app-data` (NIP-78 read helpers: `APP_DATA_KIND`, `unlockAppData`, `getAppDataContent`, `hasAppData`, `lockAppData`), `applesauce-common/factories` (`AppDataFactory` — see caveat) | Purpose-built NIP-78 support ships here already |
| `applesauce-relay` | `^6.0.3` (confirmed installed `6.0.3`) | `pool.publish(relays, event)`, `pool.subscription(relays, filter, opts)` | Already the app's one `RelayPool` singleton |
| `applesauce-signers` | `^6.0.1` | `NostrConnectSigner.buildSigningPermissions()`, the `nip44`/`nip04` interface shape | Already the only wired signer implementation |
| `applesauce-accounts` | `^6.0.0` | `NostrConnectAccount` (`BaseAccount.nip44`/`nip04` getters, `signEvent`) | Already the app's `signer$` value type |
| `rxjs` | `^7.8.2` | `debounceTime`, `distinctUntilChanged`, `combineLatest`, `switchMap` — all standard operators, no new import surface | Already the app's reactive backbone |

**No `## Alternatives Considered` table is needed** — this phase adds no new third-party choice; it is 100% additive usage of already-installed, already-used packages.

**Installation:**
```bash
# No install step. Everything below is available today via:
bun run index.ts   # already resolves applesauce-core/common/relay/signers/accounts
```

**Version verification (2026-07-07, read directly from `node_modules/*/package.json`):**
- `applesauce-core` — installed `6.1.0` [VERIFIED: local node_modules]
- `applesauce-common` — installed `6.1.0` [VERIFIED: local node_modules]
- `applesauce-relay` — installed `6.0.3` (per earlier codebase map; not independently re-checked this session, no change expected) [CITED: .planning/codebase/STACK.md]
- `applesauce-signers` — installed `6.0.1` [CITED: .planning/codebase/STACK.md]

### IMPORTANT: D2-03 premise correction (flag for planner/user, not auto-applied)

D2-03 says *"`applesauce-factory` is not installed and will not be added."* That's correct as literally stated — there is a **separate, legacy, standalone npm package literally named `applesauce-factory`** (currently at `4.3.0` on the npm registry [ASSUMED — checked via `npm view applesauce-factory version`, but this package's relationship/lineage to the current v6 monorepo was NOT independently verified this session; treat as informational only, not a recommendation to install it]). That package is correctly excluded.

**However**, in the v6 monorepo the app already depends on, the `EventFactory` builder class that `applesauce-factory` conceptually referred to now ships **inside `applesauce-core` itself**, at the import path `applesauce-core/factories` — already installed, already imported by nothing else in the app yet, but zero new `package.json` entries needed. `applesauce-common/factories` (also already installed) additionally re-exports an `AppDataFactory` subclass purpose-built for kind 30078.

This means the planner has three real options, not two:

| Option | New deps? | Matches D2-03 literal text? | Verified working? |
|---|---|---|---|
| **A. Fully manual** — raw `EventTemplate` object literal, `signer.signEvent()`, `signer.nip44.encrypt()` called directly | None | Yes, exactly | Yes — this is what NIP-46/NIP-44 always look like underneath |
| **B. `EventFactory.fromKind(30078)...encryptedContent(...).as(signer).sign()`** (bundled in `applesauce-core`, no new package) | None | Arguably yes — no *new* dependency is added, `applesauce-factory` (the actual npm package) is still not installed | **Yes — empirically confirmed in this session (see Sources)** |
| **C. `AppDataFactory.create(id, data, true).as(signer).sign()`** (bundled in `applesauce-common`) | None | Same as B | **No — confirmed broken this session, throws "Signer required for encrypted content"** (Pitfall 1) |

**Research does not resolve this for the planner** — it is presented as a flagged option since it materially affects task structure (Option A needs a hand-rolled tag/JSON/encrypt/sign sequence in `services/preferences.ts`; Option B needs the same sequence but via 5 chained builder calls). Given D2-03 is explicit and user-approved, **the Code Examples below default to Option A** (fully manual, matching the locked decision) with Option B shown as a verified, drop-in-compatible alternative in a callout.

## Package Legitimacy Audit

Not applicable — this phase adds **zero new npm packages**. All APIs used ship inside `applesauce-core@6.1.0`, `applesauce-common@6.1.0`, `applesauce-relay@6.0.3`, `applesauce-signers@6.0.1`, and `applesauce-accounts@6.0.0`, all already present in `package.json` and `bun.lock`.

**Packages removed due to [SLOP] verdict:** none — none were candidates.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```text
┌────────────────────────────────────────────────────────────────────────┐
│  Local edit (Datastar PATCH on /messages, /replies, /zaps, /groups,     │
│  /config)                                                                │
└───────────────────────────────┬──────────────────────────────────────-─┘
                                 │ config$.next({...current, ...patch})
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│ config$  (BehaviorSubject<AppConfig>, services/config.ts)               │
└───────┬──────────────────────────────────┬─────────────────────────────┘
        │ .pipe(skip(1))                   │ NEW: .pipe(skip(1), map(serializePrefs),
        ▼                                  │      distinctUntilChanged, debounceTime(1500))
┌──────────────────┐                       ▼
│ fs.writeFile      │        ┌──────────────────────────────────────────┐
│ config.json        │        │ services/preferences.ts — publish pipeline│
│ (unchanged,         │        │  skip if payload === lastKnownPayloadJSON │
│  D2-04 additive)    │        │  else: build+encrypt+sign+publish         │
└──────────────────┘        └───────────────┬──────────────────────────┘
                                             │ pool.publish(outboxRelays, signed30078)
                                             ▼
                                   ┌───────────────────┐
                                   │   Nostr relays      │
                                   │ (user's NIP-65       │
                                   │  outbox relays)       │
                                   └─────────┬─────────────┘
                                             │ live REQ subscription
                                             │ {kinds:[30078],authors:[pk],"#d":[ns]}
                                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│ services/preferences.ts — subscribe pipeline                            │
│  pool.subscription(...) -> onlyEvents() -> mapEventsToStore(eventStore) │
│  eventStore.replaceable({kind:30078,pubkey,identifier}) (mirrors groups$)│
│  -> combineLatest with signer$ -> switchMap(async) unlockAppData()      │
│  -> compare event.created_at > lastAppliedCreatedAt (HWM, D2-08)        │
│  -> mergePrefs(getConfig(), decrypted) -> updateConfig(merged)          │
│  -> ALSO set lastKnownPayloadJSON = serializePrefs(merged) (D2-09)      │
└───────────────────────────────┬──────────────────────────────────────-─┘
                                 │ updateConfig() -> config$.next(...)
                                 └──────────────► (feeds back into the top
                                                    config$ box — but publish
                                                    pipeline sees an unchanged
                                                    serialized payload and
                                                    no-ops; see Pitfall 5)
```

### Recommended Project Structure
```
helpers/
├── preferences.ts      # NEW — pure functions: serializePrefs, mergePrefs,
│                        #   PREFS_NAMESPACE, PREFS_VERSION consts.
│                        #   NO import of services/nostr.ts (mirrors helpers/groups.ts
│                        #   split; keeps this unit-testable per WR-04 precedent)
services/
├── preferences.ts      # NEW — RxJS wiring: publish-on-change + subscribe-and-apply.
│                        #   Imports services/nostr.ts (signer$, pool, eventStore,
│                        #   user$, mailboxes$) + services/config.ts (config$,
│                        #   getConfig, updateConfig) + helpers/preferences.ts.
│                        #   Exports enabled$ (config$ + signer$ gated) like other
│                        #   notifications/* modules, even though this isn't a
│                        #   notification listener — for /status or a UI hint to read.
const.ts                # SIGNER_PERMISSIONS expanded (D2-13) — but see Pitfall 4,
│                        #   must ALSO be wired into pages/signer.tsx (x2) and
│                        #   pages/home.tsx (x1)
pages/
├── signer.tsx           # pass permissions: SIGNER_PERMISSIONS to
│                        #   getNostrConnectURI() and NostrConnectSigner.fromBunkerURI()
├── home.tsx              # pass permissions: SIGNER_PERMISSIONS to getNostrConnectURI()
├── notifications.tsx     # (or signer.tsx) — no-signer sync hint (D2-12)
tests/
├── helpers/
│   └── preferences.test.ts   # unit tests for serializePrefs/mergePrefs — no nostr.ts import
└── fixtures/
    └── (reuse config-pre-modes.json style fixture if a config round-trip test is added)
```

### Pattern 1: Manual NIP-78 event construction + self-encrypt (D2-03 literal path)

**What:** Build the `EventTemplate` by hand, encrypt the JSON payload via the signer's `nip44` interface, sign, publish. This is Option A from the D2-03 table above.
**When to use:** Default — matches the locked decision exactly.
**Example (verified API shapes; encryption round-trip verified empirically):**
```typescript
// services/preferences.ts
import type { EventTemplate } from "applesauce-core/helpers/event";
import { unixNow } from "applesauce-core/helpers";
import { pool, signer$, user$, mailboxes$, eventStore } from "./nostr";
import { getConfig } from "./config";
import { log } from "./logs";
import { PREFS_NAMESPACE, PREFS_VERSION, serializePrefs } from "../helpers/preferences";

async function publishPrefs(): Promise<void> {
  const signer = signer$.value;
  if (!signer?.nip44) return; // D2-12/D2-14 — no signer or no nip44 support, stay local-only

  const ownPubkey = await signer.getPublicKey();
  const payload = { version: PREFS_VERSION, ...serializePrefs(getConfig()) };
  const plaintext = JSON.stringify(payload);

  // NIP-44 self-encrypt: encrypt TO your own pubkey (mirrors NIP-51/NIP-60 self-encrypt pattern)
  const ciphertext = await signer.nip44.encrypt(ownPubkey, plaintext);

  const template: EventTemplate = {
    kind: 30078,
    created_at: unixNow(),
    tags: [["d", PREFS_NAMESPACE]],
    content: ciphertext,
  };

  const signed = await signer.signEvent(template);

  const mailboxes = getConfig().pubkey ? undefined : undefined; // see mailboxes$ usage below for the real relay selection
  const relays = /* mailboxes$.outboxes ?? getConfig().lookupRelays, see D2-10 */ [];
  await pool.publish(relays, signed);
}
```
`signer.signEvent(template)` is `NostrConnectAccount.signEvent` (via `BaseAccount`), which wraps `NostrConnectSigner.signEvent` — a NIP-46 round trip requiring the `sign_event:30078` permission (D2-13). [VERIFIED: `node_modules/applesauce-accounts/dist/account.d.ts`, `node_modules/applesauce-signers/dist/signers/nostr-connect-signer.d.ts`]

### Pattern 2 (flagged alternative, not the locked default): `EventFactory` builder path

**What:** Use the bundled builder class instead of a raw object literal + manual encrypt call.
**When to use:** Only if the planner/user reopens D2-03 after reading the correction above.
**Example — empirically run and confirmed working in this session:**
```typescript
import { EventFactory } from "applesauce-core/factories";

const signed = await EventFactory.fromKind(30078)
  .modifyPublicTags((tags: string[][]) => [...tags, ["d", PREFS_NAMESPACE]])
  .encryptedContent(ownPubkey, JSON.stringify(payload), "nip44")
  .as(signer)
  .sign();
```
Output (from the actual test run against a `PrivateKeySigner`):
```json
{"kind":30078,"created_at":1783477375,"tags":[["d","test/ns2"]],"content":"AhoKX83pZhlM...","pubkey":"fa87...","id":"b8dc...","sig":"643e..."}
```
`.encryptedContent()` reads the signer lazily from the shared `_signerRef` at chain-execution time, so `.as(signer)` can be called before or after `.encryptedContent()` — order does not matter, only that it's set before `.sign()` resolves. [VERIFIED: ran `node_modules/applesauce-core/dist/factories/event.js` this session, see Sources]

**Do NOT use `AppDataFactory.create(id, data, true)`** for the write path (see Pitfall 1) — it is the one part of the bundled NIP-78 support that does not work correctly in the installed version.

### Pattern 3: Parameterized-replaceable read side (mirrors `groups$`)

**What:** Subscribe to the local `eventStore` copy of the 30078 event reactively.
**When to use:** Always — this is the D2-11-mandated pattern.
**Example:**
```typescript
// services/preferences.ts
import { combineLatest, EMPTY, switchMap } from "rxjs";
import { eventStore, user$, mailboxes$ } from "./nostr";
import { PREFS_NAMESPACE } from "../helpers/preferences";

/** Reactive value of the user's own kind-30078 prefs event, if any (mirrors groups$) */
export const preferencesEvent$ = combineLatest([user$, mailboxes$]).pipe(
  switchMap(([user]) =>
    user
      ? eventStore.replaceable({ kind: 30078, pubkey: user, identifier: PREFS_NAMESPACE })
      : EMPTY,
  ),
  // Cache value for 60s, same convention as groups$/mutedPubkeys$
  // shareAndHold(),
);
```
`eventStore.replaceable()` has **two overloads** — object form (used above, takes `identifier` explicitly for parameterized/addressable kinds) and a legacy positional form `replaceable(kind, pubkey, identifier?)`. Both accept the `d`-tag identifier as a first-class parameter — **no workaround needed** for 30078 being addressable rather than plain-replaceable. [VERIFIED: `node_modules/applesauce-core/dist/event-store/interface.d.ts:100-103`]
```typescript
// Overload 1 (recommended — used above)
replaceable(pointer: AddressPointerWithoutD): Observable<NostrEvent | undefined>;
// AddressPointerWithoutD = Omit<AddressPointer, "identifier"> & { identifier?: string }
//                        = { kind, pubkey, relays?, identifier? }

// Overload 2 (legacy positional — also valid)
replaceable(kind: number, pubkey: string, identifier?: string): Observable<NostrEvent | undefined>;
```

### Pattern 4: Live relay subscription + decrypt-in-switchMap (mirrors `mutedPubkeys$`)

**What:** A long-lived REQ so remote edits (from another device or a third-party web app) arrive promptly, decrypted reactively.
**When to use:** Always — required by D2-07/D2-11 for the "subscribe for updates" half of bidirectional sync.
**Example:**
```typescript
// services/preferences.ts
import { onlyEvents } from "applesauce-relay";
import { mapEventsToStore } from "applesauce-core";
import { combineLatest, NEVER, switchMap } from "rxjs";
import { pool, eventStore, user$, mailboxes$, signer$ } from "./nostr";
import { getConfig, updateConfig } from "./config";
import { log } from "./logs";
import {
  unlockAppData,
  getAppDataContent,
  isAppDataUnlocked,
} from "applesauce-common/helpers/app-data";
import { PREFS_NAMESPACE, mergePrefs, type SyncedPrefs } from "../helpers/preferences";

// Live REQ — feeds eventStore, which preferencesEvent$ (Pattern 3) reacts to.
combineLatest([user$, mailboxes$]).pipe(
  switchMap(([user, mailboxes]) => {
    if (!user) return NEVER;
    const relays = mailboxes?.outboxes?.length ? mailboxes.outboxes : getConfig().lookupRelays;
    return pool
      .subscription(
        relays,
        { kinds: [30078], authors: [user], "#d": [PREFS_NAMESPACE] },
        { reconnect: Infinity, resubscribe: true },
      )
      .pipe(onlyEvents(), mapEventsToStore(eventStore));
  }),
).subscribe();

let lastAppliedCreatedAt = 0;

// Apply inbound updates — mirrors mutedPubkeys$'s decrypt-in-switchMap(async) pattern.
combineLatest([preferencesEvent$, signer$]).pipe(
  switchMap(async ([event, signer]) => {
    if (!event || !signer) return;
    if (event.created_at <= lastAppliedCreatedAt) return; // D2-08 high-water-mark

    try {
      if (!isAppDataUnlocked(event)) await unlockAppData(event, signer);
      const data = getAppDataContent<SyncedPrefs>(event);
      if (!data) return;

      lastAppliedCreatedAt = event.created_at;
      const merged = mergePrefs(getConfig(), data);
      updateConfig(merged);
      // D2-09 loop-prevention hook — see Pattern 5
    } catch (error) {
      log("Failed to decrypt/apply remote notification preferences", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }),
).subscribe();
```
`unlockAppData`/`getAppDataContent`/`isAppDataUnlocked`/`hasAppData`/`lockAppData` from `applesauce-common/helpers/app-data` **are safe to use** (unlike `AppDataFactory`, they're read-side only, no signer-binding bug — this was independently re-verified: `unlockAppData(event, signer)` succeeded in the same test run that exercised Pattern 2). [VERIFIED: ran `node_modules/applesauce-common/dist/helpers/app-data.js` this session]

> **Import path note:** `applesauce-common/helpers/app-data` must be imported via its **deep path**, not the `applesauce-common/helpers` barrel — the barrel (`dist/helpers/index.d.ts`) does **not** re-export `app-data.js` [VERIFIED: read the barrel file directly, `app-data` is absent from its 43 `export *` lines]. This is consistent with the project's own convention of preferring deep imports (CONVENTIONS.md).

### Pattern 5: Loop-prevention via payload-equality, not a raw `skip(1)` (D2-09)

**What:** D2-09 explicitly warns against the `giftWraps$` `skip(1)` fragility (CONCERNS.md — a hardcoded count of "events to ignore" that breaks if the assumption about event count is wrong). A timing-based "just applied a remote update, ignore the next publish" flag has the same fragility for a **debounced** pipeline (the debounce delay means the flag would already be reset by the time the publish handler runs). The robust mechanism is a **payload-equality check**, not a counter or a flag:

```typescript
// helpers/preferences.ts — pure, no services/nostr import (see Pitfall 6)
import type { AppConfig } from "../services/config";

export const PREFS_NAMESPACE = "nostr-secretary/notification-prefs";
export const PREFS_VERSION = 1;

export type SyncedPrefs = {
  version: number;
  messages: { enabled: boolean; whitelists: string[]; blacklists: string[] };
  replies: { enabled: boolean; whitelists: string[]; blacklists: string[] };
  zaps: { enabled: boolean; whitelists: string[]; blacklists: string[] };
  groups: {
    enabled: boolean;
    whitelists: string[];
    blacklists: string[];
    modes: Record<string, string>;
  };
  whitelists: string[];
  blacklists: string[];
  appLink?: string;
};

/** D2-04 subset extraction. Deliberately omits messages.sendContent, groups.groupLink —
 *  see Open Questions. */
export function serializePrefs(config: AppConfig): SyncedPrefs {
  return {
    version: PREFS_VERSION,
    messages: {
      enabled: config.messages.enabled,
      whitelists: config.messages.whitelists,
      blacklists: config.messages.blacklists,
    },
    replies: { ...config.replies },
    zaps: { ...config.zaps },
    groups: {
      enabled: config.groups.enabled,
      whitelists: config.groups.whitelists,
      blacklists: config.groups.blacklists,
      modes: config.groups.modes,
    },
    whitelists: config.whitelists,
    blacklists: config.blacklists,
    appLink: config.appLink,
  };
}

/** D2-06 subset merge — never touches signer/pubkey/server/topic/email/lookupRelays. */
export function mergePrefs(current: AppConfig, incoming: SyncedPrefs): AppConfig {
  return {
    ...current,
    messages: { ...current.messages, ...incoming.messages },
    replies: incoming.replies,
    zaps: incoming.zaps,
    groups: { ...current.groups, ...incoming.groups },
    whitelists: incoming.whitelists,
    blacklists: incoming.blacklists,
    appLink: incoming.appLink ?? current.appLink,
  };
}
```

```typescript
// services/preferences.ts — publish pipeline, using serializePrefs for a stable diff key
import { combineLatest, debounceTime, distinctUntilChanged, map, skip } from "rxjs";
import config$, { getConfig } from "./config";
import { signer$ } from "./nostr";
import { serializePrefs } from "../helpers/preferences";

let lastKnownPayloadJSON: string | null = null; // set both after a successful publish AND after applying a remote update

config$
  .pipe(
    skip(1), // suppress the boot-time emission only (matches config.ts:126's own convention) — NOT the loop-prevention mechanism itself
    map(serializePrefs),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    debounceTime(1500), // D2-07 debounce window, Claude's discretion
  )
  .subscribe(async (payload) => {
    const json = JSON.stringify(payload);
    if (json === lastKnownPayloadJSON) return; // D2-09: this is an echo of what we already have on nostr — do not republish
    const signer = signer$.value;
    if (!signer?.nip44) return; // D2-12/D2-14

    // ... build/encrypt/sign/publish (Pattern 1 or 2) ...
    lastKnownPayloadJSON = json;
  });
```
When the subscribe pipeline (Pattern 4) applies an inbound update via `mergePrefs()` + `updateConfig()`, it should **also** set `lastKnownPayloadJSON = JSON.stringify(serializePrefs(merged))` immediately (synchronously, in the same handler) — so that when `config$` re-emits from that `updateConfig()` call, the publish pipeline's `distinctUntilChanged`/equality check sees a payload it already recognizes and no-ops, breaking the loop without any timing dependency.

### Anti-Patterns to Avoid
- **Reusing the `giftWraps$` `skip(1)`/count-based idiom for loop prevention:** CONCERNS.md documents this exact idiom as fragile (`services/nostr.ts:213-236`) — it assumes a specific number of historical events and silently misbehaves if that assumption is wrong. D2-09 calls this out explicitly. Use payload-equality (Pattern 5) instead.
- **Calling `signer.nip44.encrypt`/`.decrypt`/`.signEvent` without a `timeout()`:** `NostrConnectSigner.makeRequest` has no built-in timeout — an unsupported or unresponsive bunker call **hangs forever** (Pitfall 3). Every existing signer-adjacent async call in this codebase that can stall already gets a `timeout({first, with})` wrapper (`helpers/lists.ts`, `helpers/groups.ts`, `services/nostr.ts:290,116`) — follow that convention here too.
- **`AppDataFactory.create(id, data, true)`:** confirmed broken (Pitfall 1) — throws even with a valid signer supplied via `.as()`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parsing/decrypting an app-data event's JSON content | A custom `JSON.parse(await signer.nip44.decrypt(...))` wrapper | `applesauce-common/helpers/app-data`'s `unlockAppData`/`getAppDataContent`/`isAppDataUnlocked` | Already handles the nip04-vs-nip44 detection (`getAppDataEncryption`), caches the decrypted result on the event's symbol (so re-renders/re-subscribes don't re-decrypt), and is the exact mechanism the SDK author intends other apps to interoperate with for kind 30078 — directly serves the "let other simple web apps modify them" interop goal from the phase boundary |
| A parameterized-replaceable reactive query | Manual `eventStore` event filtering/sorting by `created_at` | `eventStore.replaceable({kind, pubkey, identifier})` | Already handles replaceable-event semantics (NIP-01), already the pattern used by `groups$`/`messageInboxes$`/`mutedPubkeys$` |
| A signer round-trip timeout | Custom `Promise.race([...])` boilerplate per call site | RxJS `timeout({first: N, with: () => of(fallback)})`, same as `helpers/lists.ts:15`, `helpers/groups.ts:21`, `services/nostr.ts:290` | Established codebase convention; keeps behavior consistent with every other signer-adjacent call |

**Key insight:** The one thing genuinely worth hand-rolling here is the **loop-prevention payload-diff logic** (Pattern 5) — there is no library primitive for "did my own publish just come back to me," and the existing in-repo `giftWraps$` attempt at solving an adjacent problem (skip-N) is explicitly flagged as the wrong approach to copy.

## Common Pitfalls

### Pitfall 1: `AppDataFactory.create(id, data, true)` throws "Signer required for encrypted content" even with `.as(signer)` set
**What goes wrong:** `AppDataFactory.data()` calls the module-level `setContent(data, encryption)` helper **without** passing a signer, and that helper's returned closure captures `signer = undefined` permanently at `.create()`-call time — it is never re-read from the `.as(signer)`-populated `_signerRef` later in the chain.
**Why it happens:** `AppDataFactory.data()`'s implementation differs from the base `EventFactory.encryptedContent()` method: the latter correctly reads `this.signer` (the shared, mutable `_signerRef`) *lazily*, at chain-execution time; the former reads a fixed closure argument.
**How to avoid:** Do not call `.data(data, true)`/`.data(data, "nip44")` on `AppDataFactory` when a signer is needed. Use `EventFactory.fromKind(30078)....encryptedContent(pubkey, json, "nip44").as(signer).sign()` instead (Pattern 2), or the fully-manual path (Pattern 1, matching D2-03).
**Warning signs:** `Error: Signer required for encrypted content` thrown from inside `applesauce-core/operations/hidden-content.js`'s `setHiddenContent`, even though a signer was demonstrably passed via `.as()`.

### Pitfall 2: `eventStore.replaceable()`'s legacy positional form silently accepts a missing identifier for an addressable kind
**What goes wrong:** `replaceable(kind, pubkey)` (2-arg form, omitting `identifier`) type-checks fine (identifier is optional in both overloads) but for an addressable kind like 30078, an event store may hold multiple d-tag'd 30078 events for the same pubkey (this app's own prefs event plus, potentially, other apps' unrelated 30078 events for the same user if the store is ever shared). Omitting `identifier` risks matching the wrong one.
**Why it happens:** The type signature doesn't force you to supply `identifier` for an addressable kind — it's optional in the TS types regardless of kind.
**How to avoid:** Always pass `identifier: PREFS_NAMESPACE` (object form, Pattern 3) or the 3rd positional arg, never rely on the 2-arg form for kind 30078.
**Warning signs:** Preferences intermittently reverting/showing stale data if any other 30078-kind data is ever introduced into the same `eventStore`.

### Pitfall 3: `signer.nip44` is never `undefined` for `NostrConnectAccount` — D2-14's null-check premise doesn't hold, and unsupported calls can hang forever
**What goes wrong:** `NostrConnectSigner`'s constructor unconditionally assigns `this.nip44 = { encrypt: this.nip44Encrypt.bind(this), decrypt: this.nip44Decrypt.bind(this) }` — regardless of whether the connected bunker actually supports NIP-44. `BaseAccount.nip44` (the getter `NostrConnectAccount` inherits) just forwards `this.signer.nip44`, so `signer$.value?.nip44` is **always truthy** for the only wired signer type. Calling `.encrypt()`/`.decrypt()` sends a NIP-46 round trip (`makeRequest`) that resolves only when a matching response event arrives; **there is no built-in timeout**, and if the bunker doesn't implement/authorize the method and doesn't send back an explicit error response, the returned promise hangs forever.
**Why it happens:** `applesauce-signers@6.0.1`'s `NostrConnectSigner` always exposes the `nip44`/`nip04` interface shape as a client-side convenience (so `ISigner` typing is uniform); actual capability is a **bunker-side runtime property, not a client-side type property**.
**How to avoid:** Do not gate on `signer.nip44 === undefined`. Instead: (1) always wrap the actual `.encrypt()`/`.decrypt()`/`.signEvent()` calls in an explicit `timeout({first: N, with: () => of(undefined)})` (or `Promise.race` with a manual timer, matching the app's existing non-RxJS async call sites), and (2) treat a rejection **or** a timeout as "bunker doesn't support this — degrade to local-only + notice," per D2-12/D2-15.
**Warning signs:** The prefs-sync publish pipeline appears to silently freeze (the `switchMap`'s inner promise never resolves, so no further `config$` emissions are processed by that pipeline) with an older/limited bunker.

### Pitfall 4: `SIGNER_PERMISSIONS` (`const.ts:11-13`) is dead code — expanding it alone does nothing
**What goes wrong:** `const.ts` defines `SIGNER_PERMISSIONS = NostrConnectSigner.buildSigningPermissions([kinds.ClientAuth])`, but grepping the entire codebase shows **zero call sites reference it**. `pages/signer.tsx:33` (`getNostrConnectURI({ name: "Nostr Secretary" })`), `pages/home.tsx:256` (same), and `pages/signer.tsx:312` (`NostrConnectSigner.fromBunkerURI(bunkerUri.trim())`) all omit the `permissions` field entirely. Today, every new signer connection requests **no explicit permissions at all** — behavior depends entirely on the connecting bunker's own default policy (grant-all, ask-every-time, etc.).
**Why it happens:** Pre-existing gap, unrelated to this phase, but directly blocks D2-13: expanding the constant's *contents* has zero runtime effect unless the constant is also *passed* to the 3 signer-creation call sites.
**How to avoid:** This phase's D2-13 task must (a) expand `SIGNER_PERMISSIONS` to include `sign_event:30078`, `nip44_encrypt`, `nip44_decrypt`, AND (b) add `permissions: SIGNER_PERMISSIONS` to `getNostrConnectURI()` (both call sites) and to the `options` object of `NostrConnectSigner.fromBunkerURI(uri, { permissions: SIGNER_PERMISSIONS })`.
**Warning signs:** A freshly-connected bunker still prompts for approval on every `signEvent`/`nip44.encrypt` call, or grants broader access than intended, because no permission list was ever actually requested.

**Exact permission-string construction** [VERIFIED: `node_modules/applesauce-signers/dist/helpers/nostr-connect.js:94-97`]:
```typescript
// buildSigningPermissions(kinds) => [Permission.GetPublicKey, ...kinds.map(k => `sign_event:${k}`)]
// i.e. NostrConnectSigner.buildSigningPermissions([kinds.ClientAuth, 30078])
//   === ["get_public_key", "sign_event:22242", "sign_event:30078"]
// "nip44_encrypt" / "nip44_decrypt" are separate literal strings, NOT produced by
// buildSigningPermissions() — must be appended manually:
export const SIGNER_PERMISSIONS = [
  ...NostrConnectSigner.buildSigningPermissions([kinds.ClientAuth, 30078]),
  "nip44_encrypt",
  "nip44_decrypt",
];
```
**Already-connected signers:** `applesauce-signers@6.0.1`'s `NostrConnectSigner` class exposes no "re-request permissions on an existing session" method (its public surface is `connect`, `waitForSigner`, `createAccount`, `requireConnection`, `getPublicKey`, `signEvent`, `nip04Encrypt/Decrypt`, `nip44Encrypt/Decrypt`, `ping`, `switchRelays`, `getNostrConnectURI`, `fromBunkerURI` — no `requestPermissions`/`addPermissions`). [VERIFIED: full class surface read from `.d.ts`, see Sources] Practically: an already-connected bunker was only ever asked for the OLD permission set (or nothing, per Pitfall 4). This phase's `signEvent`/`nip44.encrypt` calls against such a session will either prompt the user in the bunker app (if it supports ask-per-call) or fail/hang (Pitfall 3). **Recommendation:** catch the failure/timeout, log it, and surface a UI notice like "Reconnect your signer to enable settings sync" pointing at `/signer`'s disconnect+reconnect flow — there is no silent re-grant path available in this SDK version.

### Pitfall 5: The `applyingRemote` boolean-flag guard doesn't work with a debounced pipeline
**What goes wrong:** A natural first instinct for D2-09 is a module-level `let applyingRemote = false` flag, set `true` right before `updateConfig()` in the subscribe pipeline and `false` right after, checked in the publish pipeline. Because the publish pipeline is **debounced** (1-2s per D2-07), the flag is already back to `false` by the time the debounce window elapses and the publish handler actually runs — the flag never has a chance to suppress anything, and you're back to a republish loop.
**Why it happens:** `debounceTime` decouples the timing of "config changed" from "act on it" — any guard based on synchronous before/after timing around the *change* doesn't survive to the *action*.
**How to avoid:** Use the payload-equality check (Pattern 5) instead of a timing flag — compare the actual serialized content, not "did something change recently."
**Warning signs:** Preferences republish every ~1.5s in a loop whenever a remote update is applied, visible as repeated `pool.publish` calls / repeated `created_at` bumps in relay logs.

### Pitfall 6: Importing `services/nostr.ts` (directly or transitively) breaks pure-function unit tests
**What goes wrong:** `services/nostr.ts` instantiates a real `RelayPool` and opens live relay connections **at module-import time** (documented in ARCHITECTURE.md's "Cold-start config load is async top-level await" and CONCERNS.md's "`services/nostr.ts` is a side-effecting singleton module"). The existing test suite already hit this: `tests/notifications/groups.test.ts` explicitly does **not** import `notifications/groups.ts` because it transitively imports `services/nostr.ts`, and documents the resulting coverage gap as a tracked follow-up (WR-04).
**Why it happens:** No dependency injection — every consumer imports the process-wide singleton directly (documented architectural constraint, not a bug to fix in this phase).
**How to avoid:** Keep `serializePrefs`/`mergePrefs`/any other pure logic in `helpers/preferences.ts` with **zero import of `services/nostr.ts`** (mirrors the existing `helpers/groups.ts` split — pure predicate functions separate from `notifications/groups.ts`'s wiring). Unit-test `helpers/preferences.ts` directly, following `tests/helpers/groups.test.ts`'s style. Do not attempt to unit-test `services/preferences.ts`'s RxJS wiring itself — follow the WR-04 precedent of documenting that as an accepted, tracked gap rather than importing `services/nostr.ts` into a test file.
**Warning signs:** A test file importing `services/preferences.ts` (or anything that imports `services/nostr.ts`) opens real WebSocket connections during `bun test`, causing hangs, flakiness, or unwanted network calls in CI.

### Pitfall 7: Empty `mailboxes$.outboxes` at publish/subscribe time (new users, or `mailboxes$`'s 10s timeout firing)
**What goes wrong:** `mailboxes$` (`services/nostr.ts:88-99`) is `undefined` until the user's NIP-65 list resolves, and — per CONCERNS.md — **silently completes** after a 10s `simpleTimeout` if it can't be loaded, meaning downstream `combineLatest` pipelines relying on it may simply stop emitting rather than emitting `undefined`.
**Why it happens:** Pre-existing, documented fragility in `mailboxes$`, not new to this phase, but this phase adds two more consumers of it (Pattern 3's `preferencesEvent$` and Pattern 4's live subscription).
**How to avoid:** Per D2-10, fall back to `getConfig().lookupRelays` whenever `mailboxes?.outboxes` is empty/undefined — do this explicitly at the point of use (as shown in Pattern 4), don't assume `mailboxes$` always eventually emits a non-empty value.
**Warning signs:** A brand-new user (no kind 10002 relay list published yet) never gets their prefs published/subscribed at all, with no error surfaced.

### Pitfall 8: `messages.sendContent` and `groups.groupLink` are ambiguous re: D2-04 scope
**What goes wrong:** D2-04 lists `messages` as syncable "including... each section's `enabled`/`whitelists`/`blacklists`" — it does not mention `messages.sendContent` (a boolean controlling whether decrypted DM plaintext is sent to the ntfy server) or `groups.groupLink` (a URL template) by name. Naively spreading the whole `messages`/`groups` sub-objects into the synced payload would silently sync these too.
**Why it happens:** D2-04's enumeration is at the "which top-level sections" granularity, not exhaustive per-field.
**How to avoid:** See Open Questions — this research recommends explicitly excluding `sendContent` (security-sensitive per-device choice; CONCERNS.md already flags plaintext-DM-to-ntfy as a risk, and syncing this flag could silently turn it on for a device the user didn't intend) and `groupLink` (a per-installation UI template, not a notification *rule*) from the synced subset, matching the `serializePrefs`/`mergePrefs` implementation in Pattern 5. Flag this explicitly for user confirmation during planning/discuss if not already settled.
**Warning signs:** A user enables `sendContent` on one device and finds DM plaintext silently starts flowing to ntfy from a different device's connection to the same account.

## Code Examples

### Full happy-path publish (manual/D2-03 path, Pattern 1 + Pattern 5 combined)
```typescript
// Source: synthesized from verified applesauce-core/relay/signers/accounts APIs
// (see Sources) + this project's own services/nostr.ts conventions.
import { unixNow } from "applesauce-core/helpers";
import type { EventTemplate } from "applesauce-core/helpers/event";
import { timeout } from "rxjs";
import { firstValueFrom, of } from "rxjs";
import { pool, signer$, mailboxes$ } from "./nostr";
import { getConfig } from "./config";
import { log } from "./logs";
import { PREFS_NAMESPACE, PREFS_VERSION, serializePrefs } from "../helpers/preferences";

async function publishPreferences(): Promise<void> {
  const signer = signer$.value;
  if (!signer?.nip44) return; // Pitfall 3: this check only filters "no signer at all"

  try {
    const ownPubkey = await signer.getPublicKey();
    const payload = { version: PREFS_VERSION, ...serializePrefs(getConfig()) };
    const plaintext = JSON.stringify(payload);

    // Wrap the round-trip in a timeout — Pitfall 3 (no built-in timeout in NostrConnectSigner)
    const ciphertext = await Promise.race([
      signer.nip44.encrypt(ownPubkey, plaintext),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("nip44.encrypt timed out")), 8000),
      ),
    ]);

    const template: EventTemplate = {
      kind: 30078,
      created_at: unixNow(),
      tags: [["d", PREFS_NAMESPACE]],
      content: ciphertext,
    };

    const signed = await Promise.race([
      signer.signEvent(template),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("signEvent timed out")), 8000),
      ),
    ]);

    const mailboxes = await firstValueFrom(
      mailboxes$.pipe(timeout({ first: 3000, with: () => of(undefined) })),
    );
    const relays = mailboxes?.outboxes?.length ? mailboxes.outboxes : getConfig().lookupRelays;

    await pool.publish(relays, signed);
    log("Published notification preferences", { created_at: signed.created_at });
  } catch (error) {
    // D2-15: never block/lose the local save; log and move on
    log("Failed to publish notification preferences", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| NIP-04 encryption for self-encrypted app data | NIP-44 v2 | NIP-44 spec finalized ~2023; `applesauce-common`'s own `app-data.js` defaults kind 30078's `setHiddenContentEncryptionMethod` to `"nip44"` | D2-02 already correctly locks NIP-44; this is confirmed as the library's own default too, not just the user's preference [VERIFIED: `node_modules/applesauce-common/dist/helpers/app-data.js:9`] |
| Standalone `applesauce-factory` npm package for event building | `EventFactory` bundled into `applesauce-core/factories` (and NIP-specific subclasses/blueprints into `applesauce-common/factories`) | Applesauce v6 monorepo restructure (already-installed version) | See "IMPORTANT: D2-03 premise correction" above — the concept D2-03 declined ("applesauce-factory") is now bundled, not a separate install |

**Deprecated/outdated:** NIP-04 for any new encrypted-content design — already correctly avoided by D2-02.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | The standalone npm package `applesauce-factory@4.3.0` is unrelated/legacy relative to the v6 monorepo's bundled `EventFactory`, and is correctly excluded per D2-03 | "IMPORTANT: D2-03 premise correction" | Low — this phase does not recommend installing it either way; the distinction is informational only, doesn't change any code produced |
| A2 | A remote NIP-46 bunker that rejects an unsupported/unauthorized method sends an explicit `response.error` (fast rejection) in *most* implementations, but *some* may simply not respond at all (hang) — this was reasoned from `NostrConnectSigner.handleEvent`'s code path, not tested against a real third-party bunker this session | Pitfall 3 | Medium — if wrong in the "always errors fast" direction, the recommended defensive `timeout()` wrapper is still harmless (a no-op safety net); if wrong in the other direction (bunkers never hang), the timeout is unnecessary but still harmless |
| A3 | `groups.groupLink` and `messages.sendContent` should be excluded from the synced payload (not explicitly settled by D2-04's wording) | Pitfall 8, Pattern 5's `serializePrefs` | Medium — if the user actually wants these synced, `mergePrefs`/`serializePrefs` need a one-line change; flagged in Open Questions for explicit confirmation before/during planning |
| A4 | `applesauce-relay@6.0.3` and `applesauce-signers@6.0.1` (not independently re-verified against `node_modules` this session, taken from `.planning/codebase/STACK.md`) match what's actually installed | Standard Stack | Low — `applesauce-core`/`applesauce-common` versions WERE independently re-verified and matched STACK.md exactly; no reason to expect drift on the others |

**If this table is empty:** N/A — see rows above.

## Open Questions

1. **Should `groups.groupLink` and `messages.sendContent` sync?**
   - What we know: D2-04 lists `messages`/`groups` as syncable "sections" but only explicitly names `enabled`/`whitelists`/`blacklists` as included sub-fields; `appLink` (top-level) is explicitly included.
   - What's unclear: Whether the omission of `sendContent`/`groupLink` from D2-04's explicit list was intentional exclusion or just non-exhaustive phrasing.
   - Recommendation: Exclude both by default (Pattern 5's `serializePrefs` already does this, with rationale in Pitfall 8) — `sendContent` for security-sensitivity (device-specific, and syncing it could silently enable DM-plaintext-to-ntfy on a device the user didn't intend), `groupLink` because it's a UI template, not a rule. Confirm with the user during `/gsd-discuss-phase` or in the plan review if not already settled.

2. **Should the planner reopen D2-03 given the `EventFactory` finding?**
   - What we know: A verified-working, zero-new-dependency `EventFactory.encryptedContent()` builder path exists (Pattern 2) that is arguably a cleaner middle ground than fully-manual `EventTemplate` construction, without violating "don't add `applesauce-factory`" (the literal npm package that name refers to really is a different, non-installed thing).
   - What's unclear: Whether the user's D2-03 intent was specifically "no builder abstraction, hand-roll it" (in which case Pattern 1 is correct regardless) or "don't add a new dependency" (in which case Pattern 2 is also compliant).
   - Recommendation: Default to Pattern 1 (fully manual) since it unambiguously satisfies the locked decision as written; mention Pattern 2 as available if the planner wants a less error-prone builder chain. Either is fine functionally — this is a code-shape preference, not a behavior difference.

3. **What timeout duration for signer round-trips (`signEvent`, `nip44.encrypt/decrypt`)?**
   - What we know: The codebase's existing signer-adjacent timeouts vary — `helpers/lists.ts`/`helpers/groups.ts` use 2000ms, `mailboxes$`/`messageInboxes$` use 10_000ms, `isMuted` uses 2000ms. NIP-46 round trips over relays (not local) are likely to need more headroom than an in-memory event-store lookup.
   - What's unclear: No existing precedent in this codebase for a *signing* round trip specifically (today's only `signEvent` calls are for NIP-42 relay AUTH, which has no explicit per-call timeout either — see CONCERNS.md's related note on `signer$` having no error path).
   - Recommendation: 8-10s per attempt (generous enough for a bunker on a mobile device with app-switch latency, per the qualitative examples above), left to planner's judgment; this is a UX tuning knob, not a correctness question.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| NIP-46 remote signer (bunker) connectivity | NIP-44 encrypt/decrypt, `sign_event:30078` | Not guaranteed — user-dependent, checked at runtime via `signer$` | n/a | D2-12: local-only persistence (existing `config.json` behavior, unchanged) |
| Bunker NIP-44 support specifically | Self-encryption of the prefs payload | Not guaranteed even when a signer IS connected (Pitfall 3) | n/a | Same as above — catch/timeout and degrade, per D2-12/D2-14/D2-15 |
| User's NIP-65 outbox relay list (`mailboxes$`) | Choosing publish/subscribe relays (D2-10) | Not guaranteed for brand-new users (Pitfall 7) | n/a | `getConfig().lookupRelays` (existing `DEFAULT_LOOKUP_RELAYS` fallback) |

**Missing dependencies with no fallback:** None — every dependency in this phase has an explicit, already-decided fallback (local-only persistence is the ultimate fallback for the entire nostr-sync feature).

**Missing dependencies with fallback:** All three rows above.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `bun:test` (Bun's built-in test runner) |
| Config file | `bunfig.toml` (`[test] preload = ["./tests/setup.ts"]`) |
| Quick run command | `bun test tests/helpers/preferences.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| D2-04/D2-05/D2-06 | `serializePrefs()` extracts exactly the D2-04 rules subset, excludes `signer`/`pubkey`/`server`/`topic`/`email`/`lookupRelays` | unit | `bun test tests/helpers/preferences.test.ts -t serializePrefs` | ❌ Wave 0 |
| D2-06 | `mergePrefs()` preserves local-only fields (signer/pubkey/ntfy config) while overwriting synced fields | unit | `bun test tests/helpers/preferences.test.ts -t mergePrefs` | ❌ Wave 0 |
| D2-08 | High-water-mark comparison: an event with `created_at <= lastAppliedCreatedAt` is ignored | unit | `bun test tests/helpers/preferences.test.ts -t "high.water.mark"` | ❌ Wave 0 |
| D2-09 | Payload-equality check: `serializePrefs(mergedConfig)` round-trips to an identical JSON string as the just-applied remote payload (loop-prevention precondition) | unit | `bun test tests/helpers/preferences.test.ts -t "loop prevention"` | ❌ Wave 0 |
| D2-13 | `SIGNER_PERMISSIONS` includes `sign_event:30078`, `nip44_encrypt`, `nip44_decrypt` | unit | `bun test tests/const.test.ts` (new, tiny) | ❌ Wave 0 |
| D2-01/D2-02/D2-03 | Manual event construction round-trips through NIP-44 self-encrypt/decrypt (using a `PrivateKeySigner` test double, not a live bunker) | unit/integration | `bun test tests/helpers/preferences.test.ts -t "event round-trip"` | ❌ Wave 0 |
| D2-11/D2-12/D2-14 | Live subscribe-and-apply wiring in `services/preferences.ts` | manual-only | n/a — per Pitfall 6, `services/nostr.ts`'s live-relay side effects make this untestable at the unit level without a DI refactor out of scope for this phase (WR-04 precedent) | n/a |

### Sampling Rate
- **Per task commit:** `bun test tests/helpers/preferences.test.ts`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/helpers/preferences.test.ts` — covers `serializePrefs`, `mergePrefs`, high-water-mark comparison, payload-equality loop-prevention precondition, and a `PrivateKeySigner`-based NIP-44 encrypt/decrypt round-trip of a real `EventTemplate` (kind 30078) — this last one is the closest available "integration-lite" test since `services/nostr.ts` can't be safely imported (Pitfall 6); use `applesauce-signers`' `PrivateKeySigner` directly (already installed, already used by other packages' own test suites, confirmed importable and functional in this session's empirical test).
- [ ] `tests/const.test.ts` (new, tiny) — asserts `SIGNER_PERMISSIONS` contains the three new permission strings, catching accidental regressions to the dead-constant state (Pitfall 4).
- Framework install: none — `bun:test` + existing `bunfig.toml` preload already cover this phase's needs.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | No | No new auth surface — this phase doesn't touch the (already-flagged, out-of-scope) lack of HTTP auth |
| V3 Session Management | No | N/A |
| V4 Access Control | No | N/A |
| V5 Input Validation | Yes | Decrypted remote payload (`getAppDataContent<SyncedPrefs>(event)`) is **untrusted input** — it can come from any relay, any client that has the user's pubkey and can produce a validly-signed, validly-self-encrypted event (which, notably, includes the user's own other devices/apps, by design — that's the interop goal — but also means a compromised or malicious "other simple web app" the user authorized could inject arbitrary JSON). `mergePrefs()` must validate shape/types before merging into `config$`, reusing the existing `isGroupNotificationMode()`-style narrowing pattern from `helpers/groups.ts` for the `groups.modes` map, and defensively coercing/rejecting unexpected types for `whitelists`/`blacklists`/`enabled` fields rather than trusting `JSON.parse` output blindly. |
| V6 Cryptography | Yes | NIP-44 v2 via the signer's `nip44.encrypt`/`decrypt` — never hand-roll crypto; this phase correctly delegates to the signer implementation (D2-02) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| Malformed/malicious inbound 30078 payload (e.g. `groups.modes` containing non-string-union values, or `whitelists` containing non-pubkey garbage) silently corrupting `config$` | Tampering | Validate/narrow every field in `mergePrefs()` before merge, following the `isGroupNotificationMode()` precedent from Phase 1 (`helpers/groups.ts`) — reject or drop unrecognized shapes rather than trusting them |
| A relay serving a stale/replayed older 30078 event after a newer one was already applied | Tampering / Denial of Service (settings "roll back" unexpectedly) | D2-08's `created_at` high-water-mark check (Pattern 4) already defends against this — do not skip it |
| Decrypted plaintext prefs content (post-`unlockAppData`) accidentally logged in full via `log(message, details)` | Information Disclosure | Log only summary fields (e.g., `created_at`, boolean flags) via `log()`, never the full decrypted payload or the raw ciphertext `.content` string, mirroring how `services/nostr.ts:304-306` logs only `error.message` on mute-list decrypt failure, not event content |
| An "other simple web app" (an explicit interop goal of this phase) authorized only for read access nonetheless being able to publish a kind 30078 event with the `nostr-secretary/notification-prefs` `d`-tag, since NIP-78 has no built-in write-ACL beyond "who controls the pubkey" | Tampering | Out of scope for this phase (inherent to the self-encrypt-to-self NIP-78 model — anyone with `sign_event`+`nip44_encrypt` permission on the user's bunker can write this event, same as any other kind). Not a regression this phase introduces; flag as accepted risk consistent with the phase's own interop goal. |

## Sources

### Primary (HIGH confidence — read directly from installed `node_modules/applesauce-*@6.1.0`/`6.0.x` source this session, some additionally confirmed by executing real code)
- `node_modules/applesauce-core/dist/event-store/interface.d.ts` — `replaceable()` two-overload signature (object form with `identifier`, legacy positional form)
- `node_modules/applesauce-core/dist/factories/event.js` + `.d.ts` — `EventFactory` class: `.as()`, `.chain()`, `.encryptedContent()` (lazy signer read via shared `_signerRef`), `.sign()`, `.modifyPublicTags()`
- `node_modules/applesauce-core/dist/operations/hidden-content.js`/`.d.ts`, `node_modules/applesauce-core/dist/operations/encrypted-content.js`/`.d.ts` — `setHiddenContent`/`setEncryptedContent` eager-vs-lazy signer binding (root cause of Pitfall 1)
- `node_modules/applesauce-common/dist/helpers/app-data.js`/`.d.ts` — `APP_DATA_KIND = 30078`, `hasAppData`, `getAppDataEncryption`, `isAppDataUnlocked`, `getAppDataContent`, `unlockAppData`, `lockAppData`; confirms `setHiddenContentEncryptionMethod(APP_DATA_KIND, "nip44")` default
- `node_modules/applesauce-common/dist/factories/app-data.js`/`.d.ts` — `AppDataFactory.create`/`.modify`/`.data()` (source of the confirmed encryption bug)
- `node_modules/applesauce-common/dist/factories/index.d.ts`, `node_modules/applesauce-common/dist/helpers/index.d.ts` — barrel export contents (confirms `app-data` is in the factories barrel but NOT the helpers barrel — deep import required for helpers)
- `node_modules/applesauce-signers/dist/signers/nostr-connect-signer.d.ts`/`.js` — full `NostrConnectSigner` class surface, `nip44`/`nip04` always-present-object construction, `makeRequest`'s no-timeout Deferred pattern, `handleEvent`'s error-response handling
- `node_modules/applesauce-signers/dist/helpers/nostr-connect.js`/`.d.ts` — `Permission` enum (`sign_event`, `nip44_encrypt`, `nip44_decrypt` literal strings), `buildSigningPermissions()` implementation, `NostrConnectAppMetadata.permissions` field
- `node_modules/applesauce-accounts/dist/account.d.ts` — `BaseAccount.nip44`/`.nip04` getters (forward to `this.signer.nip44`), `.signEvent()`
- `node_modules/applesauce-accounts/dist/accounts/nostr-connect-account.d.ts` — `NostrConnectAccount` extends `BaseAccount<NostrConnectSigner, ...>`
- `node_modules/applesauce-relay/dist/pool.d.ts` — `pool.publish(relays, event, opts?): Promise<PublishResponse[]>`, `PublishResponse = {ok, message?, from}`
- **Executed code this session** (via `bun run` against the project's real `node_modules`, using a throwaway `PrivateKeySigner`): confirmed `AppDataFactory.create(id, data, true).as(signer).sign()` throws "Signer required for encrypted content"; confirmed `EventFactory.fromKind(30078).modifyPublicTags(...).encryptedContent(pubkey, json, "nip44").as(signer).sign()` succeeds and produces a valid signed event; confirmed `unlockAppData(event, signer)` correctly decrypts that event back to the original plaintext object.
- Direct repo reads: `services/config.ts`, `services/nostr.ts`, `const.ts`, `pages/signer.tsx`, `pages/home.tsx`, `helpers/groups.ts`, `notifications/groups.ts`, `tests/setup.ts`, `tests/services/config.test.ts`, `tests/helpers/groups.test.ts`, `tests/notifications/groups.test.ts`, `bunfig.toml`, `package.json` — all HIGH confidence, ground truth for the current codebase.

### Secondary (MEDIUM confidence)
- `~/.claude/skills/applesauce/references/*` (encryption.md, packages/signers.md, packages/core.md) — general guidance, consulted first but insufficiently specific for this phase's exact API questions; superseded by the direct `node_modules` reads above wherever they overlap.
- `npm view applesauce-factory version` → `4.0.0` (registry check confirming the standalone package's existence and current version) — used only to support the "IMPORTANT: D2-03 premise correction" callout, not to recommend installing it.

### Tertiary (LOW confidence)
- None used as load-bearing claims — every non-trivial claim in this document is backed by a Primary source above.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, all versions read directly from installed `node_modules`
- Architecture (event build/read/subscribe patterns): HIGH — every code pattern shown either mirrors an existing, working pattern in this exact codebase (`groups$`/`mutedPubkeys$`/`giftWraps$`) or was executed and its output inspected this session
- Pitfalls: HIGH for #1, #2, #3, #4, #6, #7 (all directly sourced from reading/running the actual installed code or the actual repo); MEDIUM for #5 (reasoned from RxJS operator semantics, not independently executed as a failing-then-fixed test) and #8 (a scope-interpretation flag, not a code fact)

**Research date:** 2026-07-07
**Valid until:** 30 days (stable, self-contained applesauce v6.1.x API surface; re-verify if `applesauce-core`/`applesauce-common` are bumped past `6.1.x` before this phase is implemented, since Pitfall 1's bug could be fixed upstream)
