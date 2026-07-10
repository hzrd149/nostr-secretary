# Phase 5: DM notifications split into contacts and others categories - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey areas proposed in batch; user overrode the follow-list fallback to "others", accepted schema/defaults and layering/UI/scope as recommended.

<domain>
## Phase Boundary

Split DM notifications into two default categories — **contacts** (DMs from users the
recipient follows) and **others** (DMs from users the recipient does NOT follow) — each with
its own enable toggle, so users get granular control over who can ping them instead of a single
blanket DM setting. Applies to **both** NIP-04 (Phase 3) and NIP-17 (Phase 4) DM notification
paths.

Ships:
- A reactive `contacts$` observable of the user's kind-3 follow list (via applesauce
  `ContactsModel`/`getContacts`), used to classify each incoming DM sender as **contacts** or
  **others** (D5-01/D5-03).
- A config schema split: `messages.contacts.enabled` and `messages.others.enabled` (D5-04),
  with a migration that preserves existing users' behavior (D5-06) and keeps the Phase-2 nostr
  sync working with the new shape (D5-10).
- Category enforcement layered into both DM listeners in `notifications/messages.ts`
  (category gate → existing mute + whitelist/blacklist still apply, D5-07).
- A `/messages` UI split into two labeled sections (Contacts / Others), each with its enable
  toggle, sharing the existing `sendContent` toggle + whitelist/blacklist below (D5-08).

**Not in this phase:** rate limiting / grouped overflow (Phases 6-7); changing the NIP-04
decrypt/NIP-17 gift-wrap mechanics (Phases 3-4, done); per-category `sendContent` or
per-category whitelists/blacklists (those stay shared — D5-04); a full contacts-management UI.

</domain>

<decisions>
## Implementation Decisions

### Categorization
- **D5-01 (contacts = follow list):** A DM sender is a **contact** iff their pubkey is in the
  user's **kind-3 follow/contact list**. Use applesauce's `ContactsModel(user)` /
  `getContacts`/`getPublicContacts` (`applesauce-core` contacts model, kind `Contacts`) read
  reactively from the `eventStore`. Not-followed senders are **others**. (Mutual-follow was
  considered and dropped — recipient-follows-sender is the definition.)
- **D5-02 (fallback → "others", user override):** When the follow list **cannot be determined**
  (no kind-3 event loaded yet, or a load timeout), classify the sender as **others** (NOT
  contacts). Because `others` defaults to **enabled** (D5-05), this does not silently drop DMs
  by default — an unknown sender still notifies unless the user has explicitly muted `others`.
  (User overrode the fail-open default: fall to "others", not "contacts".)
- **D5-03 (reactive):** Re-categorize reactively — following/unfollowing a pubkey updates
  `contacts$` and thus subsequent classification, mirroring the `groups$`/`mutedPubkeys$`
  reactive pattern. Do not snapshot the follow list once at boot.

### Config schema & defaults
- **D5-04 (per-category `enabled` only):** Split ONLY the enable flag per category. Add
  `messages.contacts: { enabled: boolean }` and `messages.others: { enabled: boolean }` (or an
  equivalent nested shape — planning picks the exact field layout). Keep `messages.sendContent`,
  `messages.whitelists`, and `messages.blacklists` **shared** at the `messages` level (they are
  orthogonal privacy/filter controls, not per-category). This keeps the schema, migration, and
  Phase-2 sync surface small. The legacy top-level `messages.enabled` is superseded by the two
  category flags — planning decides whether to keep it as a derived/back-compat field or remove it
  (must not break the existing `enabled$`/`enabledSigner` gating in `notifications/messages.ts`).
- **D5-05 (defaults — both ON):** New installs default **both** `contacts.enabled = true` AND
  `others.enabled = true` — preserving today's "notify for all DMs" behavior while making the two
  independently toggleable. (User accepted; `others` ON, not anti-spam-OFF.)
