# Phase 1: NIP-29 group notification modes - Research

**Researched:** 2026-07-07
**Domain:** NIP-29 relay-based groups, NIP-27 content mentions, Datastar server-rendered config UI, RxJS notification pipeline
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Three per-group modes: **All messages**, **Only @mentions**, **Muted**.
  - *All messages* = current behavior (notify on every group message, subject to the
    existing sender gate — see D-09).
  - *Only @mentions* = notify only when the user is mentioned (see D-02).
  - *Muted* = never notify for that group.
- **D-02:** A message counts as an **@mention** of the user when EITHER:
  - the group message has a `p` tag equal to the user's pubkey, OR
  - the message content contains a `nostr:` mention (npub/nprofile) encoding the
    user's pubkey.
  Both are OR'd — either one triggers a mention notification.
- **D-03:** The per-group mode controls live on the existing **`/groups`** page
  (`pages/groups.tsx`), as a list of the user's joined groups. The page keeps its
  existing global controls (group link template, whitelist/blacklist).
- **D-04:** Each group row shows the group's **picture + name + a mode dropdown**
  (`All / Only @mentions / Muted`). Picture and name come from the group's kind
  39000 metadata (reuse `helpers/groups.ts` `getGroupMetadata`).
- **D-05:** The `/notifications` view keeps a single **Groups card**, updated to
  show a **per-group summary** (e.g. counts of groups on All / Mentions / Muted),
  and links through to `/groups` for editing.
- **D-06:** The default mode for any group with no mode set — including **all
  existing users' groups** and any newly joined group — is **Only @mentions**.
- **D-07:** ⚠ Behavior change for existing users. Today, when group notifications
  are enabled, existing users receive *all* messages from every joined group.
  Under D-06 they will drop to *mentions-only* until they opt a group up to
  "All messages". This is a deliberate quieter-by-default choice, NOT a silent
  regression — surface it in the changelog / release notes and consider a
  one-time note in the UI. Planning should decide whether existing installs get
  any migration messaging.
- **D-08:** The existing global `groups.enabled` toggle stays as a **master
  switch**. When OFF, no group notifies regardless of per-group mode. When ON,
  each group follows its own mode. `groups.enabled` is NOT removed or replaced
  by per-group modes.

### Claude's Discretion

- **D-09 (layering):** Evaluation order for a group message is: (1) master switch
  `groups.enabled` — off ⇒ stop; (2) that group's mode — Muted ⇒ stop,
  Only @mentions ⇒ continue only if the message mentions the user per D-02,
  All ⇒ continue; (3) the **existing** `shouldNotify` sender gate in
  `notifications/groups.ts` (mute list + group whitelist/blacklist + global
  whitelist/blacklist) still applies unchanged on top. Per-group mode must not
  bypass the existing mute/whitelist/blacklist checks.
- **D-10 (config storage shape):** How per-group modes are stored in `AppConfig`
  (e.g. a `groups.modes` map keyed by encoded group pointer / naddr via
  `encodeGroupPointer`, plus a default) is left to planning. Must round-trip
  through the existing `config.json` persistence and survive groups joining/leaving
  the kind 10009 list. Follow the existing config-migration pattern in
  `services/config.ts:92-101` if a schema migration is needed.

### Deferred Ideas (OUT OF SCOPE)

- Whitelist-only mode (notify only from listed senders) as a fourth per-group mode
  — considered and dropped for Phase 1; overlaps with the existing
  whitelist/blacklist.
- Unsubscribing from a Muted group's relay subscription to save connections — an
  optimization, not required for correctness (Muted can simply drop before
  notifying). Revisit if relay/connection load becomes a concern.
- Persisting these preferences as an encrypted 1xxxx nostr event — explicitly
  Phase 2.

</user_constraints>

<phase_requirements>
## Phase Requirements

No formal REQUIREMENTS.md exists for this project; phase requirements are fully
captured as decisions D-01 through D-10 in `01-CONTEXT.md` (see User Constraints
above). This table maps each decision to the research that supports it.

| ID | Description | Research Support |
|----|-------------|------------------|
| D-01 | Three modes: All / Only @mentions / Muted | Architecture Patterns → Pattern 1; Code Examples |
| D-02 | Mention = p-tag OR `nostr:` content mention | Architecture Patterns → Pattern 2; Code Examples (`getContentPointers`/`getPubkeyFromDecodeResult`) |
| D-03/D-04 | `/groups` page: per-group list, picture+name+dropdown | Existing Code Insights → `pages/groups.tsx`; Pitfall 3 (dead `getGroupMetadata`) |
| D-05 | `/notifications` Groups card summary | Existing Code Insights → `pages/notifications.tsx` |
| D-06/D-07 | Default mode = mentions; behavior-change messaging | Config Storage Shape (D-10) section; Pitfall 1 |
| D-08/D-09 | Master switch + layering order | Architecture Patterns → System Architecture Diagram; Pitfall 4 |
| D-10 | Config storage shape + migration | Config Storage Shape (D-10) section; Pitfall 1 |

</phase_requirements>

## Summary

This phase extends the existing NIP-29 group notification pipeline
(`notifications/groups.ts`) with a per-group mode gate that sits between the
existing master switch (`config.groups.enabled`) and the existing
`shouldNotify` sender gate. All the primitives needed already exist in
dependencies already installed in `package.json` — no new packages are
required. `applesauce-common@6.1.0` exports `GROUP_MESSAGE_KIND` (=9),
`getGroupPointerFromGroupTag`, and `encodeGroupPointer`/`decodeGroupPointer`
(verified directly against the installed `node_modules` source, not just
type declarations). `applesauce-core@6.1.0` exports `getContentPointers` and
`getPubkeyFromDecodeResult` from `applesauce-core/helpers`, which together are
the exact, already-used-elsewhere-in-this-ecosystem building blocks for D-02's
`nostr:` content-mention check — no regex needs to be hand-rolled.

