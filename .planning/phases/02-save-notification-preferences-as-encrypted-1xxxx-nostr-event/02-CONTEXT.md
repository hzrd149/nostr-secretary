# Phase 2: Save notification preferences as encrypted 1xxxx nostr event - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey areas proposed in batch, user decided the 4 product choices; technical best-practices at Claude's discretion.

<domain>
## Phase Boundary

Persist the user's notification **preferences** (notification rules — the per-type
enabled flags, whitelists/blacklists, and per-group modes from Phase 1) as an
**encrypted replaceable Nostr event** so settings:
- survive restarts (already true via `config.json`; nostr adds off-device durability),
- sync across devices/clients over nostr,
- can be modified by other simple web apps, and
- can be subscribed to by the notification server for live updates.

Ships:
- A new preferences service that (a) serializes the synced subset of `AppConfig`,
  NIP-44-encrypts it to the user's own pubkey, signs it as a kind **30078** (NIP-78)
  replaceable event, and publishes it to the user's outbox relays on change; and
  (b) subscribes to that event and applies remote updates back into `config$`.
- Expanded NIP-46 signer permissions so the connected bunker will sign the new
  kind and perform NIP-44 encrypt/decrypt.
- Graceful degradation to local-only persistence when no signer is connected.

**Not in this phase:** DM work (Phases 3–5), rate limiting (Phases 6–7), a
web "guided setup" or config-page redesign (backlog 999.x). No change to the
existing `config.json` local-persistence behavior — nostr sync is additive.

</domain>

<decisions>
## Implementation Decisions

### Event format & encryption
- **D2-01 (kind):** Use **NIP-78 kind 30078** (Application-specific Data,
  parameterized-replaceable) with a stable `d`-tag namespace (e.g.
  `d: "nostr-secretary/notification-prefs"`). Chosen over the roadmap's literal
  "1xxxx" range because interop ("let other simple web apps modify them") is an
  explicit goal and 30078 is the recognized, collision-safe, library-supported
  app-data standard. The roadmap phase title still says "1xxxx" — this decision
  supersedes it; planning should note the divergence.
- **D2-02 (encryption):** **NIP-44 v2**, self-encrypted to the user's own pubkey
  (`signer.nip44.encrypt(ownPubkey, JSON.stringify(prefs))`); ciphertext stored in
  the event `.content`. This mirrors the NIP-51 hidden-content / NIP-60 self-encrypt
  pattern the app already consumes on the read side. NIP-04 is deprecated and not used.
- **D2-03 (publish path):** Build events **manually** — `applesauce-factory` is not
  installed and will not be added for this phase. Construct an `EventTemplate`
  (`kind: 30078`, `tags: [["d", ...]]`, encrypted `content`) →
  `signer$.value.signEvent(template)` → `pool.publish(relays, signed)`.

### Payload scope (what syncs)
- **D2-04 (rules only):** Sync **notification rules only** — `messages`, `replies`,
  `zaps`, `groups` (including `groups.modes` and each section's
  `enabled`/`whitelists`/`blacklists`), the global `whitelists`/`blacklists`, and
  `appLink`. **Do NOT** sync ntfy **delivery** config (`server`, `topic`, `email`)
  — delivery stays per-device (the ntfy topic is effectively a push-channel secret).
- **D2-05 (never synced):** **Never** include the `signer` blob (serialized account —
  sensitive, device-specific) or `pubkey` (identity, redundant/derivable) in the
  payload. Also exclude `lookupRelays` (device/network-local infra choice) unless
  planning finds a strong reason.