- **D5-06 (migration — preserve behavior):** On migrating an existing config, seed **both**
  `contacts.enabled` and `others.enabled` from the current `messages.enabled` value, so upgraders
  see no behavior change. `sendContent`, `whitelists`, `blacklists` carry over unchanged. Follow the
  existing migration pattern in `services/config.ts` (`migrateConfig`, the Phase-3 extracted pure
  function) and add regression tests.

### Layering, UI & scope
- **D5-07 (layered gate):** Category enable is an **additional** gate layered on top of the
  existing checks (mirrors Phase 1 D-09): (1) determine the sender's category (contacts/others);
  (2) that category's `enabled` — off ⇒ stop, do not notify; (3) the **existing** `shouldNotify`
  gate (mute list + per-DM whitelist/blacklist + global whitelist/blacklist) still applies
  unchanged on top. Category must NOT bypass the existing mute/whitelist/blacklist checks.
- **D5-08 (UI — two sections):** On `/messages` (`pages/messages.tsx`), render **two labeled
  sections** — "Contacts" and "Others" — each with its own enable checkbox bound to the respective
  category flag. Keep the shared `sendContent` toggle and the `WhitelistBlacklist` component below,
  applying to both. Reuse existing form components and the Datastar signals/PATCH pattern; add the
  two new signals to the PATCH handler.
- **D5-09 (scope — both DM types):** The categorization + gate applies to **both** the NIP-04
  listener and the NIP-17 gift-wrap listener in `notifications/messages.ts`. The sender used for
  classification is the DM's real sender pubkey (for NIP-17, the unwrapped rumor's author). No
  rate limiting (Phases 6-7). Do not regress the NIP-04/NIP-17 decrypt paths.
- **D5-10 (Phase-2 sync compat — REQUIRED):** The per-category `enabled` flags are notification
  **rules**, so they must sync via the Phase-2 encrypted kind-30078 event. Extend
  `helpers/preferences.ts` `SyncedPrefs.messages` (+ `serializePrefs`/`sanitizeSyncedPrefs`) to
  carry `contacts.enabled`/`others.enabled` (following D2-04). `sendContent` stays local-only
  (unchanged). Do not break the existing sync round-trip.

### Claude's Discretion
- Exact nested vs flat field layout for the category flags (`messages.contacts.enabled` vs
  `messages.contactsEnabled`) — pick what migrates and syncs most cleanly and keeps `enabled$`
  gating working.
- Where `contacts$` lives (`services/nostr.ts`, mirroring `groups$`/`mutedPubkeys$`) and how it
  degrades on load failure (timeout → empty set → classify as "others" per D5-02).
- Whether to keep a derived top-level `messages.enabled` (e.g. `contacts.enabled || others.enabled`)
  for back-compat of the `enabled$` observable, or refactor `enabled$` to the new fields.