The two riskiest parts of this phase are not the NIP-29 plumbing (well
understood, already working) but (1) a **shallow config-merge landmine**: the
existing boot-time config loader in `services/config.ts` does
`config$.next({ ...config$.value, ...parsed })`, which replaces the entire
`groups` object from `config.json` wholesale rather than deep-merging it — so
adding a new `groups.modes` field to the in-memory default will **not**
appear for any existing installation unless the loader explicitly backfills
it, exactly like the existing `messages` migration at `services/config.ts:92-101`
does. And (2) a **Datastar signal-naming landmine**: `encodeGroupPointer`
produces keys like `relay.example.com'abc123` containing a literal apostrophe
and dots — Datastar signal paths use dot-notation for nested objects, so this
string is unsafe to use directly as a `data-bind` signal name. The per-group
mode form must use index-based signal names (`mode_0`, `mode_1`, …) and
reconstruct the `encodeGroupPointer`-keyed map server-side in the PATCH
handler, not client-side.

A third, smaller finding: `helpers/groups.ts`'s `getGroupMetadata(group)` (the
one D-04 says to reuse) is currently **dead code with zero callers** — its
in-memory cache is never populated in production. This phase will be its
first real caller, and it shares a name (but a completely different
signature) with `applesauce-common/helpers`'s own `getGroupMetadata(event)`,
which parses a raw kind 39000 event into a typed `GroupMetadata` object. Both
are useful together (project helper fetches the event, applesauce helper
parses it) but importing both in the same file requires an alias to avoid a
name collision.

**Primary recommendation:** Extract the new mode + mention gating logic as a
pure, exported, unit-testable function (e.g.
`resolveGroupNotificationDecision` in a new or existing helper module),
called from the existing `.subscribe()` callback in `notifications/groups.ts`
immediately after the master-switch check and immediately before the existing
`shouldNotify` call — this satisfies the D-09 layering order, keeps the
existing sender gate untouched, and (unlike the four already-duplicated
`shouldNotify` implementations flagged in `.planning/codebase/CONCERNS.md`)
is testable without mocking `RelayPool`/`EventStore`.

## Architectural Responsibility Map

This is a single-process app with no separate frontend/backend split; the
table below maps each capability onto the project's existing internal layers
(`.planning/codebase/ARCHITECTURE.md`), using the closest equivalent tier.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-group mode + mention gating | API/Backend (Notification Listener Layer, `notifications/groups.ts`) | — | Business logic that decides whether an incoming Nostr event produces a push notification; must sit alongside the existing `shouldNotify` sender gate it composes with |
| Per-group mode storage (`AppConfig.groups.modes`) | Database/Storage (`services/config.ts` + `config.json`) | — | Single `BehaviorSubject<AppConfig>` is this app's only persistence layer; no separate DB |
| `/groups` page: group list + mode dropdowns | Frontend Server / SSR (`pages/groups.tsx`) | Browser/Client (Datastar reactive `data-bind`) | Server renders the list from `groups$` + `getGroupMetadata`; Datastar signals hold in-browser dropdown state until PATCH |
| `/notifications` Groups card summary | Frontend Server / SSR (`pages/notifications.tsx`) | — | Read-only aggregate render of `config.groups.modes`, no new client interactivity needed |
| Group message subscription (unchanged) | API/Backend (`notifications/groups.ts` `subscribeToGroup`) | CDN/Static — N/A | Existing relay subscription pipeline; this phase does not change *what* is subscribed to, only what happens after a message arrives |

## Standard Stack

### Core

No new dependencies. Every capability this phase needs is already present in
`package.json` and already imported elsewhere in the codebase.

| Library | Version (installed) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `applesauce-common` | 6.1.0 `[VERIFIED: node_modules/applesauce-common/package.json]` | `GROUP_MESSAGE_KIND`, `getGroupPointerFromGroupTag`, `encodeGroupPointer`, `decodeGroupPointer`, `GroupPointer` type | Already the project's sole source of NIP-29 group helpers (`notifications/groups.ts`, `helpers/groups.ts`, `helpers/link.ts`, `services/nostr.ts` all import from it) |
| `applesauce-core` | 6.1.0 `[VERIFIED: node_modules/applesauce-core/package.json]` | `getContentPointers`, `getPubkeyFromDecodeResult` (from `applesauce-core/helpers`) for D-02's `nostr:` content-mention check | Same package already imported for `getDisplayName`, `getProfilePicture`, `getTagValue` in `notifications/groups.ts` |
| `nostr-tools` | 2.23.5 `[VERIFIED: node_modules/nostr-tools/package.json]` | Underlying NIP-19 codec (`nostr-tools/nip19`) that `applesauce-core/helpers` wraps; not imported directly for this phase but is the transitive source of truth | `GROUP_MESSAGE_KIND = kinds.ChatMessage = 9`, confirmed in `node_modules/nostr-tools/lib/esm/kinds.js:68` |

**Version note:** npm registry currently publishes `applesauce-common@6.2.0` /
`applesauce-core@6.2.0` (checked via `npm view`, 2026-06-26 publish date) and
`nostr-tools@2.23.9`, one to four minor/patch versions ahead of what's
installed. `package.json` uses `^6.1.0` / `^2.23.5` ranges so a `bun install`
could pick these up. All APIs this research relies on
(`getContentPointers`, `getPubkeyFromDecodeResult`, `encodeGroupPointer`,
`GROUP_MESSAGE_KIND`) are stable exports present since the v6 line per the
installed source; no evidence of a breaking change, but do not run `bun
update` mid-phase without re-running `bun run lint`
(`.planning/codebase/CONCERNS.md` "applesauce-* v6 suite" already flags this
as a general risk).

### Supporting

