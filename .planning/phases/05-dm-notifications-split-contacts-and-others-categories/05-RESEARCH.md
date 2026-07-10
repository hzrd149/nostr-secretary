# Phase 5: DM notifications split into contacts and others categories - Research

**Researched:** 2026-07-10
**Domain:** NIP-02 follow-list-based DM classification layered onto the existing NIP-04/NIP-17
DM listeners (applesauce SDK v6.2.x `applesauce-core` EventStore models, RxJS, Datastar SSE forms)
**Confidence:** HIGH

## Summary

This is a genuinely new feature, not a harden pass — but every piece of it composes primitives
this codebase (and applesauce) already has, in patterns Phases 2-4 already established. Reading
the installed `applesauce-core` v6.2.0 source directly turned up the single most load-bearing
finding of this research: **`EventStore` already has a built-in `contacts(user)` accessor**
(`node_modules/applesauce-core/dist/event-store/event-models.js:118-122`), which is a one-line
wrapper around the documented `ContactsModel` (`this.model(ContactsModel, {pubkey: user})`) named
in D5-01. It has the exact same shape as `eventStore.profile(sender)` and `eventStore.mailboxes(user)`,
both of which are already used throughout `services/nostr.ts` and `notifications/messages.ts` —
so `contacts$` can be built with zero new applesauce concepts, mirroring `mailboxes$`/`mutedPubkeys$`
almost line-for-line.

A second load-bearing finding: **kind-3 Contacts lists are NOT registered in applesauce's
`HiddenTagsKinds` set** (`node_modules/applesauce-core/dist/helpers/hidden-tags.js:8-21` — only
`Mutelist`, `BookmarkList`, `InterestsList`, `CommunitiesList`, `PublicChatsList`,
`SearchRelaysList`, the NIP-29 groups list, and four `*sets` kinds are registered). This means
`getContacts()`/`eventStore.contacts()` can **never** attempt a hidden-tag decrypt for a kind-3
event — `canHaveHiddenTags(3)` is always `false`, so `getHiddenContacts()` always resolves
`undefined` and `getContacts()` silently degrades to public-contacts-only. Unlike
`mutedPubkeys$` (which needs `signer$` to decrypt NIP-51 hidden mutes), **`contacts$` needs no
signer at all** — it is exactly as simple as `groups$`. Read-only (no-signer) users get full,
correct contacts classification with zero code branching for signer-absence.