- How to extract the category-classification into a pure, network-safe testable unit (mirroring
  Phase 3/4's extracted units) so tests don't import the self-subscribing modules.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap / prior context
- `.planning/ROADMAP.md` §"Phase 5" — phase goal.
- `.planning/phases/03-.../03-CONTEXT.md` (NIP-04 listener + extracted `legacy-messages.ts`),
  `.planning/phases/04-.../04-CONTEXT.md` (NIP-17 listener + extracted `gift-wrap-messages.ts`) —
  both DM listeners this phase gates; the extract-pure-unit + network-safe test pattern.
- `.planning/phases/01-.../01-CONTEXT.md` — D-09 layering pattern (category gate on top of
  existing sender gate) that D5-07 mirrors.
- `.planning/phases/02-.../02-CONTEXT.md` — D2-04 (rules sync) + `helpers/preferences.ts`
  `SyncedPrefs` shape that D5-10 extends.
- `.planning/codebase/` — ARCHITECTURE.md, CONVENTIONS.md, STRUCTURE.md.

### NIP references
- **NIP-02** (Contact List / follow list, kind 3) — the source of "contacts". Read via
  `mcp__nostr__read_nip` and the **applesauce** skill/MCP (`ContactsModel`, `getContacts`,
  `getPublicContacts` in `applesauce-core`).
- **NIP-17 / NIP-04** — the two DM paths being gated (sender pubkey source differs).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/nostr.ts` — `groups$` (`:147`) and `mutedPubkeys$` (`:288+`) are the reactive
  `combineLatest([user$, ...]) → switchMap → eventStore model/replaceable` templates for the new
  `contacts$`; one `eventStore`, one `pool`. There is currently **no** follows/contacts observable
  (grep confirmed) — it must be added.
- applesauce `ContactsModel(user)` (`applesauce-core/models/contacts`) + `getContacts` helpers —
  reactive kind-3 read from the eventStore.
- `notifications/messages.ts` — the NIP-04 (`:114+`) and NIP-17 (`:194+`) listeners; each already
  has a `shouldNotify(pubkey)` gate (`:46-74`) that the category gate layers on top of (D5-07).
  The extracted `notifications/legacy-messages.ts` / `notifications/gift-wrap-messages.ts` are the
  pure-unit precedent (D5 category classifier can be a similar pure unit).
- `services/config.ts` — `AppConfig.messages` (`:28-33`), defaults (`:64`), `migrateConfig`
  (`:120+`, the Phase-3 extracted pure fn) — the schema split + migration go here (D5-04/05/06).
- `pages/messages.tsx` — single-section form (enabled `:34`, sendContent `:58`, `WhitelistBlacklist`
  `:88`) + PATCH handler reading Datastar signals (`:128+`, writes `messages` `:154`). Split into
  two sections + two new signals (D5-08). `components/WhitelistBlacklist.tsx` reused as-is.
- `helpers/preferences.ts` — `SyncedPrefs.messages` + `serializePrefs`/`sanitizeSyncedPrefs`
  (Phase 2) — extend for the per-category flags (D5-10).

### Established Patterns
- Reactive follow/mute/group observables in `services/nostr.ts`; `shareReplay`/`shareAndHold`
  caching; degrade on timeout to an empty set (classify as "others", D5-02). Never `console.log`.
- Config pages: `*View()` + `route = { GET, PATCH }`; PATCH reads Datastar signals →
  `config$.next(...)`. `migrateConfig` + regression tests for new fields.
- Network-safe tests import specific pure modules, never `services/nostr.ts`/the barrel;
  `PrivateKeySigner` fixture; `bunfig.toml`/`tests/setup.ts` isolate CONFIG.

### Integration Points
- `services/nostr.ts` — new `contacts$` observable.
- `services/config.ts` — `messages.contacts`/`messages.others` schema + `migrateConfig` (D5-04/06).
- `notifications/messages.ts` — category gate in BOTH DM listeners (D5-07/09), via a pure classifier.
- `pages/messages.tsx` — two UI sections + PATCH signals (D5-08).
- `helpers/preferences.ts` — sync the new flags (D5-10).
- Tests: pure classifier unit + config-migration regression + a network-safe listener/gate test.

</code_context>

<specifics>
## Specific Ideas
- "Contacts" strictly = the recipient's kind-3 follow list; "others" = everyone else (including
  unknown when the list can't load — D5-02).
- Preserve current behavior for existing users (both categories inherit `messages.enabled`).
- Category gate layers on top of — never replaces — the existing mute/whitelist/blacklist.

</specifics>

<deferred>
## Deferred Ideas
- Per-category `sendContent` or per-category whitelists/blacklists — deliberately shared at the
  `messages` level this phase (D5-04); revisit only if users ask.
- Mutual-follow ("web of trust"-style) categorization — considered, dropped (D5-01).
- Rate limiting / grouped overflow for DM bursts — Phases 6-7.
- A contacts-management UI (view/edit follow list in-app) — out of scope.
</deferred>

---

*Phase: 05-dm-notifications-split-contacts-and-others-categories*
*Context gathered: 2026-07-10 (smart discuss, autonomous mode)*