None needed — no new UI library, no new validation library. The mode enum is
a plain string union type (`"all" | "mentions" | "muted"`), consistent with
how the rest of `AppConfig` models booleans/strings/arrays directly rather
than through a schema library (there is no schema-validation layer in this
codebase — `.planning/codebase/ARCHITECTURE.md` "Validation" cross-cutting
concern confirms this).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `getContentPointers` + `getPubkeyFromDecodeResult` (regex-based, `applesauce-core/helpers`) | `getParsedContent` full AST parser (`applesauce-content/text`, per `applesauce` skill `references/packages/content.md`) | The AST parser is the right tool for *rendering* content with rich mention chips; for a boolean "does this content mention pubkey X" check it is unnecessary overhead and `applesauce-content` is not even installed as a dependency — would require adding a new package for no functional gain |
| `Record<string, GroupNotificationMode>` map keyed by `encodeGroupPointer` | An array of `{ group: GroupPointer, mode }` objects | The map form gives O(1) lookup in the hot notification path and avoids storing duplicate `GroupPointer` shape already available from `groups$`; the array form must round-trip mode encoding via `id === group.id && relay === group.relay` matching, invented by the plan with more edge cases |

**Installation:** None required.

## Package Legitimacy Audit

Not applicable. This phase introduces zero new external package dependencies.
All required functions (`GROUP_MESSAGE_KIND`, `getGroupPointerFromGroupTag`,
`encodeGroupPointer`, `getContentPointers`, `getPubkeyFromDecodeResult`) come
from `applesauce-common` and `applesauce-core`, both already declared in
`package.json` and already imported by the exact files this phase touches
(`notifications/groups.ts`, `helpers/groups.ts`). No `package-legitimacy
check` run needed.

## Architecture Patterns

### System Architecture Diagram

```
   kind 10009 (groups$)                config.json (AppConfig.groups)
          │                                      │
          ▼                                      ▼
  ┌───────────────┐                    ┌───────────────────┐
  │ group list of  │                    │ groups.enabled     │◄─── master switch (D-08)
  │ GroupPointer   │                    │ groups.modes{key}  │◄─── per-group mode map (D-10)
  └──────┬────────┘                    └─────────┬──────────┘
         │ subscribeToGroup(group) per group                │
         ▼                                                  │
  ┌────────────────────────────┐                            │
  │ relay subscription          │                            │
  │ kind 9 (GROUP_MESSAGE_KIND) │                            │
  └──────────────┬──────────────┘                            │
                 ▼                                            │
     ┌───────────────────────────┐                            │
     │ .subscribe(({group,       │                            │
     │   metadata, message}) =>{ │◄───────────────────────────┘
     │                            │
     │  1. enabled$ gate (existing, unchanged) — groups.enabled off ⇒ NEVER
     │        │
     │        ▼
     │  2. NEW: resolveGroupNotificationDecision(mode, message, userPubkey)
     │     ─ mode = groups.modes[encodeGroupPointer(group)] ?? DEFAULT_GROUP_MODE
     │     ─ "muted"    ⇒ stop
     │     ─ "mentions" ⇒ continue only if pTagMentions(message) || contentMentions(message)
     │     ─ "all"      ⇒ continue
     │        │
     │        ▼
     │  3. shouldNotify(message.pubkey)  (existing, UNCHANGED — mute list +
     │     group whitelist/blacklist + global whitelist/blacklist)
     │        │
     │        ▼
     │  4. sendNotification(...)  (existing, unchanged)
     └───────────────────────────┘

  Datastar UI (pages/groups.tsx):
    GET  → render one row per groups$ entry: picture+name (getGroupMetadata
           chain) + <select data-bind="mode_{index}">
    PATCH → readSignals() → zip mode_0..mode_N positionally with the SAME
           groups$ list fetched server-side → build
           Record<encodeGroupPointer(group), mode> → config$.next(...)

  Datastar UI (pages/notifications.tsx):
    GET  → read config.groups.modes, count by mode value, render summary
           card, link to /groups (no new signals/PATCH needed)
```

### Recommended Project Structure

No new directories. Touch these existing files:

```
services/config.ts        # AppConfig.groups.modes field + migration backfill
notifications/groups.ts   # wire the mode+mention gate into the existing subscribe()
helpers/groups.ts         # export the new pure gating helper(s) here (colocated
                           # with getGroupMetadata, consistent with existing
                           # "Helper Layer: pure-ish utility functions" pattern)
pages/groups.tsx           # render per-group rows + mode dropdowns, extend PATCH
pages/notifications.tsx    # extend Groups card with per-mode summary counts
```

### Pattern 1: Mode resolution with explicit default (D-06/D-10)

**What:** A pure function that resolves a group's effective mode from the
config map, falling back to the mentions-only default, then applies the mode
semantics.
**When to use:** Called once per incoming group message, inside the existing
`.subscribe()` callback in `notifications/groups.ts`, before `shouldNotify`.
**Example:**
```typescript
// New file or addition to helpers/groups.ts
// Source: derived from applesauce-common/helpers (installed v6.1.0) + D-01/D-02/D-06
import {
  encodeGroupPointer,
  type GroupPointer,
} from "applesauce-common/helpers";
import {
  getContentPointers,
  getPubkeyFromDecodeResult,
} from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";

export type GroupNotificationMode = "all" | "mentions" | "muted";

/** Default mode for any group not present in the per-group mode map (D-06) */
export const DEFAULT_GROUP_NOTIFICATION_MODE: GroupNotificationMode =
  "mentions";

/** Returns true if `message` mentions `pubkey` via a "p" tag or a nostr: content reference (D-02) */
export function messageMentionsPubkey(
  message: NostrEvent,
  pubkey: string,
): boolean {
  const pTagged = message.tags.some((t) => t[0] === "p" && t[1] === pubkey);
  if (pTagged) return true;

  return getContentPointers(message.content).some(
    (pointer) => getPubkeyFromDecodeResult(pointer) === pubkey,
  );
}

/** Resolves whether a group message should proceed past the mode gate (D-01/D-09 step 2) */
export function passesGroupModeGate(
  mode: GroupNotificationMode,
  message: NostrEvent,
  userPubkey: string,
): boolean {
  switch (mode) {
    case "muted":
      return false;
    case "mentions":
      return messageMentionsPubkey(message, userPubkey);
    case "all":
      return true;
  }
}

/** Looks up a group's configured mode, falling back to the default (D-06) */
export function getGroupMode(
  modes: Record<string, GroupNotificationMode>,
  group: GroupPointer,
): GroupNotificationMode {
  return modes[encodeGroupPointer(group)] ?? DEFAULT_GROUP_NOTIFICATION_MODE;
}
```

