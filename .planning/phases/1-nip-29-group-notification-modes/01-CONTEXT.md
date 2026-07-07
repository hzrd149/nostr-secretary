# Phase 1: NIP-29 group notification modes - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a per-group notification **mode** for each of the user's joined NIP-29 groups
(from their kind 10009 group list). Each group can be set to one of three modes:
**All messages**, **Only @mentions**, or **Muted**. The per-group mode controls
whether/when a group message produces an ntfy notification.

Ships with:
- A per-group list UI on the existing `/groups` config page (one row per joined
  group with its mode control).
- An updated Groups card on the `/notifications` settings view showing a summary
  of per-group modes, linking through to `/groups`.

**Not in this phase:** persisting preferences as an encrypted nostr event (Phase 2),
DM notification work (Phases 3–5), rate limiting (Phases 6–7). No changes to
non-group notification types.

</domain>

<decisions>
## Implementation Decisions

### Notification modes
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

### Settings location & layout
- **D-03:** The per-group mode controls live on the existing **`/groups`** page
  (`pages/groups.tsx`), as a list of the user's joined groups. The page keeps its
  existing global controls (group link template, whitelist/blacklist).
- **D-04:** Each group row shows the group's **picture + name + a mode dropdown**
  (`All / Only @mentions / Muted`). Picture and name come from the group's kind
  39000 metadata (reuse `helpers/groups.ts` `getGroupMetadata`).
- **D-05:** The `/notifications` view keeps a single **Groups card**, updated to
  show a **per-group summary** (e.g. counts of groups on All / Mentions / Muted),
  and links through to `/groups` for editing. (Satisfies the roadmap's "NIP-29
  groups section in the notifications settings view" without duplicating the full
  list on `/notifications`.)

### Default mode & migration
- **D-06:** The default mode for any group with no mode set — including **all
  existing users' groups** and any newly joined group — is **Only @mentions**.
- **D-07:** ⚠ **Behavior change for existing users.** Today, when group
  notifications are enabled, existing users receive *all* messages from every
  joined group. Under D-06 they will drop to *mentions-only* until they opt a
  group up to "All messages". This is a deliberate quieter-by-default choice, NOT
  a silent regression — surface it in the changelog / release notes and consider
  a one-time note in the UI. Planning should decide whether existing installs get
  any migration messaging.

### Global toggle interaction
- **D-08:** The existing global `groups.enabled` toggle stays as a **master
  switch**. When OFF, no group notifies regardless of per-group mode. When ON,
  each group follows its own mode. `groups.enabled` is NOT removed or replaced by
  per-group modes.

### Claude's Discretion
- **D-09 (layering):** Evaluation order for a group message is: (1) master switch
  `groups.enabled` — off ⇒ stop; (2) that group's mode — Muted ⇒ stop,
  Only @mentions ⇒ continue only if the message mentions the user per D-02,
  All ⇒ continue; (3) the **existing** `shouldNotify` sender gate in
  `notifications/groups.ts` (mute list + group whitelist/blacklist + global
  whitelist/blacklist) still applies unchanged on top. This layering was not
  explicitly asked but is the natural composition — planning may refine wording,
  but per-group mode must not bypass the existing mute/whitelist/blacklist checks.
- **D-10 (config storage shape):** How per-group modes are stored in `AppConfig`
  (e.g. a `groups.modes` map keyed by encoded group pointer / naddr via
  `encodeGroupPointer`, plus a default) is left to planning. Must round-trip
  through the existing `config.json` persistence and survive groups joining/leaving
  the kind 10009 list. Follow the existing config-migration pattern in
  `services/config.ts:92-101` if a schema migration is needed.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap / requirements
- `.planning/ROADMAP.md` §"Phase 1" — phase goal and scope.
- No external ADRs/specs. `.planning/PROJECT.md` and `.planning/REQUIREMENTS.md`
  are currently empty — requirements are fully captured in the decisions above.

### NIP references (for @mention detection & group events)
- NIP-29 (relay-based groups) — group message kind, `h`/`d` tags, group metadata
  kind 39000, group list kind 10009. Read via `mcp__nostr__read_nip` / applesauce
  `applesauce-common/helpers` (`GROUP_MESSAGE_KIND`, `getGroupPointerFromGroupTag`,
  `encodeGroupPointer`, `GroupPointer`).
- NIP-10 / NIP-27 — `p`-tag tagging and `nostr:` content mentions for D-02 mention
  detection.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/nostr.ts:147` `groups$` — the user's kind 10009 joined-group list
  (`group` tags → `GroupPointer`). Source of the group list to render on `/groups`.
- `helpers/groups.ts` `getGroupMetadata(group)` — cached fetch of kind 39000 group
  metadata; use for each row's picture (`picture` tag) and name (`name` tag).
- `notifications/groups.ts` — the live subscription + `shouldNotify` sender gate.
  The mode check (D-09 step 2) plugs in here, before/around the existing
  `shouldNotify` call at `notifications/groups.ts:118-123`.
- `services/config.ts` — `AppConfig`, `config$`, `updateConfig`, and the
  boot-time migration pattern (`:92-101`) for adding the per-group mode storage.
- `pages/groups.tsx` — existing config form + PATCH handler (Datastar signals);
  extend with the per-group list and mode persistence.
- `pages/notifications.tsx` — `NotificationsList` Groups card (`:274-292`) and
  `groupsNotification.enabled$`; update to show the per-group summary (D-05).

### Established Patterns
- Config pages: `*View()` + `const route = { GET, PATCH }`; PATCH reads Datastar
  signals via `ServerSentEventGenerator.readSignals` and writes `config$.next(...)`.
- Notification listeners self-subscribe on import and gate via a local
  `shouldNotify` + `sendNotification`. Group pointers are encoded with
  `encodeGroupPointer` (natural stable key for the per-group mode map, D-10).
- Config auto-persists to `config.json` on every `config$` change
  (`services/config.ts:108-110`).

### Integration Points
- Mode enforcement: inside the `enabled$`/subscription pipeline in
  `notifications/groups.ts` (add mode + mention checks around `:118`).
- Group list rendering + mode persistence: `pages/groups.tsx` (GET renders list,
  PATCH saves modes).
- Summary display: `pages/notifications.tsx` Groups card.
- Storage: new field(s) in `AppConfig.groups` in `services/config.ts`.

</code_context>

<specifics>
## Specific Ideas

- Mode labels in UI: "All messages", "Only @mentions", "Muted".
- Master switch semantics mirror the current single `Enable Group Notifications`
  checkbox on `pages/groups.tsx`.
- Existing group-link presets and whitelist/blacklist form on `/groups` stay as-is.

</specifics>

<deferred>
## Deferred Ideas

- Whitelist-only mode (notify only from listed senders) as a fourth per-group mode
  — considered and dropped for Phase 1; overlaps with the existing whitelist/blacklist.
- Unsubscribing from a Muted group's relay subscription to save connections — an
  optimization, not required for correctness (Muted can simply drop before
  notifying). Revisit if relay/connection load becomes a concern.
- Persisting these preferences as an encrypted 1xxxx nostr event — explicitly
  Phase 2.

None otherwise — discussion stayed within phase scope.

</deferred>

---

*Phase: 1-nip-29-group-notification-modes*
*Context gathered: 2026-07-07*