- **D2-06 (schema):** Serialize the synced subset as a **plain JSON object** (the
  same field shape as `AppConfig`'s synced slice) inside the encrypted `.content`.
  Include a small `version` field for forward-compat. Keep it a subset merge, not a
  whole-config replace, so unsynced/local fields (signer, ntfy, pubkey) are preserved.

### Sync model & conflict resolution
- **D2-07 (automatic bidirectional):** Publish on local change (**debounced**, e.g.
  ~1–2s, to coalesce rapid edits) AND subscribe for remote updates; apply inbound
  updates into `config$`. No manual sync buttons required (a manual "sync now" is an
  allowed nicety but not the primary mechanism).
- **D2-08 (newest wins):** On boot and on any inbound event, reconcile by
  **`created_at` high-water-mark** — the newest event wins. Track the last-applied and
  last-published `created_at`; ignore events not newer than what's already applied.
- **D2-09 (loop prevention — REQUIRED):** Guard against the
  inbound-update → `config$.next` → save-on-change → republish loop. Do **not**
  republish an event that merely reflects a just-applied inbound change: compare the
  candidate payload/`created_at` against the high-water-mark before publishing, and
  guard the `config.ts:126` save-on-change subscription so a remote-origin update does
  not immediately re-trigger a publish. (See CONCERNS.md `giftWraps$` `skip(1)`
  fragility as a cautionary pattern.)
- **D2-10 (publish relays):** Publish to the user's **NIP-65 outbox relays**
  (`mailboxes$.outboxes`); fall back to `lookupRelays` if outboxes are empty.
- **D2-11 (subscribe):** Mirror `groups$` / `mutedPubkeys$` — a
  `combineLatest([user$, mailboxes$]) → switchMap → eventStore.replaceable({ kind: 30078, pubkey, ... })`
  reactive value, plus (for guaranteed live push) a
  `pool.subscription(relays, { kinds:[30078], authors:[pubkey], "#d":[namespace] }, { reconnect: Infinity, resubscribe: true })`
  piped through `onlyEvents()` + `mapEventsToStore(eventStore)`, decrypting inside a
  `switchMap(async ...)` like `mutedPubkeys$`.

### Read-only / no-signer degradation & permissions
- **D2-12 (local-only + hint):** With **no signer connected**, keep persisting to
  `config.json` (unchanged current behavior) but **skip publish/subscribe**, and show
  a **non-blocking UI hint** ("connect a signer to sync your settings across devices").
  Existing read-only users are unaffected. Derive the sync listener's `enabled$` from
  `config$` **and** `signer$` (only active when a signer is present).
- **D2-13 (SIGNER_PERMISSIONS — REQUIRED):** Expand `SIGNER_PERMISSIONS`
  (`const.ts:11-13`, currently only `kinds.ClientAuth`/22242) to also request
  **`sign_event` for kind 30078** and **`nip44_encrypt` + `nip44_decrypt`**, or the
  bunker will reject signing/encryption. New NIP-46 connections must request these up
  front; consider how already-connected signers are handled (re-request/notice).
- **D2-14 (feature-detect nip44):** `signer.nip44` is optional on remote bunkers.
  **Feature-detect** `signer$.value?.nip44` at runtime; if absent, degrade to
  local-only and surface a notice rather than throwing.
- **D2-15 (failure handling):** If publish fails (bunker offline/latency), keep the
  local save (never lose the setting) and log via `log()`; a lightweight retry or
  next-change republish is acceptable. Do not block the config PATCH handler on the
  nostr publish.

### Claude's Discretion
- Exact `d`-tag namespace string, `version` value, debounce interval, and whether to
  add an optional manual "sync now" control are left to planning.
- Where the new code lives (`services/preferences.ts` vs. an addition to
  `services/nostr.ts`) — follow STRUCTURE.md "Where to Add New Code": a new
  `$`-suffixed observable/singleton that self-subscribes at import.
- Whether/how to show sync status in the UI (which page/card) beyond the no-signer hint.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap / prior context
- `.planning/ROADMAP.md` §"Phase 2" — phase goal.
- `.planning/phases/01-nip-29-group-notification-modes/01-CONTEXT.md` — Phase 1
  decisions D-01..D-10, esp. the `groups.modes` storage shape (D-10) that this phase
  now syncs.
- `.planning/codebase/` — ARCHITECTURE.md, CONVENTIONS.md, INTEGRATIONS.md,
  STRUCTURE.md, CONCERNS.md, STACK.md. (TESTING.md is **stale** — tests DO exist; see
  `bunfig.toml`, `tests/setup.ts`.)

### NIP references
- **NIP-78** (Application-specific Data, kind 30078) — the chosen event.
- **NIP-44** (Encrypted Payloads v2) — the encryption; self-encrypt to own pubkey.
- **NIP-46** (Nostr Connect / remote signing) — permission model
  (`nip44_encrypt`/`nip44_decrypt`, `sign_event`), the ONLY signer type wired.
- **NIP-65** (Relay List Metadata) — `mailboxes$.outboxes` publish targets.
- **NIP-01** — replaceable event semantics, `created_at` ordering.
- Read via `mcp__nostr__read_nip` and applesauce `applesauce-core/helpers`
  (`hidden-content`, `encrypted-content`, `encryption`) for self-encrypt building blocks.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/config.ts` — `AppConfig` (`:8-56`), `config$` BehaviorSubject (`:58`),
  `updateConfig` (`:142`), `getConfig` (`:146`), `configValue` (`:135`), boot
  migration/backfill pattern (`:94-121`), save-on-change subscription (`:126-128`,
  **must be guarded** for loop prevention — D2-09).
- `services/nostr.ts` — `user$` (`:85`), `signer$` (`:124`), `mailboxes$`/outboxes
  (`:88-99`), one `RelayPool` (`:62`) already wired as the signer's
  publish/subscription transport (`:68-69`), `eventStore.replaceable(...)`,
  `pool.subscription(...)`, `shareAndHold` (`:54`). `groups$` (`:147`) and
  `mutedPubkeys$` (`:288-317`, decrypts private content in a `switchMap(async)`) are
  the closest templates for the prefs subscription.
- `const.ts:11-13` — `SIGNER_PERMISSIONS` (**must expand** — D2-13).
- `pages/signer.tsx` — NIP-46 connect/disconnect flow; `signer$` hydration
  (`nostr.ts:129-145`, only `"nostr-connect"` supported).
- applesauce signer: `account.signEvent(template)`, `account.nip44?.encrypt/decrypt`
  (optional — feature-detect), `account.getPublicKey()`.
- `applesauce-core/helpers` hidden-content / encrypted-content helpers (already
  imported on the read side for NIP-51 mute unlock).

### Established Patterns
- Services are module-scope singletons with side effects at import; notification
  listeners subscribe at import and export an `enabled$` gated off a `config$` slice
  (switch to `NEVER`/`EMPTY` when disabled). The prefs-sync listener follows this,
  gating on `config$` + `signer$` (D2-12).
- Error handling: localized `try/catch` + `log()` (never `console.log`);
  `catchError(() => EMPTY)` to keep subscriptions alive; `timeout({ first, with })`
  fallbacks. Route handlers emit errors via `stream.patchSignals(JSON.stringify({error}))`.
- Config mutation from pages: build a new object → `config$.next(newConfig)` inside a
  Datastar SSE handler.

### Integration Points
- New service: `services/preferences.ts` (or additions to `services/nostr.ts`) —
  publish-on-change + subscribe-and-apply, registered like other side-effect services.
- `const.ts` — permission expansion.
- Possibly `pages/signer.tsx` or a settings card — the no-signer "connect to sync" hint.
- Tests: `tests/services/preferences.test.ts` + a `tests/fixtures/` config fixture,
  mirroring `tests/services/config.test.ts`. Import specific modules, never the
  `notifications/index.ts` barrel (side effects). `tests/setup.ts` already isolates
  `Bun.env.CONFIG` so tests never clobber real `config.json`.

</code_context>

<specifics>
## Specific Ideas

- Serialize a **subset** of `AppConfig` (rules only) — not the whole object — so
  local-only fields (`signer`, `server`/`topic`/`email`, `pubkey`, `lookupRelays`)
  are preserved on merge.
- Reconcile **newest-`created_at`-wins**; treat the nostr event as one replica and
  `config.json` as the other.
- Degrade gracefully: read-only users keep working exactly as today.

</specifics>

<deferred>
## Deferred Ideas

- Syncing ntfy **delivery** config (server/topic/email) across devices — deliberately
  excluded (D2-04); revisit only if users ask for full cross-device provisioning
  (overlaps with backlog 999.4 guided setup).
- Supporting non-NIP-46 signer types (NIP-07 extension, local nsec) for signing the
  prefs event — currently only `"nostr-connect"` is wired app-wide; out of scope here.
- A dedicated preferences-management web page / richer sync-status UI — overlaps with
  backlog 999.3 (web config reimagining).
- Encrypted-event schema versioning/migration beyond a simple `version` field.

</deferred>

---

*Phase: 02-save-notification-preferences-as-encrypted-1xxxx-nostr-event*
*Context gathered: 2026-07-07 (smart discuss, autonomous mode)*