### Pattern 2: Wiring the gate into the existing subscribe callback (D-09 layering)

**What:** The mode gate sits between the existing master-switch `enabled$`
gate (already present) and the existing `shouldNotify` sender gate (already
present) — it does not replace either.
**When to use:** `notifications/groups.ts`, inside the `.subscribe(async ({
group, metadata, message }) => { ... })` callback (currently lines 118-137).
**Example:**
```typescript
// notifications/groups.ts — modification, not full file
// Source: existing code at notifications/groups.ts:118-137, extended per D-09
.subscribe(async ({ group, metadata, message }) => {
  const { groups } = getConfig();
  const user = getConfig().pubkey;
  if (!user) return;

  // NEW: step 2 — per-group mode gate (D-01/D-06/D-09)
  const mode = getGroupMode(groups.modes, group);
  if (!passesGroupModeGate(mode, message, user))
    return log("Skipping group notification: muted or non-matching mode", {
      group: encodeGroupPointer(group),
      mode,
    });

  // EXISTING: step 3 — sender gate, unchanged
  if (!(await shouldNotify(message.pubkey)))
    return log(
      "Skipping reply notification for blacklisted/non-whitelisted sender",
      { sender: message.pubkey },
    );

  // ... existing profile lookup + sendNotification unchanged
});
```

### Pattern 3: Datastar per-row form with a non-signal-safe key (Pitfall 2)

**What:** Render group rows using positional index-based signal names, not
`encodeGroupPointer` output, because the latter contains characters
(`'`, `.`) that collide with Datastar's dot-notation nested-signal parsing.
**When to use:** `pages/groups.tsx` GET/PATCH.
**Example:**
```tsx
// pages/groups.tsx — GET handler, illustrative
{joinedGroups.map((group, index) => (
  <div class="group-row">
    <img src={metadataByGroup.get(group)?.picture} />
    <span safe>{metadataByGroup.get(group)?.name ?? group.id}</span>
    <select
      data-bind={`mode_${index}`}
      // one option per GroupNotificationMode, value preselected from
      // getGroupMode(groupsConfig.modes, group)
    >
      <option value="all">All messages</option>
      <option value="mentions">Only @mentions</option>
      <option value="muted">Muted</option>
    </select>
  </div>
))}
```
```typescript
// pages/groups.tsx — PATCH handler, illustrative
const joinedGroups = await firstValueFrom(
  groups$.pipe(
    defined(),
    map((list) =>
      list.tags.filter((t) => t[0] === "group" && t[1]).map(getGroupPointerFromGroupTag),
    ),
  ),
);

const modes: Record<string, GroupNotificationMode> = {};
joinedGroups.forEach((group, index) => {
  const mode = signals[`mode_${index}`] as GroupNotificationMode;
  if (mode) modes[encodeGroupPointer(group)] = mode;
});
```

### Anti-Patterns to Avoid

- **Using `encodeGroupPointer(group)` directly as a Datastar `data-bind` name:**
  produces strings like `relay.example.com'abc123`; Datastar's dot-notation
  nested-signal syntax `[CITED: data-star.dev/guide/reactive_signals]` will
  misinterpret the `.` as a path separator and the `'` is not a valid signal
  path token. Use index-based names and re-key server-side instead (Pattern 3).
