# Phase 1: NIP-29 group notification modes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-07
**Phase:** 1-nip-29-group-notification-modes
**Areas discussed:** The modes themselves, Where settings live + layout, Default mode + migration, Global toggle vs per-group

---

## The modes themselves

### Which mode set

| Option | Description | Selected |
|--------|-------------|----------|
| All / Mentions / Muted | Three modes: All messages, Only @mentions, Muted | ✓ |
| All / Mentions only | Two modes, no per-group off switch | |
| Add whitelist-only | Four modes incl. whitelist-only | |

**User's choice:** All / Mentions / Muted
**Notes:** Muted gives a per-group off switch; whitelist-only dropped as it overlaps existing whitelist/blacklist.

### What counts as an @mention

| Option | Description | Selected |
|--------|-------------|----------|
| p-tag pointing at you | Notify when message `p`-tags user pubkey | |
| p-tag OR content mention | Also scan content for `nostr:` mention of user | ✓ |
| You decide | Let planning pick | |

**User's choice:** p-tag OR content mention
**Notes:** Either a `p` tag or a `nostr:` npub/nprofile in content counts as a mention.

---

## Where settings live + layout

### Location of per-group controls

| Option | Description | Selected |
|--------|-------------|----------|
| New section on /notifications | Per-group list inline on notifications view | |
| On the /groups page | Per-group list on existing /groups config page | ✓ |
| Both | Duplicate on both pages | |

**User's choice:** On the /groups page

### What /notifications shows for groups

| Option | Description | Selected |
|--------|-------------|----------|
| Keep existing card, link to /groups | Single card, entry point only | |
| Card with per-group summary | Card shows counts by mode + link | ✓ |
| Full group list on /notifications too | Duplicate full list | |

**User's choice:** Card with per-group summary
**Notes:** Reconciles the roadmap's "groups section in notifications view" with keeping edit controls on /groups.

### Group row presentation

| Option | Description | Selected |
|--------|-------------|----------|
| Picture + name + mode dropdown | Uses kind 39000 metadata via getGroupMetadata | ✓ |
| Name + mode dropdown only | Lightweight, no picture | |
| You decide | Let planning choose | |

**User's choice:** Picture + name + mode dropdown

---

## Default mode + migration

| Option | Description | Selected |
|--------|-------------|----------|
| All messages | Preserves today's behavior for existing users | |
| Only @mentions | Quieter default; changes existing behavior | ✓ |
| You decide | Lean toward All messages | |

**User's choice:** Only @mentions
**Notes:** Deliberately quieter default. Changes behavior for existing users (who currently get all group messages) — flagged in CONTEXT as a non-silent behavior change to surface in release notes.

---

## Global toggle vs per-group

| Option | Description | Selected |
|--------|-------------|----------|
| Master switch | groups.enabled stays as top-level on/off above per-group modes | ✓ |
| Remove global toggle | Per-group modes fully replace it | |
| You decide | Lean toward master switch | |

**User's choice:** Master switch
**Notes:** groups.enabled off = nothing notifies; on = each group follows its mode.

---

## Claude's Discretion

- **Layering of mode vs existing sender gate** (D-09): natural composition — master switch → per-group mode (Muted/mention/all) → existing `shouldNotify` (mute + whitelist/blacklist). Per-group mode must not bypass existing checks.
- **Config storage shape** (D-10): map of per-group modes keyed by encoded group pointer, with migration per existing config.ts pattern — left to planning.

## Deferred Ideas

- Whitelist-only per-group mode (overlaps existing whitelist/blacklist).
- Unsubscribing from Muted groups' relay subscriptions (optimization).
- Persisting preferences as an encrypted 1xxxx nostr event — Phase 2.