The classification logic itself is one line (`isFollowed ? "contacts" : "others"`), so the
"pure, network-safe testable unit" Phase 3/4 established (`legacy-messages.ts`,
`gift-wrap-messages.ts`) is proportionately small here — a `classifyDmSender(isFollowed: boolean):
DmCategory` pure function is enough; the fallible I/O (`isContact(pubkey)`, mirroring
`isMuted(pubkey)`'s exact shape — `firstValueFrom` + `timeout({first:2000, with: () => of([])})`)
stays in `services/nostr.ts`, and the trivial `messages[category].enabled` lookup stays inline in
`notifications/messages.ts` next to the (deliberately unmodified) `shouldNotify`, covered the same
way `shouldNotify`'s gate order is covered today: a local truth-table mirror in the test file, not
a DI-injected pure module. D5-02's "unavailable → others" fallback falls out of this design for
free: `isContact`'s timeout-to-`[]` fallback makes "follow list didn't load in time" and "sender
genuinely not followed" produce the identical `false` → `"others"` result — no special-case code
needed, and directly unit-testable (`classifyDmSender(false) === "others"`).

The riskiest part of this phase is **not** the new `contacts$`/classifier — it's the config-schema
surgery. `messages.enabled` is read/written in 6 places across the codebase (production and test)
and this phase must replace it with `messages.contacts.enabled` / `messages.others.enabled`
everywhere, while (a) preserving existing users' behavior on upgrade (D5-06), (b) keeping
`enabled$`/`enabledSigner` gating (`notifications/messages.ts:77-102`) working, and (c) not
silently breaking the Phase-2 sync round trip for a peer device that hasn't upgraded yet — a
subtlety CONTEXT.md's decisions don't explicitly call out and that this research flags as a new,
important pitfall (see Pitfall 5: stale-peer sync payloads).

**Primary recommendation:** Add `contacts$`/`isContact(pubkey)` to `services/nostr.ts` using
`eventStore.contacts(user)` directly (no `ContactsModel` import needed — the wrapper is already
exposed on `EventStore`), no signer dependency; add a tiny pure `notifications/dm-category.ts`
exporting `classifyDmSender(isFollowed: boolean): DmCategory`; restructure `AppConfig.messages` to
`{ contacts: {enabled}, others: {enabled}, sendContent, whitelists, blacklists }` (drop the
top-level `enabled` field entirely — do not keep it as a derived back-compat field, since a
derived field can drift out of sync with the two flags it derives from); add a `migrateConfig`
step that seeds both category flags from the pre-existing `messages.enabled` (or defaults both to
`true` for genuinely blank configs per D5-05); change `enabled$` to
`c.messages.contacts.enabled || c.messages.others.enabled`; add the category-enabled check ahead
of (not merged into) the existing `shouldNotify(sender)` call in **both** the NIP-04 and NIP-17
`.subscribe()` callbacks; split `pages/messages.tsx` into two sections with flat Datastar signal
names (`contactsEnabled` / `othersEnabled` — Datastar signals in this codebase are always flat
identifiers, never dotted paths); and extend `helpers/preferences.ts`'s `SyncedPrefs.messages` +
`serializePrefs`/`sanitizeSyncedPrefs`/`mergePrefs`, bumping `PREFS_VERSION` to 2 with an explicit
old-schema fallback so a peer device still running pre-Phase-5 code doesn't silently turn off both
categories on a device that receives its synced payload (Pitfall 5).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Follow-list (`contacts$`) reactive read | Service Layer (`services/nostr.ts`) | — | Same tier as `groups$`/`mutedPubkeys$`/`mailboxes$` — a shared, cached, reactive slice of the single `eventStore` |
| Sender → category classification (`classifyDmSender`) | Notification Listener Layer (`notifications/dm-category.ts`, pure) | — | Decision logic, zero I/O — mirrors `legacy-messages.ts`'s extracted-pure-unit precedent |
| Category-enabled gate composition | Notification Listener Layer (`notifications/messages.ts`, inline) | Service Layer (reads `services/nostr.ts#isContact` + `services/config.ts#getConfig`) | Same tier and shape as the existing (unmodified) `shouldNotify` — composes two singleton reads, stays local to the listener, not extracted into a DI-injected module |
| Config schema split (`messages.contacts`/`messages.others`) | Service Layer (`services/config.ts` — type + migration + default seed) | — | Config schema and migration are a service-layer boundary, not a UI concern |
| `enabled$`/`enabledSigner` gating update | Notification Listener Layer (`notifications/messages.ts`) | — | Already lives here; only the config-key expression changes |
| Two-section `/messages` UI | Presentation/HTTP Page Layer (`pages/messages.tsx`) | — | Form rendering + Datastar PATCH signal wiring, unchanged tier from today's single-section form |
| Sync of the two new flags (kind-30078) | Service Layer (`helpers/preferences.ts` pure functions) | — | `services/preferences.ts` already consumes only `serializePrefs`/`mergePrefs`/`sanitizeSyncedPrefs` — no changes needed to the publish/subscribe pipeline itself, only to these three pure functions and the `SyncedPrefs` type |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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
  gating working. **Research recommends nested** (`messages.contacts.enabled` /
  `messages.others.enabled`) — see Architecture Patterns §2.
- Where `contacts$` lives (`services/nostr.ts`, mirroring `groups$`/`mutedPubkeys$`) and how it
  degrades on load failure (timeout → empty set → classify as "others" per D5-02). **Research
  confirms:** `services/nostr.ts`, no signer dependency needed (see Summary/Pitfall 1).
- Whether to keep a derived top-level `messages.enabled` (e.g. `contacts.enabled || others.enabled`)
  for back-compat of the `enabled$` observable, or refactor `enabled$` to the new fields.
  **Research recommends:** refactor `enabled$` directly to
  `c.messages.contacts.enabled || c.messages.others.enabled`; do not keep a derived config field
  (see Pitfall 2).
- How to extract the category-classification into a pure, network-safe testable unit (mirroring
  Phase 3/4's extracted units) so tests don't import the self-subscribing modules. **Research
  recommends:** a tiny pure `classifyDmSender(isFollowed: boolean): DmCategory` in
  `notifications/dm-category.ts`, plus a WR-04-style local truth-table mirror in the test file for
  the composed gate (mirroring how `shouldNotify` itself is tested today) — see Architecture
  Patterns §3 and Code Examples.

### Deferred Ideas (OUT OF SCOPE)

- Per-category `sendContent` or per-category whitelists/blacklists — deliberately shared at the
  `messages` level this phase (D5-04); revisit only if users ask.
- Mutual-follow ("web of trust"-style) categorization — considered, dropped (D5-01).
- Rate limiting / grouped overflow for DM bursts — Phases 6-7.
- A contacts-management UI (view/edit follow list in-app) — out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

No formal REQ-IDs exist for this phase; CONTEXT.md's D5-01..D5-10 decisions are the requirements
contract. Mapping each to the research that supports it:

| ID | Description | Research Support |
|----|-------------|------------------|
| D5-01 | contacts = kind-3 follow list | Confirmed `eventStore.contacts(user)` is a built-in `EventStore` accessor (`event-models.js:118-122`) wrapping `ContactsModel`; `getContacts`/`getPublicContacts` confirmed in `helpers/contacts.d.ts`. See Architecture Patterns §1. |
| D5-02 | fallback → others | `isContact`'s `timeout({first:2000, with: () => of([])})` (mirroring `isMuted`) makes "can't determine" and "not followed" identical `false` outcomes — no special-case code. See Summary + Code Examples §2. |
| D5-03 | reactive re-categorization | `contacts$` built as a `switchMap`-based observable over `user$` (mirroring `mailboxes$`), so a new kind-3 event updates classification for the next DM without a boot-time snapshot. See Architecture Patterns §1. |
| D5-04 | per-category `enabled` only, shared sendContent/lists | Confirmed via direct read of `services/config.ts:27-33` (`AppConfig.messages`) — exact fields to split vs keep are unambiguous. See Architecture Patterns §2. |
| D5-05 | new-install defaults both ON | Confirmed current `config$` seed default is `messages.enabled: false` (`services/config.ts:65`) — D5-05 is a deliberate, locked **change** to that default, not a preservation of it. Flagged prominently as Pitfall 3. |
| D5-06 | migration preserves behavior | `migrateConfig` (`services/config.ts:124-151`) is the exact extension point; existing D3-04 test precedent (`tests/services/config.test.ts`) is the pattern to mirror for the new migration step. See Code Examples §4. |
| D5-07 | layered gate, shouldNotify unchanged | `shouldNotify` (`notifications/messages.ts:46-74`) read directly — confirmed it is not modified; the category check is a new, separate, earlier check inline in both `.subscribe()` callbacks. See Architecture Patterns §3. |
| D5-08 | two-section UI | `pages/messages.tsx` read directly — confirmed Datastar signal names are always flat identifiers (e.g. `mode_${index}` in `pages/groups.tsx`), never dotted paths; `contactsEnabled`/`othersEnabled` are the two new flat signals. See Code Examples §5. |
| D5-09 | both NIP-04 and NIP-17 | Both `.subscribe()` callbacks in `notifications/messages.ts` (lines 169-192 and 226-259) read directly — the category check is added identically to both, using each path's own `sender` variable (`sender` for NIP-04, `rumor.pubkey` for NIP-17). |
| D5-10 | sync compat | `helpers/preferences.ts` and `services/preferences.ts` read directly — confirmed `services/preferences.ts` only calls `serializePrefs`/`mergePrefs`/`sanitizeSyncedPrefs`/`isNewerPrefs`/`samePrefsPayload`, never touches `config.messages` fields directly, so extending these three pure functions is sufficient. New pitfall found: a not-yet-upgraded peer device's old-schema payload would coerce both new booleans to `false` via `asBoolean(undefined)` unless explicitly handled. See Pitfall 5. |

</phase_requirements>

## Standard Stack

No new dependencies are required for this phase. `applesauce-core` (already `^6.2.0`, already
installed) already exposes everything D5-01 needs.

### Core (already installed — verified against `node_modules` source read directly)

| Library | Installed Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `applesauce-core` | 6.2.0 `[VERIFIED: node_modules source]` | `EventStore.contacts(user)` (`event-models.js:118`), `ContactsModel`/`getContacts`/`getPublicContacts`/`getHiddenContacts` (`models/contacts.js`, `helpers/contacts.js`) | Already the app's single EventStore package; `contacts()` is a first-class accessor, same shape as the already-used `profile()`/`mailboxes()` |
| `nostr-tools` | ^2.23.9 `[VERIFIED: package.json]` | `kinds.Contacts` (= 3) — confirmed in `node_modules/nostr-tools/lib/cjs/kinds.js:281` | Already in use throughout the codebase |
| `rxjs` | ^7.8.2 `[VERIFIED: package.json]` | `switchMap`, `timeout`, `of`, `firstValueFrom` — all standard operators already used identically for `mutedPubkeys$`/`isMuted` | Already the app's reactive backbone |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `bun:test` | bundled with Bun (project already uses it) | Test runner | New `tests/notifications/dm-category.test.ts`; additions to `tests/services/config.test.ts` and `tests/helpers/preferences.test.ts` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `eventStore.contacts(user)` (recommended) | Manually `eventStore.replaceable({kind: kinds.Contacts, pubkey: user})` + `map(e => e ? getContacts(e) : [])` | Both produce identical results — `eventStore.contacts()` literally calls this internally via `ContactsModel`. The manual form matches `groups$`'s existing style slightly more closely (no `.model()`/accessor-method precedent exists elsewhere in this codebase yet), but is strictly more code for zero behavioral difference. Recommended: use `eventStore.contacts()` since it is the documented, less-code, less-error-prone form, and is exactly parallel to the already-used `eventStore.profile()`/`eventStore.mailboxes()` |
| `eventStore.model(ContactsModel, user)` (equivalent, more verbose) | Same as above — this is what `eventStore.contacts()` calls internally | No behavioral difference; `eventStore.contacts()` is strictly less code and is the applesauce-recommended shorthand (confirmed in `references/packages/core.md`'s `eventStore.model(ProfileModel, pubkey)` example, generalized) |
| A tiny pure `classifyDmSender` + inline gate composition (recommended) | A full DI-injected pure module like `legacy-messages.ts`'s `decryptLegacyDirectMessage` (deps object with mockable `getProfile`/`unlock`) | The DI pattern earns its complexity when there are multiple async I/O steps worth mocking independently (profile fetch vs. decrypt). Here there is exactly one boolean lookup (`isContact`) and one config-field read (`messages[category].enabled`) — proportionate coverage is a pure classifier + a WR-04-style local truth-table mirror in the test file, exactly matching how `shouldNotify` itself (which is *also* not extracted into a DI module) is tested today |
| Removing `messages.enabled` entirely, no derived field (recommended) | Keeping `messages.enabled` as a computed/derived field (`contacts.enabled || others.enabled`) alongside the two new flags | A derived field stored in `AppConfig` can drift from its inputs if any code path writes to it directly (as `pages/messages.tsx`'s PATCH handler currently does) — removing it entirely and updating `enabled$`'s expression directly eliminates an entire class of "which one is the source of truth" bugs. All 6 call sites are already enumerated in Pitfall 2 |

**Installation:** None — no new packages.

**Version verification:**
```bash
$ npm view applesauce-core version   # not run — already installed; confirmed via package.json (^6.2.0) + node_modules/applesauce-core/package.json ("version": "6.2.0") + direct source read
```
All claims in this document were verified by reading the actual installed
`node_modules/applesauce-core/dist/**/*.{js,d.ts}` source directly (not training-data
recollection), consistent with Phase 3/4's methodology, since the installed version is the ground
truth for this repo's build.

## Package Legitimacy Audit

**Not applicable.** This phase installs zero new external packages — it modifies existing files
(`services/nostr.ts`, `services/config.ts`, `notifications/messages.ts`, `pages/messages.tsx`,
`helpers/preferences.ts`) and adds one new small pure module
(`notifications/dm-category.ts`) plus test files, using only already-installed, already-vetted
dependencies (`applesauce-core`, `nostr-tools`, `rxjs`, `bun:test`).

**Packages removed due to [SLOP] verdict:** none — no packages evaluated.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ services/nostr.ts — NEW: contacts$ / isContact(pubkey)                    │
│                                                                             │
│  user$ (existing) --switchMap--> eventStore.contacts(user)                │
│    = eventStore.model(ContactsModel, {pubkey: user})                      │
│    = ProfilePointer[] of the user's kind-3 follow list                    │
│    -- no signer needed: kind 3 is NOT in HiddenTagsKinds (Pitfall 1) --   │
│    --> shareAndHold()  =>  contacts$                                      │
│                                                                             │
│  isContact(pubkey): Promise<boolean>  (mirrors isMuted's exact shape)     │
│    firstValueFrom(contacts$.pipe(                                         │
│      timeout({ first: 2000, with: () => of([]) })                         │
│    )).then(list => list.some(c => c.pubkey === pubkey))                   │
│    -- degrades to false ("not a contact") on load failure -- D5-02 --    │
└──────────────────────────────┬─────────────────────────────────────────────┘
                               │ boolean
                               ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ notifications/dm-category.ts — NEW, pure, network-free                   │
│                                                                             │
│  classifyDmSender(isFollowed: boolean): "contacts" | "others"             │
│    = isFollowed ? "contacts" : "others"          (D5-01/D5-02)            │
└──────────────────────────────┬─────────────────────────────────────────────┘
                               │ "contacts" | "others"
                               ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ notifications/messages.ts — NIP-04 .subscribe() AND NIP-17 .subscribe()  │
│  (identical gate added to BOTH -- D5-09)                                  │
│                                                                             │
│  const category = classifyDmSender(await isContact(sender));  (D5-01/02) │
│  const { messages } = getConfig();                                       │
│  if (!messages[category].enabled)                                        │
│    return log("Skipping: category disabled", { sender, category });      │
│      ^-- D5-07 step 1-2: category gate FIRST, stop here if off           │
│                                                                             │
│  if (!(await shouldNotify(sender)))     <-- UNCHANGED, D5-07 step 3       │
│    return log("Skipping: blacklisted/non-whitelisted", { sender });       │
│                                                                             │
│  await sendNotification({ ... })   <-- unchanged                         │
└───────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
services/nostr.ts                    # NEW: contacts$, isContact(pubkey)
notifications/dm-category.ts         # NEW: classifyDmSender() pure unit + DmCategory type
notifications/messages.ts            # category gate added to BOTH .subscribe() callbacks
services/config.ts                   # AppConfig.messages schema split + migrateConfig step
helpers/preferences.ts               # SyncedPrefs.messages split + PREFS_VERSION bump
pages/messages.tsx                   # two sections + two new signals + PATCH handler update
tests/notifications/dm-category.test.ts   # NEW — pure classifier + gate truth-table mirror
tests/services/config.test.ts        # add D5-06 migration cases
tests/helpers/preferences.test.ts    # extend fixture + round-trip for contacts/others
```

### Pattern 1: `contacts$` — mirrors `mailboxes$`/`mutedPubkeys$`, needs no signer

**What:** `EventStore` already exposes `contacts(user)` as a first-class accessor
(`[VERIFIED: node_modules/applesauce-core source]`):
```js
// node_modules/applesauce-core/dist/event-store/event-models.js:118-122
contacts(user) {
    if (typeof user === "string") user = { pubkey: user };
    return this.model(ContactsModel, user);
}
```
`ContactsModel` (`models/contacts.js`) resolves `mergeContacts(getPublicContacts(event),
getHiddenContacts(event))`. `getHiddenContacts` depends on `getHiddenTags`, which unconditionally
returns `undefined` for any kind not registered in `HiddenTagsKinds`
(`helpers/hidden-tags.js:52-53`: `if (!canHaveHiddenTags(event.kind)) return undefined;`).
`HiddenTagsKinds` (`helpers/hidden-tags.js:8-21`) registers `Mutelist`, `BookmarkList`,
`InterestsList`, `CommunitiesList`, `PublicChatsList`, `SearchRelaysList`, NIP-29 groups (10009),
and four `*sets` kinds — **kind 3 (`Contacts`) is absent from this list**. So `getContacts()` for
a real kind-3 event always resolves to public contacts only, with **zero decrypt attempts, ever**
— no `signer` needed, no `unlockHiddenContacts` call ever fires for this kind in the installed
package version.

**When to use:** For D5-01/D5-03's reactive follow-list read.

**Source:** `[VERIFIED: node_modules/applesauce-core source]`

**Recommended code (mirrors `mailboxes$`'s existing shape, `services/nostr.ts`):**
```ts
/** An observable of the user's kind-3 follow list (NIP-02 Contacts, D5-01).
 *  Unlike mutedPubkeys$, this needs no signer -- kind 3 is not registered in
 *  applesauce's HiddenTagsKinds, so getContacts() never attempts a decrypt
 *  (Pitfall 1). Re-emits reactively when the user's kind-3 event changes
 *  (D5-03) -- never snapshotted once at boot. */
export const contacts$ = user$.pipe(
  switchMap((user) => eventStore.contacts(user)),
  shareAndHold(),
);

/** Returns true if the user follows `pubkey` (NIP-02 kind-3 contact list).
 *  Mirrors isMuted's exact shape: falls back to an empty list (=> false,
 *  "not a contact") if the follow list cannot be loaded in time. The DM
 *  category gate treats "not a contact" identically whether the list
 *  genuinely doesn't include the pubkey or simply hasn't loaded yet --
 *  this IS the D5-02 "unavailable -> others" fallback, with no special-case
 *  code required. */
export async function isContact(pubkey: string): Promise<boolean> {
  const contacts = await firstValueFrom(
    contacts$.pipe(
      timeout({ first: 2000, with: () => of([] as ProfilePointer[]) }),
    ),
  );
  return contacts.some((c) => c.pubkey === pubkey);
}
```
`ProfilePointer` (`{ pubkey: string; relays?: string[] }`) is already imported project-wide from
`nostr-tools` (re-exported by `applesauce-core`); no new type dependency.

### Pattern 2: Config schema — nested per-category `enabled`, `messages.enabled` removed entirely

**What:** `AppConfig.messages` today (`services/config.ts:27-33`):
```ts
messages: {
  enabled: boolean;
  sendContent: boolean;
  whitelists: string[];
  blacklists: string[];
};
```
**Recommended new shape:**
```ts
messages: {
  contacts: { enabled: boolean };
  others: { enabled: boolean };
  sendContent: boolean;
  whitelists: string[];
  blacklists: string[];
};
```
Nested (not flat `contactsEnabled`/`othersEnabled` at the `messages` level) because it (a) groups
each category's settings for future extension (CONTEXT.md's Deferred Ideas already anticipate
per-category `sendContent`/lists later — a nested shape absorbs that without a rename), (b) maps
1:1 onto the two new UI sections (D5-08), and (c) is what the two-field `SyncedPrefs.messages`
extension (D5-10) naturally mirrors.

**Why remove `messages.enabled` entirely (not keep it derived):** it is written directly by
`pages/messages.tsx`'s PATCH handler today (`newConfig.messages = { enabled: !!enabled, ... }`)
and read directly by `enabled$` (`notifications/messages.ts:78`) and by `serializePrefs`/
`sanitizeSyncedPrefs`/`mergePrefs` (`helpers/preferences.ts:57,133,175`) — 6 call sites total
(confirmed via `grep -rn "messages\.enabled"`, see Pitfall 2). A derived field is redundant state
that another code path could accidentally write to directly, silently desyncing from
`contacts.enabled`/`others.enabled`. Removing it and updating each of the 6 call sites is the same
amount of work as adding a derivation, with one fewer state-drift failure mode.

### Pattern 3: Layered gate — category check is a NEW, separate step; `shouldNotify` stays byte-identical

**What:** D5-07 explicitly numbers the layering: (1) classify, (2) category-enabled — stop if off,
(3) existing `shouldNotify` gate, unchanged, "on top." `shouldNotify` (`notifications/messages.ts:46-74`)
must not be edited at all — it has an existing, passing test (`tests/notifications/messages.test.ts`'s
`decide()` mirror) that must keep passing unmodified.

**Recommendation:** add the category check as a new statement immediately before each existing
`if (!(await shouldNotify(sender))) return ...;` call, in **both** `.subscribe()` callbacks
(NIP-04 at `notifications/messages.ts:169-192`, NIP-17 at `:226-259`). Do not merge the category
check into `shouldNotify`'s body — keep them as two visibly separate gates, matching D5-07's
explicit "additional gate ... layered on top" framing and Phase 1's D-09 precedent.

### Anti-Patterns to Avoid

- **Adding a `signer$` dependency to `contacts$`:** unlike `mutedPubkeys$`, kind-3 Contacts lists
  are never decrypted by applesauce today (Pattern 1) — a `combineLatest([user$, signer$])`
  wrapper would introduce a false dependency that could delay or block classification for
  read-only (no-signer) users for no benefit.
- **Merging the category check into `shouldNotify`'s body:** would violate D5-07's explicit
  "layered on top, does not bypass" framing and would force touching (and re-testing) the
  existing, already-covered `shouldNotify` gate-order mirror test.
- **Keeping a derived `messages.enabled` field:** see Pattern 2 — creates a second, potentially
  stale, source of truth for the same information the two category flags already hold.
- **Assuming D5-05's "both ON" default matches today's actual default:** today's `config$` seed
  is `messages.enabled: false` (`services/config.ts:65`) — D5-05 is a deliberate behavior change
  for brand-new installs, not a preservation of the current default. See Pitfall 3.
- **Using dotted Datastar signal names (`contacts.enabled`) in `pages/messages.tsx`:** this
  codebase's Datastar signals are always flat identifiers (confirmed via `pages/groups.tsx`'s
  `mode_${index}` pattern) — use `contactsEnabled`/`othersEnabled`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reading a kind-3 follow list reactively | A hand-rolled `eventStore.replaceable({kind:3,...})` + manual tag-parsing (`getTagValue`/`isPTag` loop) | `eventStore.contacts(user)` | Already handles public+hidden merge (degrading safely to public-only for kind 3, Pattern 1), already the documented applesauce accessor, zero new code |
| "Is this pubkey in a Set with a load timeout" | A bespoke `Promise.race`/manual timer | `firstValueFrom(contacts$.pipe(timeout({first, with})))` | Exactly `isMuted`'s already-proven, already-reviewed shape — same file, same convention |
| Per-category config migration | A hand-written one-off `if` outside `migrateConfig` | Extend the existing `migrateConfig` pure function (`services/config.ts:124`) | Already the established, pure, unit-tested extension point (D3-04/D-10 precedent); adding a case here keeps all config migrations in one auditable place |

**Key insight:** every piece of this phase's new code composes an already-exported,
already-documented applesauce primitive (`eventStore.contacts()`) or an already-established
in-repo pattern (`isMuted`'s timeout-fallback shape, `migrateConfig`'s pure-function shape,
`shouldNotify`'s "define a new gate, don't touch the old one" layering). The only genuinely novel
line of application logic in the entire phase is `isFollowed ? "contacts" : "others"`.

## Common Pitfalls

### Pitfall 1: Assuming `contacts$` needs a signer (it does not)

**What goes wrong:** Copying `mutedPubkeys$`'s `combineLatest([replaceable$, signer$])` +
`unlockHiddenMutes` shape wholesale for `contacts$`, on the assumption that kind-3 hidden tags
need the same decrypt treatment as kind-10000 hidden mutes.

**Why it happens:** `mutedPubkeys$` is the most recent, most similar-looking precedent in the
same file, and its shape (decrypt hidden tags when a signer is present) looks like the "more
complete" pattern to copy.

**How to avoid:** Kind 3 is not in applesauce's `HiddenTagsKinds` registry (Pattern 1) — build
`contacts$` off `user$` alone (mirroring `mailboxes$`'s simpler shape, which also has no signer
dependency), not `combineLatest([user$, signer$])`.

**Warning signs:** A `contacts$` implementation that imports `signer$` or calls
`unlockHiddenContacts` is over-built for what the installed package version actually does.

### Pitfall 2: `messages.enabled` has 6 call sites that must all move to the new schema together

**What goes wrong:** Changing `AppConfig.messages`'s type without a full sweep leaves some call
sites reading/writing a field that no longer exists (a silent `undefined` at runtime, since
`noUncheckedIndexedAccess`/`strict` won't catch a removed *object property* the same way it would
catch a removed variable — `tsc --noEmit` will catch each of these as type errors, which is a
good thing, but only if every reference is found and fixed).

**Why it happens:** `messages.enabled` is read/written in production code AND test fixtures, which
are easy to miss in one sweep.

**How to avoid:** Confirmed via `grep -rn "messages\.enabled"` (this session) — exactly 6
non-`.planning` call sites:
1. `notifications/messages.ts:78` — `enabled$`'s `map((c) => c.messages.enabled)`
2. `pages/messages.tsx:36` — `checked={messagesConfig.enabled}`
3. `pages/messages.tsx:154` (PATCH handler) — `messages: { enabled: !!enabled, ... }`
4. `helpers/preferences.ts:57` — `serializePrefs`'s `enabled: config.messages.enabled`
5. `helpers/preferences.ts:133` — `sanitizeSyncedPrefs`'s `enabled: asBoolean(messages.enabled)`
6. `helpers/preferences.ts:175` — `mergePrefs`'s `enabled: incoming.messages.enabled`

Plus 2 test-fixture references that must be updated in the same change:
`tests/helpers/preferences.test.ts:38` (`makeConfig()` fixture) and `:180,273` (assertions);
`tests/services/config.test.ts:50-62` (D3-04's migration tests, which will need to additionally
assert the new `contacts`/`others` shape, not just `enabled`).

**Warning signs:** `bun run lint` (`tsc --noEmit`) failing on any of the above after the schema
change is expected and should guide the sweep — do not suppress with `any`.

### Pitfall 3: D5-05's "both ON" is a deliberate *change* to today's new-install default, not a preservation of it

**What goes wrong:** Assuming "preserving today's notify for all DMs behavior" (D5-05's own
wording) means leaving the `config$` seed default unchanged.

**Why it happens:** The current `config$` `BehaviorSubject` seed (`services/config.ts:64-69`) is
`messages: { enabled: false, sendContent: false, whitelists: [], blacklists: [] }` — a **brand
new** install today starts with DM notifications entirely **off**. D5-05's "both ON" default is
about the *category split itself* being invisible to a user who already had DMs on (D5-06's
migration), not about matching the as-shipped `false` default for users who have never touched the
setting.

**How to avoid:** D5-05 is an explicit, locked decision — update the `config$` seed's `messages`
object to `{ contacts: { enabled: true }, others: { enabled: true }, sendContent: false,
whitelists: [], blacklists: [] }`. This is a real behavior change for brand-new installs (DMs
will now notify by default out of the box) — flag it in the plan/UAT so it's a conscious,
reviewed change, not an accidental side effect of the schema refactor.

**Warning signs:** A migration test asserting the *default* seed still yields `false` for both
flags would be testing the wrong thing — the correct new-install assertion is `true`/`true`; only
the *migration* path (an existing config.json with `messages.enabled: false`) should yield
`false`/`false`.

### Pitfall 4: Datastar signals are flat — a nested config shape does not imply a nested signal name

**What goes wrong:** Naming the new checkboxes' bound signals `contacts.enabled`/`others.enabled`
to mirror the new nested `AppConfig.messages` shape.

**Why it happens:** It's tempting to make the signal name match the config path 1:1.

**How to avoid:** Every existing Datastar-bound signal in this codebase is a flat identifier —
`enabled`, `sendContent`, `whitelists`, `blacklists` (`pages/messages.tsx`), `mode_${index}`
(`pages/groups.tsx`). Use `contactsEnabled`/`othersEnabled` as the two new flat signal names; map
them to the nested config shape only inside the PATCH handler.

**Warning signs:** A `data-bind` value containing a `.` has no precedent anywhere in this
codebase's existing pages — treat that as a signal (pun intended) something is off.

### Pitfall 5: A not-yet-upgraded peer device's synced payload can silently disable both categories

**What goes wrong:** `sanitizeSyncedPrefs` (`helpers/preferences.ts:115-157`) is a strict,
defensive coercer — any field absent from the raw decrypted payload coerces to a safe default via
`asBoolean(undefined) === false`. If Device A is upgraded to this phase's schema and Device B is
not yet (still publishing the old `{ messages: { enabled: true, whitelists: [...], ... } }`
shape, with no `contacts`/`others` keys at all), then Device A's `sanitizeSyncedPrefs` reading
Device B's inbound event would resolve `messages.contacts.enabled` and `messages.others.enabled`
to `false` — silently turning off DM notifications entirely on Device A the next time Device B's
older event is newer (D2-08's high-water-mark) or Device A boots and applies it.

**Why it happens:** D2-09's loop-prevention and D2-08's newest-wins reconciliation were designed
assuming both sides speak the same `SyncedPrefs` schema version — this phase is the first schema
version bump since `PREFS_VERSION` was introduced (currently `1`).

**How to avoid:** Bump `PREFS_VERSION` to `2` (`helpers/preferences.ts:20`) when landing this
phase's schema change. In `sanitizeSyncedPrefs`, detect when the raw payload's `messages` object
has no `contacts`/`others` keys (i.e., `raw.version` is missing or `< 2`, or simply
`messages.contacts`/`messages.others` are both absent) and in that case seed both flags from the
old `messages.enabled` boolean instead of defaulting to `false` — the same fallback logic
`migrateConfig` already applies locally (D5-06), applied a second time at the sync-ingest
boundary. This is not one of the 10 locked D5 decisions but follows directly from D5-10's "do not
break the existing sync round-trip" requirement once a schema version bump is introduced — flag
it to the user/planner as a recommended addition if not already covered.

**Warning signs:** A UAT scenario with two devices on different app versions is the only way this
regression would surface manually; an automated `sanitizeSyncedPrefs` unit test asserting the
old-schema-payload case is the reliable way to catch it (see Validation Architecture).

## Code Examples

### Example 1: `contacts$` / `isContact` — `services/nostr.ts`

```ts
// services/nostr.ts
// New import needed: kinds.Contacts is not required directly since
// eventStore.contacts() already resolves the kind internally; only
// ProfilePointer (already available via nostr-tools' re-exported type,
// or "applesauce-core/helpers/pointers") is needed for isContact's typing.
import type { ProfilePointer } from "nostr-tools";

/** An observable of the user's kind-3 follow list (NIP-02 Contacts, D5-01).
 *  No signer dependency -- kind 3 is not registered in applesauce's
 *  HiddenTagsKinds, so getContacts() never attempts a decrypt (see research
 *  Pattern 1/Pitfall 1). Re-emits reactively on any kind-3 update (D5-03). */
export const contacts$ = user$.pipe(
  switchMap((user) => eventStore.contacts(user)),
  shareAndHold(),
);

/** Returns true if the user follows `pubkey` (D5-01). Falls back to `false`
 *  ("not a contact") if the follow list cannot be loaded within 2s -- this
 *  IS the D5-02 fallback: an unresolved follow list and a genuinely
 *  not-followed sender both classify identically as "others". */
export async function isContact(pubkey: string): Promise<boolean> {
  const contacts = await firstValueFrom(
    contacts$.pipe(
      timeout({ first: 2000, with: () => of([] as ProfilePointer[]) }),
    ),
  );
  return contacts.some((c) => c.pubkey === pubkey);
}
```

### Example 2: Pure classifier — `notifications/dm-category.ts`

```ts
// notifications/dm-category.ts
// No top-level singleton imports -- safe to import directly in tests,
// mirroring notifications/legacy-messages.ts's network-safety precedent.

export type DmCategory = "contacts" | "others";

/**
 * Classifies a DM sender as "contacts" iff `isFollowed` is true; anything
 * else -- including "the follow list could not be determined in time" --
 * classifies as "others" (D5-01/D5-02). Pure and synchronous: callers
 * resolve `isFollowed` (e.g. via services/nostr.ts#isContact) before
 * calling this, so this function itself never touches the network, the
 * EventStore, or config.
 */
export function classifyDmSender(isFollowed: boolean): DmCategory {
  return isFollowed ? "contacts" : "others";
}
```

### Example 3: Layered gate in both `.subscribe()` callbacks — `notifications/messages.ts`

```ts
// notifications/messages.ts
import { classifyDmSender } from "./dm-category";
import { contacts$, isContact, /* existing imports */ } from "../services/nostr";

// NIP-04 .subscribe() callback -- add BEFORE the existing shouldNotify check:
.subscribe(async ({ sender, profile, content, event }) => {
  if (!content) return;

  // D5-07 step 1-2: category gate FIRST, stop here if the category is off.
  const category = classifyDmSender(await isContact(sender));
  const { messages } = getConfig();
  if (!messages[category].enabled)
    return log("Skipping notification: category disabled", { sender, category });

  // D5-07 step 3: existing shouldNotify gate, UNCHANGED.
  if (!(await shouldNotify(sender)))
    return log("Skipping notification for blacklisted/non-whitelisted sender", { sender });

  const displayName = getMessageDisplayName(profile, sender);
  await sendNotification({
    title: `${displayName} sent you a message`,
    message: messages.sendContent ? content : "[content omitted]",
    icon: getProfilePicture(profile),
    click: buildOpenLink(event),
  });
});

// NIP-17 .subscribe() callback -- identical gate, using rumor.pubkey as sender:
.subscribe(async (rumor) => {
  const { pubkey, messages } = getConfig();
  if (!pubkey) return;

  const sender = rumor.pubkey;

  // D5-07 step 1-2 (D5-09: same gate applied to the NIP-17 path).
  const category = classifyDmSender(await isContact(sender));
  if (!messages[category].enabled)
    return log("Skipping notification: category disabled", { sender, category });

  // D5-07 step 3: existing shouldNotify gate, UNCHANGED.
  if (!(await shouldNotify(sender)))
    return log("Skipping notification for blacklisted/non-whitelisted sender", { sender });

  const profile = await getValue(eventStore.profile(sender)).catch(() => undefined);
  const content = rumor.content;
  const displayName = getMessageDisplayName(profile, sender);

  await sendNotification({
    title: `${displayName} sent you a message`,
    message: messages.sendContent ? content : "[content omitted]",
    icon: getProfilePicture(profile),
    click: buildOpenLink(rumor as unknown as NostrEvent),
  });
});
```

### Example 4: `migrateConfig` extension — `services/config.ts`

```ts
// services/config.ts -- inside migrateConfig(parsed), after the existing
// directMessageNotifications reshape (so both old-old and old-new configs
// funnel through this one path) and before the groups.modes backfill:

// D5-06: split messages.enabled into per-category contacts/others flags,
// seeding BOTH from the pre-existing value so upgraders see no behavior
// change. Runs whether messages.enabled came from this migration's own
// directMessageNotifications reshape above, or was already present from a
// Phase-3/4-era config.json.
if (
  parsed.messages &&
  typeof parsed.messages === "object" &&
  parsed.messages.contacts === undefined &&
  parsed.messages.others === undefined
) {
  const legacyEnabled = parsed.messages.enabled === true;
  parsed.messages.contacts = { enabled: legacyEnabled };
  parsed.messages.others = { enabled: legacyEnabled };
  delete parsed.messages.enabled;
}
```

Also update the `config$` seed default (`services/config.ts:64-69`, D5-05):
```ts
messages: {
  contacts: { enabled: true },
  others: { enabled: true },
  sendContent: false,
  whitelists: [],
  blacklists: [],
},
```

### Example 5: Two-section UI + PATCH signals — `pages/messages.tsx`

```tsx
// pages/messages.tsx -- GET view, replacing the single "enabled" checkbox
// with two sections. Flat signal names (Pitfall 4): contactsEnabled / othersEnabled.
<div class="form-group">
  <h3>Contacts</h3>
  <input
    type="checkbox"
    id="contactsEnabled"
    data-bind="contactsEnabled"
    checked={messagesConfig.contacts.enabled}
  />
  <label for="contactsEnabled">Notify for DMs from people you follow</label>
</div>

<div class="form-group">
  <h3>Others</h3>
  <input
    type="checkbox"
    id="othersEnabled"
    data-bind="othersEnabled"
    checked={messagesConfig.others.enabled}
  />
  <label for="othersEnabled">Notify for DMs from people you don't follow</label>
</div>

{/* sendContent + WhitelistBlacklist stay shared, unchanged (D5-04/D5-08) */}
```

```ts
// pages/messages.tsx -- PATCH handler
const contactsEnabled = signals.contactsEnabled as boolean;
const othersEnabled = signals.othersEnabled as boolean;
// ... existing sendContent/whitelists/blacklists parsing unchanged ...

const newConfig = {
  ...currentConfig,
  messages: {
    contacts: { enabled: !!contactsEnabled },
    others: { enabled: !!othersEnabled },
    sendContent: !!sendContent,
    whitelists,
    blacklists,
  },
};
```

### Example 6: `helpers/preferences.ts` extension (D5-10 + Pitfall 5)

```ts
// helpers/preferences.ts
export const PREFS_VERSION = 2; // bumped for the D5-10 schema change

export type SyncedPrefs = {
  version: number;
  messages: {
    contacts: { enabled: boolean };
    others: { enabled: boolean };
    whitelists: string[];
    blacklists: string[];
  };
  // ... replies/zaps/groups/whitelists/blacklists/appLink unchanged ...
};

export function serializePrefs(config: AppConfig): SyncedPrefs {
  return {
    version: PREFS_VERSION,
    messages: {
      contacts: { enabled: config.messages.contacts.enabled },
      others: { enabled: config.messages.others.enabled },
      whitelists: config.messages.whitelists,
      blacklists: config.messages.blacklists,
    },
    // ... unchanged ...
  };
}

// sanitizeSyncedPrefs -- Pitfall 5: fall back to the OLD flat `enabled`
// field when an inbound payload has no contacts/others keys (a peer device
// still running pre-Phase-5 code).
function asMessagesCategories(raw: Record<string, unknown>): {
  contacts: { enabled: boolean };
  others: { enabled: boolean };
} {
  if (raw.contacts !== undefined || raw.others !== undefined) {
    const contacts = (raw.contacts ?? {}) as Record<string, unknown>;
    const others = (raw.others ?? {}) as Record<string, unknown>;
    return {
      contacts: { enabled: asBoolean(contacts.enabled) },
      others: { enabled: asBoolean(others.enabled) },
    };
  }
  // Old-schema payload (pre-Phase-5 peer device): seed both from the
  // legacy flat `enabled` field instead of silently defaulting to false.
  const legacyEnabled = asBoolean(raw.enabled);
  return {
    contacts: { enabled: legacyEnabled },
    others: { enabled: legacyEnabled },
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Single `messages.enabled` flag for all DM senders | Split `messages.contacts.enabled` / `messages.others.enabled` (D5-04/05/06) | This phase | Enables per-audience notification control, matching the pattern already established for group-notification modes in Phase 1 |
| `messages.enabled` synced verbatim via kind-30078 (`PREFS_VERSION = 1`) | Two nested booleans, `PREFS_VERSION = 2`, with an old-schema fallback (Pitfall 5) | This phase | First schema version bump since Phase 2 introduced sync — establishes the precedent for how future schema bumps should handle not-yet-upgraded peer devices |

**Deprecated/outdated:**
- `AppConfig.messages.enabled` (flat boolean): superseded by `messages.contacts.enabled` /
  `messages.others.enabled`. Do not reintroduce a flat `messages.enabled` field.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Nested `messages.contacts.enabled`/`messages.others.enabled` (not flat `messages.contactsEnabled`) is the better schema layout | Architecture Patterns §2 | Low risk — this is explicitly Claude's Discretion per CONTEXT.md; a flat layout is a mechanical rename if the planner prefers it, and does not change any of the migration/sync/gate logic described here |
| A2 | Removing `messages.enabled` entirely (rather than keeping a derived field) is the right call | Architecture Patterns §2 / Alternatives Considered | Low-medium risk — if the planner instead wants a derived back-compat field for some external consumer this research didn't find, the 6-call-site sweep in Pitfall 2 would need one additional write-back step; no evidence of an external consumer was found (this app has no public API surface reading `AppConfig` directly other than its own pages/tests) |
| A3 | A `PREFS_VERSION` bump to 2 plus an explicit old-schema fallback in `sanitizeSyncedPrefs` is needed for D5-10 | Pitfall 5 | Medium risk if skipped — a household running two devices at different app versions during a rolling upgrade could see DM notifications silently disable on the newer device until both devices are upgraded. Not one of the 10 locked decisions; flagged as a strong recommendation, not a requirement, since CONTEXT.md's D5-10 language ("do not break the existing sync round-trip") is the closest anchor but doesn't explicitly name the multi-device-version scenario |
| A4 | `classifyDmSender` should take an already-resolved `boolean` (not `pubkey` + `Set<string>`) | Architecture Patterns §3 / Alternatives Considered | Low risk — a `(pubkey, followedSet)` signature is equally valid and arguably slightly more "pure" (no boolean pre-resolution burden on the caller); the boolean-in shape was chosen to keep `isContact`'s I/O and the classification's decision logic maximally separated. Either shape satisfies D5-01/D5-02's testability requirement |

## Open Questions

1. **Should `isContact`'s per-lookup `O(list length)` linear scan (`.some(c => c.pubkey === pubkey)`) be replaced with a cached `Set<string>` for high-follow-count users?**
   - What we know: `mutedPubkeys$`/`isMuted` uses the exact same `.has(pubkey)` shape but on a
     `Set`, because `getMutedThings(event).pubkeys` already returns a `Set`. `getContacts()`
     returns a `ProfilePointer[]`, not a `Set`.
   - What's unclear: whether real-world follow-list sizes (hundreds to low thousands) make the
     linear scan meaningfully slower than the mute-list `Set.has()` in practice for this
     single-process, low-QPS notification server.
   - Recommendation: keep `isContact`'s `.some()` scan for this phase (simplicity, matches the
     `ProfilePointer[]` shape `getContacts()` naturally returns); if profiling later shows this
     matters, map `contacts$` to a `Set<string>` of pubkeys downstream of the raw `ProfilePointer[]`
     read, mirroring `mutedPubkeys$`'s own internal `Set` shape exactly.

2. **Does `pages/messages.tsx`'s help text need to explain the contacts/others split to end users, beyond the two section headers?**
   - What we know: D5-08 only requires two labeled sections with their own toggles; it does not
     specify copy.
   - What's unclear: whether "Contacts" alone is self-explanatory, or needs a one-line help-text
     clarifying it means "people you follow (NIP-02 kind-3 contact list)".
   - Recommendation: add a short help-text line under each section header (mirroring the existing
     `.help-text` convention already used elsewhere on this page for `sendContent`), left to the
     planner/implementer's discretion for exact wording.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun runtime + `bun:test` | Running the new/extended test suite | Yes (already used by 9 existing test files) | matches `@types/bun ^1.3.14` in package.json | — |
| Installed `applesauce-core` v6.2.0 | `EventStore.contacts()`/`ContactsModel`/`getContacts` | Yes — confirmed via direct `node_modules` source reads this session | `applesauce-core@6.2.0` (package.json range `^6.2.0`) | — |
| A live kind-3 follow-list event + a real DM sender (contact vs. non-contact) | Full manual/UAT verification that a real followed sender is classified "contacts" and a real non-followed sender is classified "others" | Not verifiable in this research session (requires a live signer session with a real kind-3 event and real incoming DMs, same constraint noted for phases 1-4 in prior research) | — | Automated tests (`classifyDmSender`, `isContact`-shape timeout fallback, `migrateConfig`, `sanitizeSyncedPrefs`) cover the deterministic logic without any relay; full end-to-end confirmation deferred to human UAT |

**Missing dependencies with no fallback:** none — a live signer/relay session with real kind-3
data is only needed for final human UAT, not for implementation or automated testing.

**Missing dependencies with fallback:** live kind-3/DM session (see above) — automated tests
substitute for the deterministic classification/migration/sync logic.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (bundled with Bun; already used — 9 existing test files) |
| Config file | `bunfig.toml` (`[test] preload = ["./tests/setup.ts"]` — isolates `CONFIG` env so tests never touch the real `config.json`) |
| Quick run command | `bun test tests/notifications/dm-category.test.ts tests/services/config.test.ts tests/helpers/preferences.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D5-01/D5-02 | `classifyDmSender(true) === "contacts"`, `classifyDmSender(false) === "others"` (including the "unavailable" case, since `isContact`'s timeout fallback and a genuine non-follow both resolve to `false`) | unit | `bun test tests/notifications/dm-category.test.ts` | ❌ Wave 0 — new file |
| D5-01/D5-03 | `eventStore.contacts(pubkey)` resolves the real public contacts from a manually `.add()`'d kind-3 event, with zero network risk (a bare `new EventStore()` with no `eventLoader` wired never calls a loader for a cache hit — confirmed via `models/base.js`'s `store.eventLoader ? loadEventUsingFallback(...) : identity` branch) | integration (network-safe) | `bun test tests/notifications/dm-category.test.ts` (or a co-located `tests/services/contacts.test.ts`) | ❌ Wave 0 — new, optional-but-recommended coverage |
| D5-07 | category-off ⇒ stop, before `shouldNotify` runs; category-on ⇒ falls through to (unmodified) `shouldNotify` | unit | `bun test tests/notifications/messages.test.ts` (extend the existing gate-order mirror `describe` block with a category-layer truth table, WR-04-style) | ✅ existing file — add new `describe` block |
| D5-06 | `migrateConfig` seeds `contacts.enabled`/`others.enabled` from the legacy `messages.enabled` for both `true` and `false`, and a genuinely blank config gets `true`/`true` only via the `config$` default seed (not via `migrateConfig`, which only runs when `config.json` already exists) | unit | `bun test tests/services/config.test.ts` | ✅ existing file — add new test cases |
| D5-10 | `serializePrefs`/`sanitizeSyncedPrefs`/`mergePrefs` round-trip the two new nested booleans; an old-schema payload (no `contacts`/`others` keys) falls back to the legacy `enabled` field instead of defaulting to `false` (Pitfall 5) | unit | `bun test tests/helpers/preferences.test.ts` | ✅ existing file — extend fixture + add old-schema-payload case |

### Sampling Rate

- **Per task commit:** `bun test tests/notifications/dm-category.test.ts tests/notifications/messages.test.ts tests/services/config.test.ts tests/helpers/preferences.test.ts`
- **Per wave merge:** `bun test` (full suite) and `bun run lint` (`tsc --noEmit`, per `package.json` script and this project's `.planning/config.json` `build_command`)
- **Phase gate:** Full suite green + lint clean before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/notifications/dm-category.test.ts` — covers D5-01/D5-02's pure classifier, including
  the "unavailable → others" fallback case, plus a WR-04-style local mirror of the composed
  category-enabled lookup (`messages[classifyDmSender(isFollowed)].enabled`)
- [ ] `tests/services/config.test.ts` — add `migrateConfig` cases for D5-06 (legacy
  `messages.enabled: true`/`false` both correctly seed both new flags; a config already on the new
  schema is left untouched — i.e. the migration step must be idempotent)
- [ ] `tests/helpers/preferences.test.ts` — update `makeConfig()` fixture to the new
  `messages.contacts`/`messages.others` shape; add a `sanitizeSyncedPrefs` case for an old-schema
  (`{ messages: { enabled: true, whitelists: [...], blacklists: [...] } }`, no `contacts`/`others`
  keys) payload asserting the Pitfall-5 fallback fires
- [ ] `tests/notifications/messages.test.ts` — extend with a category-gate truth table (category
  off ⇒ stop before `shouldNotify` is even relevant; category on ⇒ existing `shouldNotify` mirror
  behavior unchanged)
- No dedicated `tests/services/nostr.test.ts` gap: consistent with existing precedent, this
  codebase does not directly unit-test `services/nostr.ts`'s reactive observables (`groups$`,
  `mutedPubkeys$`, and now `contacts$`) — only the pure/composable logic built on top of them is
  unit-tested. `contacts$`/`isContact` are covered indirectly by the network-safe `EventStore`
  integration test above (recommended, not required).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | No auth surface touched by this phase |
| V3 Session Management | No | — |
| V4 Access Control | No | — |
| V5 Input Validation | Yes | `sanitizeSyncedPrefs`'s existing `asBoolean`/`asStringArray` coercion pattern (`helpers/preferences.ts:84-92`) must be extended identically for the two new nested booleans — never trust an inbound decrypted kind-30078 payload's shape (already an explicit interop surface per D2-04) |
| V6 Cryptography | No | This phase reads only the **public** portion of a kind-3 event (Pattern 1) — no new decryption path is introduced. The existing kind-30078 NIP-44 sync pipeline (Phase 2) is unchanged by this phase beyond the payload's field shape |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| A malformed/garbage kind-3 event (bad tag shapes) throws while parsing during classification | Denial of Service | `getPublicContacts`'s `processTags` already defensively filters to well-formed `p` tags only (existing applesauce behavior, unchanged by this phase); `isContact`'s `timeout(...)` fallback additionally bounds any pathological load delay to 2s |
| A not-yet-upgraded peer device's old-schema sync payload silently disables both DM categories on an upgraded device (Pitfall 5) | (soft) Denial of Service / availability regression, not a security vulnerability per se | The `PREFS_VERSION` bump + old-schema fallback recommended in Pitfall 5/Example 6 |
| A brand-new install now defaults to notifying for ALL DM senders (D5-05's "both ON") where previously DMs were off entirely by default | Information Disclosure (mild) — a user who never visits `/messages` now receives push notifications, including sender display names, to their configured ntfy topic, by default | This is an explicit, locked, user-facing product decision (D5-05), not a bug; `sendContent` (message body) remains off by default regardless (D5-04, unchanged) — only the sender's display name/profile picture and existence of a DM are ever exposed by default, matching the current NIP-04/NIP-17 phases' pre-existing `sendContent`-gated privacy model |

## Sources

### Primary (HIGH confidence)

- `node_modules/applesauce-core/dist/event-store/event-models.{js,d.ts}` — `EventModels.contacts(user)`,
  `.mailboxes(user)`, `.profile(user)`, `.model()` (installed v6.2.0, read directly)
- `node_modules/applesauce-core/dist/models/contacts.{js,d.ts}` — `ContactsModel`,
  `PublicContactsModel`, `HiddenContactsModel` (installed v6.2.0, read directly)
- `node_modules/applesauce-core/dist/helpers/contacts.{js,d.ts}` — `getContacts`,
  `getPublicContacts`, `getHiddenContacts`, `mergeContacts`, `unlockHiddenContacts` (installed
  v6.2.0, read directly)
- `node_modules/applesauce-core/dist/helpers/hidden-tags.js` — `HiddenTagsKinds` registry
  confirming kind 3 (`Contacts`) is absent, `canHaveHiddenTags`, `getHiddenTags` (installed
  v6.2.0, read directly)
- `node_modules/applesauce-core/dist/models/base.js` — `loadEventUsingFallback`'s
  `store.eventLoader ? ... : identity` branch, confirming a bare `EventStore` with no wired loader
  never attempts network I/O even on a cache miss (installed v6.2.0, read directly)
- `node_modules/nostr-tools/lib/cjs/kinds.js` — confirmed `Contacts = 3` (installed v2.23.x, read
  directly)
- Project source: `services/nostr.ts`, `notifications/messages.ts`,
  `notifications/legacy-messages.ts`, `notifications/gift-wrap-messages.ts`, `services/config.ts`,
  `helpers/preferences.ts`, `pages/messages.tsx`, `pages/groups.tsx`,
  `components/WhitelistBlacklist.tsx`, `const.ts`, `helpers/observable.ts`,
  `tests/services/config.test.ts`, `tests/notifications/legacy-messages.test.ts`,
  `tests/notifications/messages.test.ts`, `tests/helpers/preferences.test.ts`, `tests/setup.ts`,
  `bunfig.toml`, `tests/fixtures/config-pre-modes.json`,
  `.planning/phases/02-.../02-CONTEXT.md`, `.planning/phases/03-.../03-RESEARCH.md`,
  `.planning/phases/04-.../04-RESEARCH.md`, `.planning/codebase/ARCHITECTURE.md`,
  `.planning/codebase/CONVENTIONS.md` — all read directly this session

### Secondary (MEDIUM confidence)

- `applesauce` skill reference bundle (`~/.claude/skills/applesauce/references/overview.md`,
  `references/packages/core.md`) [CITED: applesauce skill curated docs, sourced from
  applesauce.build] — confirms `ContactsModel` is part of the documented base-model set and that
  `eventStore.model(ModelFn, ...args)` is the documented consumption pattern (generalized from the
  `ProfileModel`/`TimelineModel` examples shown)

### Tertiary (LOW confidence)

- None — no ungrounded WebSearch-only claims were needed for this phase; every technical claim was
  verifiable directly against the installed package source and this project's own codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; `EventStore.contacts()`'s existence and exact
  behavior (including the kind-3/`HiddenTagsKinds` non-membership finding) verified against
  installed `node_modules` source, not training-data recollection
- Architecture: HIGH — every recommended new piece mirrors an already-shipped, working pattern in
  this exact codebase (`mailboxes$`/`isMuted`'s shapes, `shouldNotify`'s "don't touch the existing
  gate" layering, `migrateConfig`'s pure-function extension point)
- Pitfalls: HIGH — Pitfall 2's 6-call-site enumeration and Pitfall 3's default-value discrepancy
  were both confirmed by direct `grep`/read against the current codebase, not inferred; Pitfall 5
  (sync-schema-version) is a genuinely new finding not named by any of the 10 locked decisions,
  flagged clearly as a recommendation rather than a requirement
- Security domain: MEDIUM — the "brand-new installs now notify by default" behavior-change
  framing (Security Domain's third row) is a direct, faithful reading of D5-05's explicit wording,
  but its user-facing privacy implications were not independently re-litigated with the user in
  this research session (that discussion already happened in `/gsd-discuss-phase`, producing D5-05
  as a locked decision)

**Research date:** 2026-07-10
**Valid until:** 30 days (stable, low-churn domain — `applesauce-core` v6.2.0 is the pinned range;
a `bun update` that jumps a major version would invalidate the exact source line numbers cited
here, per CONCERNS.md's existing "applesauce-* v6 suite (recently migrated)" risk note)