- **Writing a fifth copy-pasted `shouldNotify`-style function:** the codebase
  already has four nearly-identical `shouldNotify` implementations flagged as
  tech debt in `.planning/codebase/CONCERNS.md` ("Duplicated `shouldNotify`
  helper"). Do not add a fifth inline mode-check; use the small pure helper
  module in Pattern 1 so the mode+mention logic is unit-testable in isolation.
- **Assuming a shallow `{ ...config$.value, ...parsed }` merge will pick up
  new nested defaults:** it will not (Pitfall 1) — nested objects are
  replaced wholesale, not merged key-by-key.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detecting `nostr:npub1.../nprofile1...` mentions in message content | A regex for bech32 nostr URIs | `getContentPointers(content)` + `getPubkeyFromDecodeResult(pointer)` from `applesauce-core/helpers` | Already the exact regex + NIP-19 decode logic used by the installed applesauce version (`node_modules/applesauce-core/dist/helpers/{regexp,pointers}.js`), including edge cases (optional `nostr:` prefix, boundary matching via `Tokens.nostrLink`, malformed-string safety via `safeDecode`) |
| Encoding a group pointer to a stable config-map key | Custom `${relay}:${id}` string concatenation | `encodeGroupPointer(pointer)` from `applesauce-common/helpers` | Already used for this exact purpose in `helpers/groups.ts`'s cache key and `notifications/groups.ts`'s log lines; matches the NIP-29 spec's own `<host>'<group-id>` group-identification format `[CITED: nips.nostr.com/29]` |
| Parsing the kind 10009 group list into `GroupPointer[]` | Manual tag-array destructuring | `getGroupPointerFromGroupTag(tag)` from `applesauce-common/helpers` | Already used identically in `services/nostr.ts:147-157` (`groups$`) and `notifications/groups.ts:106-112` — reusing it keeps the `/groups` page's list in lockstep with what the notification pipeline actually subscribes to |

**Key insight:** every primitive this phase needs already has a battle-tested
implementation one import away in a package already in `package.json`, used
by code sitting immediately next to where this phase's new code will live.
The only genuinely new logic is the three-way mode switch and its wiring —
everything else is composition.

## Runtime State Inventory

Not applicable — this is a greenfield feature addition (new config field +
new UI controls), not a rename/refactor/migration of existing identifiers.
The one config-schema concern (backfilling `groups.modes` for existing
`config.json` files) is covered under "Config Storage Shape (D-10)" below,
which is a schema migration, not a runtime-state/identifier rename.

## Config Storage Shape (D-10)

**Recommended `AppConfig.groups` extension** (`services/config.ts`):

```typescript
export type GroupNotificationMode = "all" | "mentions" | "muted";

// inside AppConfig:
groups: {
  enabled: boolean;
  whitelists: string[];
  blacklists: string[];
  groupLink: string;
  /** Per-group notification mode, keyed by encodeGroupPointer(group). Groups
   *  with no entry fall back to DEFAULT_GROUP_NOTIFICATION_MODE (D-06). */
  modes: Record<string, GroupNotificationMode>;
};
```

**Recommendation on "plus a default" (D-10):** do NOT add a stored
`groups.defaultMode` config field for Phase 1. D-06 fixes the default to
`"mentions"` as a product decision, not a user-configurable setting, and this
phase ships no UI to change it. Model the default as a plain exported
constant (`DEFAULT_GROUP_NOTIFICATION_MODE` in Pattern 1 above) so it is a
single line to change later if a future phase wants it configurable —
adding an unused config field with no UI control now would be untested surface
area for no behavior.

**Migration is required — this is not optional.** `services/config.ts`'s
boot-time loader (current code, lines 88-105):

```typescript
if (await fs.exists(CONFIG_PATH)) {
  const parsed = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8"));
  // ... existing messages migration ...
  config$.next({ ...config$.value, ...parsed });   // <-- SHALLOW merge
  loaded = true;
}
```

`{ ...config$.value, ...parsed }` is a **top-level shallow spread**. Because
`groups` is itself an object, `parsed.groups` (read from an existing user's
`config.json`, which predates this phase and has no `modes` key) **completely
replaces** `config$.value.groups` — including the in-code default that would
otherwise contain `modes: {}`. Without an explicit fix, every existing
installation ends up with `config.groups.modes === undefined`, and
`modes[key]` lookups would need defensive `?? {}` everywhere or throw.

**Required fix**, following the exact pattern already used for the
`messages` migration at `services/config.ts:92-101`, added just before the
existing `config$.next(...)` call:

```typescript
// Backfill groups.modes for configs written before this phase
if (parsed.groups && parsed.groups.modes === undefined) {
  parsed.groups.modes = {};
}
```

(New installs with no `config.json` yet are unaffected — they get `modes: {}`
straight from the initial `config$` `BehaviorSubject` default object, which
must also be updated to include `modes: {}` alongside the other `groups`
defaults at `services/config.ts:76-81`.)

**Surviving groups joining/leaving the kind 10009 list (D-10 requirement):**
the `modes` map is keyed by `encodeGroupPointer`, independent of list
membership. If a user leaves a group, its entry simply becomes orphaned
(harmless — never looked up again, small constant-size leak). If a user
rejoins the same group at the same relay, `encodeGroupPointer` reproduces the
same key and the old mode is naturally restored. No explicit garbage
collection is required for Phase 1; note it as a possible small cleanup
(prune keys not in the current `groups$` list) if it matters later, but do
not build it now — YAGNI, and D-10 only requires *surviving* membership
changes, not garbage-collecting them.

## Common Pitfalls

### Pitfall 1: Shallow config merge silently drops new nested defaults

**What goes wrong:** After shipping this phase, every existing user's
`config.json` loads with `config.groups.modes === undefined` instead of `{}`,
and any code that does `modes[encodeGroupPointer(group)]` without a guard
throws or silently misbehaves.
**Why it happens:** `services/config.ts`'s `config$.next({ ...config$.value,
...parsed })` merge is shallow — nested objects from `parsed` replace, not
merge with, the in-code defaults (see "Config Storage Shape" above for the
full mechanism and required fix).
**How to avoid:** Add an explicit backfill for `parsed.groups.modes` in the
boot-time loader, exactly mirroring the existing `messages` migration
pattern at `services/config.ts:92-101`.
**Warning signs:** A fresh install works fine (gets defaults from the
`BehaviorSubject` initializer) but any existing `config.json` from before
this phase throws or shows all groups as "undefined mode" in the UI.

### Pitfall 2: `encodeGroupPointer` output is unsafe as a Datastar signal name

**What goes wrong:** Binding `data-bind={encodeGroupPointer(group)}` (or any
literal use of it in a `data-*` expression) breaks because the string
contains a hostname with dots (`relay.example.com`) and a literal apostrophe
separator (`'`) — Datastar signal paths use dot-notation for nested objects
`[CITED: data-star.dev/guide/reactive_signals]`, so `relay.example.com'id`
would be parsed as nested path segments `relay` → `example` → `com'id`,
which is neither the intended flat key nor valid.
**Why it happens:** `encodeGroupPointer`'s output format (`<hostname>'<id>`)
was designed to match the NIP-29 group-identification convention
(`<host>'<group-id>`), not to be a UI framework signal-safe token.
**How to avoid:** Use array-index-based signal names on the client
(`mode_0`, `mode_1`, ...) rendered in the same order the server iterates the
group list; in the PATCH handler, re-fetch (or re-derive) the same
`GroupPointer[]` order server-side and zip it positionally with the
submitted `mode_N` signals to reconstruct the `encodeGroupPointer`-keyed map
(Pattern 3 above).
**Warning signs:** Dropdown changes don't round-trip on save, or the browser
console shows a Datastar signal-path parse warning/error.

### Pitfall 3: `helpers/groups.ts`'s `getGroupMetadata` is currently dead code

**What goes wrong:** D-04 says "reuse `helpers/groups.ts` `getGroupMetadata`"
— but `.planning/codebase/CONCERNS.md` ("`helpers/groups.ts` duplicates
`subscribeToGroup` and is unused") confirms a `grep` finds **zero existing
callers** of this function anywhere in the codebase. It has never actually
been exercised in production. Its in-memory `cache` Map has never been
populated. This phase will be its first real caller, so verify it actually
works end-to-end (network fetch of kind 39000, 2s timeout fallback to
`undefined`, cache hit on second call) rather than assuming it is
battle-tested.
**Why it happens:** It was written for/alongside `notifications/groups.ts`'s
`subscribeToGroup`, which performs its own separate (uncached) kind-39000
fetch via `combineLatest` instead of calling this helper.
**How to avoid:** Add explicit handling for `getGroupMetadata` returning
`undefined` (relay timeout / group has no metadata event yet) when rendering
each `/groups` row — fall back to showing the group's raw `id`/`relay` per
`helpers/link.ts`'s existing "no metadata" tolerance patterns, and consider a
Wave-0 unit test that actually exercises this path (see Validation
Architecture below).
**Warning signs:** Rows silently render with blank picture/name and no
visible fallback if a relay is slow or unresponsive within the 2s timeout.

### Pitfall 4: Name collision between two different `getGroupMetadata` functions

**What goes wrong:** `helpers/groups.ts` exports `getGroupMetadata(group:
GroupPointer): Promise<NostrEvent | undefined>` (fetches the raw kind 39000
event over the network). `applesauce-common/helpers` **also** exports a
function of the identical name, `getGroupMetadata(event: NostrEvent):
GroupMetadata | undefined` (parses an already-fetched kind 39000 event into
`{ id, name, picture, about, isPublic, isPrivate, isOpen, isClosed }`). These
have completely different signatures and are actually a natural pipeline
(fetch via the project helper, then parse via the applesauce helper) —
importing both in `pages/groups.tsx` without aliasing one will not compile
(duplicate identifier) or will silently shadow the wrong one.
**Why it happens:** Independent naming — the project helper predates
awareness of applesauce's own same-named export, or both were named for the
same intuitive purpose without cross-checking.
**How to avoid:** Alias on import, e.g.:
```typescript
import { getGroupMetadata as fetchGroupMetadataEvent } from "../helpers/groups";
import { getGroupMetadata as parseGroupMetadata } from "applesauce-common/helpers";
// usage: const event = await fetchGroupMetadataEvent(group); const meta = event && parseGroupMetadata(event);
```
**Warning signs:** TypeScript "duplicate identifier" compile error, or (if
only one is imported without realizing there's a naming collision with the
other) confusing runtime behavior when the wrong shape is assumed.

### Pitfall 5: D-09 layering order determines what "quiet" actually means

**What goes wrong:** If the mode gate is implemented *after* `shouldNotify`
instead of before it (or the two are merged/reordered incorrectly), a muted
sender could still trigger a notification in "All messages" mode (correct:
`shouldNotify` still blocks them — order 2 then 3 is fine), but a
mentions-only group could suppress a message from an otherwise-whitelisted
sender for the wrong reason if the checks are conflated into one function
instead of two composed gates. Keeping them as two independently testable
functions (per Pattern 1/Pattern 2) avoids this class of bug entirely.
**Why it happens:** The temptation to fold the new mode check into the
existing `shouldNotify` function (since both are "should this notify"
predicates) rather than keeping D-09's explicit three-step composition.
**How to avoid:** Implement the mode gate as a separate function
(`passesGroupModeGate`) called strictly between the `enabled$` check and the
`shouldNotify` call, never merged into `shouldNotify` itself — `shouldNotify`
must remain reusable/unchanged since three other notification types
(`replies`, `zaps`, `messages`) have their own copies of it and any shared
refactor is explicitly out of scope for this phase.
**Warning signs:** A code review shows `shouldNotify` was edited, or the
mode check appears inside `notifications/groups.ts`'s `shouldNotify`
function body rather than in the `.subscribe()` callback around it.

## Code Examples

### Detecting a mention (D-02) — verified against installed `applesauce-core@6.1.0` source

```typescript
// Source: node_modules/applesauce-core/dist/helpers/pointers.js (installed v6.1.0)
// getContentPointers scans content for nostr: URIs (npub/note/nprofile/nevent/naddr)
// and safely NIP-19-decodes each match; getPubkeyFromDecodeResult extracts the
// pubkey regardless of whether the match was an npub (bare pubkey) or an
// nprofile (pubkey + relay hints).
import {
  getContentPointers,
  getPubkeyFromDecodeResult,
} from "applesauce-core/helpers";

const mentioned = getContentPointers(message.content).some(
  (pointer) => getPubkeyFromDecodeResult(pointer) === userPubkey,
);
```

### Encoding/decoding a group pointer as a stable config key

```typescript
// Source: node_modules/applesauce-common/dist/helpers/groups.js (installed v6.1.0)
// encodeGroupPointer({ relay: "wss://groups.nostr.com", id: "abcdef" })
//   -> "groups.nostr.com'abcdef"   (matches NIP-29's own <host>'<group-id> format)
import { encodeGroupPointer } from "applesauce-common/helpers";

const key = encodeGroupPointer(group); // safe as a Record<string, Mode> key,
                                        // NOT safe as a Datastar signal name (Pitfall 2)
```

### The existing config-migration pattern to mirror for `groups.modes`

```typescript
// Source: services/config.ts:92-101 (existing code, verified in this session)
if (parsed.directMessageNotifications !== undefined && !parsed.messages) {
  parsed.messages = {
    enabled: parsed.directMessageNotifications,
    sendContent: parsed.directMessageNotifications,
    whitelists: [],
    blacklists: [],
  };
  delete parsed.directMessageNotifications;
}
// NEW, same shape of fix, for groups.modes:
if (parsed.groups && parsed.groups.modes === undefined) {
  parsed.groups.modes = {};
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| N/A — no prior per-group mode existed | Per-group mode map keyed by `encodeGroupPointer` | This phase | Enables D-06's quieter-by-default behavior without a schema rewrite |
| `applesauce-*` v5 API surface | `applesauce-*` v6 (installed 6.1.0) | Per `CHANGELOG.md` 0.3.0 entry, "recently migrated" per `.planning/codebase/CONCERNS.md` | All group helpers used in this research (`GROUP_MESSAGE_KIND`, `encodeGroupPointer`, `getContentPointers`) are v6 exports — confirm any copy-pasted v5-era snippets found online during implementation are updated to v6 import paths (`applesauce-core/helpers`, `applesauce-common/helpers`, not old flat `applesauce` package) |

**Deprecated/outdated:** None specific to this phase's scope.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Group kind-9 messages in the wild commonly carry both a `p` tag AND a `nostr:` content mention when a client "mentions" someone (rather than only one or neither) | D-02 / Pattern 1 | Low — D-02 already specifies OR semantics precisely so either signal alone is sufficient; this assumption only affects how often both fire simultaneously, not correctness |
| A2 | No NIP-29 relay implementation strips or rewrites `p` tags on kind-9 relay before broadcast | Pattern 1 (`messageMentionsPubkey`) | Medium — if some relay implementation strips `p` tags, mention detection would silently fall back to content-only matching for messages from that relay; not verified against a live relay in this research session, only against the NIP-29 spec text and installed SDK behavior |
| A3 | Pruning orphaned `groups.modes` entries for left groups is unnecessary for Phase 1 correctness (only "survive," not "garbage collect," is required per D-10) | Config Storage Shape (D-10) | Low — worst case is a few stale small string keys accumulating in `config.json` over years; no functional impact |

## Open Questions (RESOLVED)

1. **[RESOLVED — planning, 2026-07-07] Should the UI surface D-07's
   behavior-change note (existing users dropping to mentions-only) as an
   in-app banner, or only in CHANGELOG.md/release notes?**
   **Resolution:** CHANGELOG.md only for Phase 1 — no in-app banner, no new
   `AppConfig` flag (per the recommendation below). Encoded in `01-02-PLAN.md`
   (objective + changelog task). A lightweight one-time `/groups` banner is
   left to a future phase.
   - What we know: D-07 explicitly says "Planning should decide whether
     existing installs get any migration messaging" — this was left open on
     purpose.
   - What's unclear: Whether a one-time dismissible banner is worth the
     added state (a new `AppConfig` flag like `groups.migrationNoticeShown`)
     versus just relying on `CHANGELOG.md`.
   - Recommendation: Default to CHANGELOG.md only for Phase 1 (simplest,
     zero new state); planning may add a lightweight one-time banner on
     `/groups` if it fits the phase's effort budget, gated on a new boolean
     that migration sets to `true` only when backfilling `modes: {}` for an
     existing config (i.e., never shown to fresh installs, since they never
     had "all messages" behavior to lose).

## Environment Availability

Skipped — this phase has no new external tool/service/runtime dependency.
It reuses the already-running `RelayPool`/`EventStore` (`services/nostr.ts`)
and the already-configured `config.json` persistence
(`services/config.ts`), both already exercised by the existing `/groups`
page and `notifications/groups.ts` module in production today.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None configured — Bun's built-in `bun:test` is available (Bun 1.3.14 confirmed installed) but unused by any file in the repo `[VERIFIED: .planning/codebase/TESTING.md, confirmed via filesystem check this session]` |
| Config file | none — see Wave 0 |
| Quick run command | `bun test` (once added — no `test` script exists in `package.json` today) |
| Full suite command | `bun test` (same; no split configured yet) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-01/D-06 | `getGroupMode` returns stored mode when present, `DEFAULT_GROUP_NOTIFICATION_MODE` ("mentions") when absent | unit | `bun test tests/helpers/groups.test.ts` | ❌ Wave 0 |
| D-01 | `passesGroupModeGate("muted", ...)` always returns `false` | unit | `bun test tests/helpers/groups.test.ts` | ❌ Wave 0 |
| D-01 | `passesGroupModeGate("all", ...)` always returns `true` | unit | `bun test tests/helpers/groups.test.ts` | ❌ Wave 0 |
| D-02 | `messageMentionsPubkey` returns `true` for a `p`-tag match with no content mention | unit | `bun test tests/helpers/groups.test.ts` | ❌ Wave 0 |
| D-02 | `messageMentionsPubkey` returns `true` for a `nostr:npub1...` content match with no `p` tag | unit | `bun test tests/helpers/groups.test.ts` | ❌ Wave 0 |
| D-02 | `messageMentionsPubkey` returns `true` for a `nostr:nprofile1...` content match | unit | `bun test tests/helpers/groups.test.ts` | ❌ Wave 0 |
| D-02 | `messageMentionsPubkey` returns `false` when neither signal matches | unit | `bun test tests/helpers/groups.test.ts` | ❌ Wave 0 |
| D-09 | Full gate truth table: `enabled=false` ⇒ no notify regardless of mode; `enabled=true, mode=muted` ⇒ no notify; `enabled=true, mode=mentions, no-match` ⇒ no notify; `enabled=true, mode=mentions, match, sender-blacklisted` ⇒ no notify; `enabled=true, mode=all, sender-not-blacklisted` ⇒ notify | integration | `bun test tests/notifications/groups.test.ts` (feed synthetic events through the exported pure gate functions + a stubbed `shouldNotify`, not the live subscription) | ❌ Wave 0 |
| D-10 | Config round-trip: `updateConfig({ groups: { ...current, modes: { key: "muted" } } })` then `getConfig().groups.modes.key === "muted"` | unit | `bun test tests/services/config.test.ts` | ❌ Wave 0 |
| D-10 | Migration backfill: loading a `config.json` fixture with `groups` present but no `modes` key results in `modes === {}` after load (test by pointing `CONFIG` env at a temp fixture file per the existing `Bun.env.CONFIG` override mechanism, `services/config.ts:84`) | unit | `bun test tests/services/config.test.ts` | ❌ Wave 0 |
| D-03/D-04 | `/groups` GET renders one row per `groups$` entry with the correct preselected mode option | e2e/manual | Playwright smoke test per `.cursor/rules/datastar-testing.mdc`, or manual UAT if Wave 0 budget doesn't cover Playwright setup | ❌ Wave 0 (manual-only acceptable per project's current zero-Playwright-config state) |
| D-05 | `/notifications` Groups card shows correct per-mode counts | unit | Pure function `summarizeGroupModes(modes: Record<string, Mode>): {all: number, mentions: number, muted: number}` — extract as testable helper, `bun test tests/helpers/groups.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `bun test tests/helpers/groups.test.ts` (fastest, covers the pure logic that's the actual risk surface)
- **Per wave merge:** `bun test` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`; UI rows (D-03/D-04) verified manually against a running `bun run dev` instance since no Playwright config exists yet and adding one is a larger investment than this phase's scope

### Wave 0 Gaps

- [ ] `package.json` — add `"test": "bun test"` script (none exists today)
- [ ] `tests/helpers/groups.test.ts` — covers D-01, D-02, D-05 (pure functions: `getGroupMode`, `passesGroupModeGate`, `messageMentionsPubkey`, `summarizeGroupModes`)
- [ ] `tests/notifications/groups.test.ts` — covers D-09 truth table; per `.planning/codebase/TESTING.md`'s guidance, import the specific module (not the `notifications/index.ts` barrel) and be aware this module self-subscribes to `RelayPool`/`EventStore` on import — either test the extracted pure gate functions directly (preferred, avoids mocking `RelayPool`) or stub `services/nostr.ts`'s `pool`/`groups$` per the existing mocking guidance in `TESTING.md`
- [ ] `tests/services/config.test.ts` — covers D-10 round-trip + migration backfill; point `Bun.env.CONFIG` at a temp fixture path before importing `services/config.ts` (module has top-level `await fs.exists(...)` side effects on import, per `.planning/codebase/ARCHITECTURE.md` "Cold-start config load is async top-level await")
- [ ] `tests/fixtures/config-pre-modes.json` — a `config.json` fixture representing a pre-Phase-1 install (`groups` present, no `modes` key) for the migration test

*(No test infrastructure of any kind exists yet — this is a from-scratch Wave 0, matching `.planning/codebase/TESTING.md`'s "None configured" finding.)*

## Security Domain

`security_enforcement` is not configured in this project (`.planning/config.json` does not exist), so treat as enabled per default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | This phase adds no new auth surface; the pre-existing "No authentication on any HTTP route" finding in `.planning/codebase/CONCERNS.md` is a known, already-documented gap that applies to every config page equally and is explicitly out of scope for this phase |
| V3 Session Management | No | No sessions used anywhere in this app |
| V4 Access Control | No | No new privilege boundary; the `/groups` PATCH handler already exists and already mutates `config$` unauthenticated (pre-existing, unrelated to this phase) |
| V5 Input Validation | Yes | The new PATCH handler must validate `signals[mode_N]` is one of the three literal `GroupNotificationMode` values before writing to `config$` — reject/ignore unrecognized values rather than storing arbitrary strings (mirrors the existing pattern of `!!enabled` boolean coercion in the current `pages/groups.tsx` PATCH handler) |
| V6 Cryptography | No | No cryptographic operations introduced by this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Arbitrary string injected into `groups.modes` map via PATCH (e.g. a non-enum value) | Tampering | Validate against the literal union `"all" | "mentions" | "muted"` server-side in the PATCH handler before writing to `config$`; do not trust the client-submitted `mode_N` signal value verbatim |
| Pre-existing CSRF gap on all mutating routes (already documented, not introduced by this phase) | Tampering/Spoofing | No new mitigation required for this phase specifically — `.planning/codebase/CONCERNS.md` "No CSRF protection on mutating routes" already covers this as a project-wide, pre-existing gap; the new `/groups` PATCH surface is no more or less exposed than the existing whitelist/blacklist PATCH on the same page |

## Sources

### Primary (HIGH confidence)

- `node_modules/applesauce-common/dist/helpers/groups.js` (installed v6.1.0) — `GROUP_MESSAGE_KIND`, `encodeGroupPointer`, `decodeGroupPointer`, `getGroupPointerFromGroupTag` implementations, read directly this session
- `node_modules/applesauce-core/dist/helpers/pointers.js` (installed v6.1.0) — `getContentPointers`, `getPubkeyFromDecodeResult` implementations, read directly this session
- `node_modules/applesauce-core/dist/helpers/regexp.js` (installed v6.1.0) — `Tokens.nostrLink` regex backing `getContentPointers`
- `node_modules/applesauce-core/dist/helpers/index.d.ts` — confirms both functions are re-exported from the public `applesauce-core/helpers` barrel
- `node_modules/nostr-tools/lib/esm/kinds.js` (installed v2.23.5) — confirms `kinds.ChatMessage === 9`
- Direct reads of `notifications/groups.ts`, `services/config.ts`, `services/nostr.ts`, `helpers/groups.ts`, `helpers/link.ts`, `pages/groups.tsx`, `pages/notifications.tsx`, `components/WhitelistBlacklist.tsx` — this session, current repo state (all line numbers cited in `01-CONTEXT.md` verified accurate: `services/nostr.ts:147` `groups$` ✓, `services/config.ts:92-101` migration ✓, `services/config.ts:108-110` persist-on-change ✓, `pages/notifications.tsx:274-292` Groups card ✓)
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONCERNS.md`, `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/TESTING.md` — generated 2026-07-07, this session's own repo, cross-checked against live source during this research

### Secondary (MEDIUM confidence)

- [NIP-29 - Relay-based Groups](https://nips.nostr.com/29) — kind 9 chat message structure, `h` tag requirement, `<host>'<group-id>` group identification format
- [NIP-27 - Text Note References](https://nips.nostr.com/27) — `nostr:` URI mention convention for content
- [Reactive Signals Guide — Datastar](https://data-star.dev/guide/reactive_signals) — dot-notation nested signal path behavior, backing Pitfall 2

### Tertiary (LOW confidence)

- npm registry version checks (`npm view applesauce-common version`, etc.) — confirms currently-published versions are ahead of installed; not used to change any recommendation, only flagged as a version-drift note

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every API verified by reading the actual installed package source, not just documentation or training knowledge
- Architecture: HIGH — all integration points read directly from the current repo this session; line-number citations from `01-CONTEXT.md` independently re-verified
- Pitfalls: HIGH for Pitfalls 1/3/4 (derived from reading actual source + `.planning/codebase/CONCERNS.md`); MEDIUM for Pitfall 2 (Datastar signal-path behavior confirmed via official docs search, not by running the actual app against a crafted signal name)

**Research date:** 2026-07-07
**Valid until:** 2026-08-06 (30 days — stable internal codebase + stable NIP specs; re-verify if `applesauce-*` is bumped past 6.1.0 before this phase executes)
