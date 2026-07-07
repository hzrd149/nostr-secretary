# Phase 1: NIP-29 group notification modes - Pattern Map

**Mapped:** 2026-07-07
**Files analyzed:** 10 (6 modify, 4 new)
**Analogs found:** 6 / 6 modify targets have direct in-file analogs (self-modification); 4 new test files have no analog (Wave 0 from scratch)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `services/config.ts` | config/model | CRUD (in-memory + file persistence) | itself — existing `messages` migration block (`services/config.ts:92-101`) and `groups` defaults (`:76-81`) | exact (self-analog, same file different field) |
| `notifications/groups.ts` | event-driven listener | event-driven (RxJS subscribe callback) | itself — existing `shouldNotify` gate + `.subscribe()` callback (`:118-137`) | exact (self-analog, insert new gate) |
| `helpers/groups.ts` | utility | transform (pure functions) | itself — existing `getGroupMetadata` (`:11-26`), plus `applesauce-core/helpers` (`getContentPointers`, `getPubkeyFromDecodeResult`) for the mention-detection primitive | exact (colocate new exports) |
| `pages/groups.tsx` | route/page (SSR + Datastar) | request-response (GET render / PATCH mutate) | itself — existing `route = { GET, PATCH }` + `ServerSentEventGenerator.readSignals` pattern (`:118-179`); `components/WhitelistBlacklist.tsx` for a second per-item-form example | exact (self-analog, extend PATCH) |
| `pages/notifications.tsx` | route/page (SSR, read-only) | request-response | itself — existing Groups card in `NotificationsList()` (`:274-292`) | exact (self-analog, extend markup) |
| `package.json` | config | — | itself — `scripts` block (`:9-13`) | exact |
| `tests/helpers/groups.test.ts` | test | unit | none in-repo (no test infra exists) | no analog — Wave 0 |
| `tests/notifications/groups.test.ts` | test | unit/integration | none in-repo | no analog — Wave 0 |
| `tests/services/config.test.ts` | test | unit | none in-repo | no analog — Wave 0 |
| `tests/fixtures/config-pre-modes.json` | fixture | — | none in-repo | no analog — Wave 0 |

## Pattern Assignments

### `services/config.ts` (config/model, CRUD)

**Analog:** itself (extend existing type + defaults + migration block)

**Type field to add** (extend `AppConfig.groups`, lines 45-51):
```typescript
/** Groups notifications */
groups: {
  enabled: boolean;
  whitelists: string[];
  blacklists: string[];
  groupLink: string;
  /** Per-group notification mode, keyed by encodeGroupPointer(group).
   *  Groups with no entry fall back to DEFAULT_GROUP_NOTIFICATION_MODE. */
  modes: Record<string, GroupNotificationMode>;
};
```
Add `export type GroupNotificationMode = "all" | "mentions" | "muted";` near the top of the file (or import it from `helpers/groups.ts` if defined there instead — keep it in one place, not duplicated).

**In-code default to add** (extend the `BehaviorSubject` initializer, lines 76-81):
```typescript
groups: {
  enabled: true,
  whitelists: [],
  blacklists: [],
  groupLink: CACHI_GROUP_LINK,
  modes: {},
},
```

**Migration pattern to copy** (existing `messages` migration, lines 92-101, exact structure to mirror):
```typescript
// Migrate old directMessageNotifications field to new messages structure
if (parsed.directMessageNotifications !== undefined && !parsed.messages) {
  parsed.messages = {
    enabled: parsed.directMessageNotifications,
    sendContent: parsed.directMessageNotifications, // Default to same value
    whitelists: [],
    blacklists: [],
  };
  delete parsed.directMessageNotifications;
}
```
**New migration to add**, inserted immediately before the existing `config$.next({ ...config$.value, ...parsed });` call at line 103:
```typescript
// Backfill groups.modes for configs written before per-group modes shipped
if (parsed.groups && parsed.groups.modes === undefined) {
  parsed.groups.modes = {};
}
```

**Shallow-merge landmine (critical context):** line 103's `config$.next({ ...config$.value, ...parsed })` is a top-level shallow spread — `parsed.groups` (if present in `config.json`) *replaces* the in-code default `groups` object wholesale, so the migration backfill above is not optional; without it every pre-phase `config.json` loads with `config.groups.modes === undefined`.

**Round-trip helpers already present, no changes needed:** `updateConfig(update: Partial<AppConfig>)` (lines 124-126) and `getConfig()` (lines 128-130) — both used unchanged by `pages/groups.tsx` PATCH handler and `notifications/groups.ts`.

---

### `notifications/groups.ts` (event-driven listener)

**Analog:** itself — insert the new gate into the existing `.subscribe()` callback

**Imports pattern** (lines 1-37, existing — add `getGroupMode`, `passesGroupModeGate` from `helpers/groups.ts`):
```typescript
import { defined } from "applesauce-core";
import {
  getDisplayName,
  getProfilePicture,
  getTagValue,
} from "applesauce-core/helpers";
import {
  encodeGroupPointer,
  getGroupPointerFromGroupTag,
  GROUP_MESSAGE_KIND,
  type GroupPointer,
} from "applesauce-common/helpers";
import { onlyEvents } from "applesauce-relay";
import {
  catchError, combineLatest, EMPTY, firstValueFrom, map, merge, NEVER, of, switchMap,
} from "rxjs";
import { buildGroupLink } from "../helpers/link";
import { loadLists } from "../helpers/lists";
import { getGroupMode, passesGroupModeGate } from "../helpers/groups"; // NEW
import config$, { getConfig } from "../services/config";
import { log } from "../services/logs";
import { blacklist$, eventStore, groups$, isMuted, pool, whitelist$ } from "../services/nostr";
import { sendNotification } from "../services/ntfy";
```

**Existing sender gate — DO NOT MODIFY** (`shouldNotify`, lines 39-68): reused as-is; per D-09 the new mode gate must sit *before* this, never merged into it (there are 3 other independent copies of this pattern elsewhere flagged in `.planning/codebase/CONCERNS.md` — do not touch or refactor them in this phase).

**Core insertion point — current `.subscribe()` callback** (lines 118-137, exact code today):
```typescript
.subscribe(async ({ group, metadata, message }) => {
  if (!(await shouldNotify(message.pubkey)))
    return log(
      "Skipping reply notification for blacklisted/non-whitelisted sender",
      { sender: message.pubkey },
    );

  // Get the profile of the user who replied
  const profile = await firstValueFrom(
    eventStore.profile(message.pubkey).pipe(defined()),
  );

  // Send a notification
  await sendNotification({
    title: `${getDisplayName(profile)} posted to ${getTagValue(metadata, "name")}`,
    message: message.content,
    icon: getTagValue(metadata, "picture") ?? getProfilePicture(profile),
    click: buildGroupLink(group, message),
  });
});
```

**Required modification — insert mode gate between master switch and `shouldNotify`** (D-09 layering; `enabled$`, defined at lines 97-99, already gates the outer `switchMap` before this callback fires, so step 1 of D-09 is already satisfied structurally — the new step 2 goes at the top of the callback body):
```typescript
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

  // ... existing profile lookup + sendNotification, unchanged
});
```

**Error handling pattern** (existing, unchanged — `catchError` in `subscribeToGroup`, lines 86-94): relay subscription errors are logged and swallowed via `EMPTY`; the new mode-gate code introduces no new async/throwing calls (`getGroupMode`/`passesGroupModeGate` are pure, synchronous) so no new error handling is needed at this call site.

---

### `helpers/groups.ts` (utility, transform/pure functions)

**Analog:** itself — colocate new exports with the existing `getGroupMetadata`

**Existing file in full** (11-26, the file's only current content):
```typescript
import { firstValueFrom, of, timeout } from "rxjs";
import { pool } from "../services/nostr";
import {
  encodeGroupPointer,
  type GroupPointer,
} from "applesauce-common/helpers";
import type { NostrEvent } from "nostr-tools";

const cache = new Map<string, NostrEvent>();

export async function getGroupMetadata(
  group: GroupPointer,
): Promise<NostrEvent | undefined> {
  const cached = cache.get(encodeGroupPointer(group));
  if (cached) return cached;

  const metadata = await firstValueFrom(
    pool
      .relay(group.relay)
      .request({ kinds: [39000], limit: 1, "#d": [group.id] })
      .pipe(timeout({ first: 2000, with: () => of(undefined) })),
  );

  if (metadata) cache.set(encodeGroupPointer(group), metadata);
  return metadata;
}
```
**Caution (Pitfall 4 from RESEARCH.md):** `applesauce-common/helpers` also exports a *different* function named `getGroupMetadata(event: NostrEvent): GroupMetadata | undefined` (parses an event, vs. this file's version which fetches one). Any file importing both (e.g. `pages/groups.tsx`) must alias one on import — do not rename this file's export, alias at the call site instead:
```typescript
import { getGroupMetadata as fetchGroupMetadataEvent } from "../helpers/groups";
import { getGroupMetadata as parseGroupMetadata } from "applesauce-common/helpers";
```

**New exports to add to this file** (verified against installed `applesauce-core@6.1.0` / `applesauce-common@6.1.0` source per RESEARCH.md):
```typescript
import {
  getContentPointers,
  getPubkeyFromDecodeResult,
} from "applesauce-core/helpers";

export type GroupNotificationMode = "all" | "mentions" | "muted";

/** Default mode for any group not present in the per-group mode map (D-06) */
export const DEFAULT_GROUP_NOTIFICATION_MODE: GroupNotificationMode = "mentions";

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

/** Per-mode counts for the /notifications Groups card summary (D-05) */
export function summarizeGroupModes(
  modes: Record<string, GroupNotificationMode>,
): { all: number; mentions: number; muted: number } {
  const counts = { all: 0, mentions: 0, muted: 0 };
  for (const mode of Object.values(modes)) counts[mode]++;
  return counts;
}
```
**Note:** put `GroupNotificationMode` type in this file (not duplicated in `services/config.ts`) and import it into `services/config.ts`'s `AppConfig` type to avoid a second source of truth.

---

### `pages/groups.tsx` (route/page, request-response)

**Analog:** itself — extend existing `route = { GET, PATCH }` pattern; secondary analog `components/WhitelistBlacklist.tsx` for per-item list rendering conventions

**Imports pattern** (lines 1-8, existing):
```typescript
import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import type { BunRequest } from "bun";
import Document from "../components/Document";
import Layout from "../components/Layout";
import WhitelistBlacklist from "../components/WhitelistBlacklist";
import config$ from "../services/config";
import { unique } from "../helpers/array";
import { CACHI_GROUP_LINK } from "../const";
```
**New imports needed:**
```typescript
import { firstValueFrom } from "rxjs";
import { defined } from "applesauce-core";
import { getGroupPointerFromGroupTag, getGroupMetadata as parseGroupMetadata, encodeGroupPointer } from "applesauce-common/helpers";
import { groups$ } from "../services/nostr";
import {
  getGroupMetadata as fetchGroupMetadataEvent,
  getGroupMode,
  type GroupNotificationMode,
} from "../helpers/groups";
```

**GET view — existing structure to extend** (`GroupsConfigView`, lines 10-116): the function is currently synchronous (`config$.getValue()` only). It must become `async` to `firstValueFrom(groups$.pipe(defined()))` and fetch metadata per group (with `Promise.all`/sequential `fetchGroupMetadataEvent` calls) before rendering. Insert the new per-group list section between the existing "Group Link Template" `form-group` (ends line 88) and the `<WhitelistBlacklist>` component (line 90), following the same `class="form-group"` / `class="help-text"` visual conventions used throughout this file. Per Pitfall 2 (RESEARCH.md), use **index-based** `data-bind` names, not `encodeGroupPointer` output:
```tsx
<div class="form-group">
  <label style="font-weight: bold; margin-bottom: 8px; display: block;">
    Joined Groups
  </label>
  {joinedGroups.map((group, index) => {
    const metaEvent = metadataByIndex[index];
    const meta = metaEvent && parseGroupMetadata(metaEvent);
    const mode = getGroupMode(groupsConfig.modes, group);
    return (
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
        {meta?.picture && <img src={meta.picture} style="width:32px;height:32px;border-radius:50%;" />}
        <span safe style="flex:1;">{meta?.name ?? group.id}</span>
        <select data-bind={`mode_${index}`} style="min-width: 160px;">
          <option value="all" selected={mode === "all"}>All messages</option>
          <option value="mentions" selected={mode === "mentions"}>Only @mentions</option>
          <option value="muted" selected={mode === "muted"}>Muted</option>
        </select>
      </div>
    );
  })}
</div>
```

**Existing PATCH handler — structure to mirror** (lines 124-179, full existing code):
```typescript
PATCH: async (req: BunRequest) => {
  const reader = await ServerSentEventGenerator.readSignals(req);
  if (!reader.success) throw new Error(reader.error);

  return ServerSentEventGenerator.stream(async (stream) => {
    const { signals } = reader;
    const enabled = signals.enabled as boolean;
    const groupLink = signals.groupLink as string;
    const whitelistsText = signals.whitelists as string;
    const blacklistsText = signals.blacklists as string;

    try {
      const whitelists = unique(/* ... */);
      const blacklists = unique(/* ... */);

      const currentConfig = config$.getValue();
      const newConfig = {
        ...currentConfig,
        groups: {
          enabled: !!enabled,
          groupLink: groupLink?.trim() || CACHI_GROUP_LINK,
          whitelists,
          blacklists,
        },
      };

      config$.next(newConfig);
      stream.patchSignals(JSON.stringify({ saved: true }));
    } catch (error) {
      stream.patchSignals(JSON.stringify({
        error: error instanceof Error ? error.message : "An unknown error occurred",
      }));
    }
  });
},
```
**Required PATCH extension** — re-derive the same `joinedGroups` order server-side (same `groups$` pipe as GET) and zip positionally with `mode_N` signals, validating each value against the literal union (ASVS V5 requirement from RESEARCH.md — do not trust client-submitted strings verbatim):
```typescript
const joinedGroups = await firstValueFrom(
  groups$.pipe(
    defined(),
    map((list) =>
      list.tags.filter((t) => t[0] === "group" && t[1]).map(getGroupPointerFromGroupTag),
    ),
  ),
);

const VALID_MODES = new Set(["all", "mentions", "muted"]);
const modes: Record<string, GroupNotificationMode> = {};
joinedGroups.forEach((group, index) => {
  const raw = signals[`mode_${index}`];
  if (typeof raw === "string" && VALID_MODES.has(raw)) {
    modes[encodeGroupPointer(group)] = raw as GroupNotificationMode;
  }
});

// merge into newConfig.groups.modes below, alongside existing enabled/groupLink/whitelists/blacklists
```

**Error handling pattern:** identical try/catch + `stream.patchSignals(JSON.stringify({ error: ... }))` shape as existing (lines 167-176) — no new pattern needed, wrap the extended logic in the same block.

---

### `pages/notifications.tsx` (route/page, request-response, read-only)

**Analog:** itself — extend the existing Groups card in `NotificationsList()`

**Existing Groups card, exact code to extend** (lines 274-292):
```tsx
<div class="notification-item">
  <div class="notification-info">
    <div class="notification-name">👥 Groups</div>
    <div class="notification-description">
      Get notified about activity in your NIP-29 groups (channels).
      Configure group-specific whitelists and blacklists.
    </div>
  </div>
  <div class="notification-actions">
    <span
      class={`notification-status ${groupsEnabled ? "enabled" : "disabled"}`}
    >
      {groupsEnabled ? "Enabled" : "Disabled"}
    </span>
    <a href="/groups" class="config-btn">
      Configure
    </a>
  </div>
</div>
```
**Existing enabled-fetch pattern to mirror for the new summary** (lines 208-210, same `firstValueFrom(...).catch(() => false)` idiom used for `messagesEnabled`/`repliesEnabled`/`zapsEnabled`/`groupsEnabled`):
```typescript
const groupsEnabled = await firstValueFrom(groupsNotification.enabled$).catch(
  () => false,
);
```
**Required addition** — read config directly (no new observable needed per RESEARCH.md "no new client interactivity"), call `summarizeGroupModes` from `helpers/groups.ts`:
```typescript
import config$ from "../services/config";
import { summarizeGroupModes } from "../helpers/groups";
// ...
const groupModeSummary = summarizeGroupModes(config$.getValue().groups.modes ?? {});
```
Insert a `notification-description`-style line (or a small inline summary span) inside the existing Groups `notification-info` block, e.g. `All: {groupModeSummary.all} · Mentions: {groupModeSummary.mentions} · Muted: {groupModeSummary.muted}`, styled consistently with the existing `.notification-description` class (lines 47-51 in `notificationStyles`) — no new CSS class required.

---

### `package.json` (config)

**Analog:** itself — existing `scripts` block, lines 9-13:
```json
"scripts": {
  "dev": "bun run --watch index.ts",
  "lint": "tsc --noEmit",
  "format": "prettier --write ."
},
```
**Required addition:**
```json
"scripts": {
  "dev": "bun run --watch index.ts",
  "lint": "tsc --noEmit",
  "format": "prettier --write .",
  "test": "bun test"
},
```

---

## Shared Patterns

### Config persistence / round-trip
**Source:** `services/config.ts:107-114` (auto-save on `config$` change) and `:124-130` (`updateConfig`/`getConfig`)
**Apply to:** `notifications/groups.ts` (reads via `getConfig()`), `pages/groups.tsx` (reads/writes via `config$.getValue()`/`config$.next()`), `pages/notifications.tsx` (reads via `config$.getValue()`)
```typescript
// Save config when it changes
config$.pipe(skip(1)).subscribe((config) => {
  fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
});
```
No file in this phase should call `fs.writeFile` directly — always mutate through `config$.next(...)` / `updateConfig(...)`.

### Config migration (boot-time schema backfill)
**Source:** `services/config.ts:92-101` (existing `messages` migration, exact pattern to mirror for `groups.modes`)
**Apply to:** `services/config.ts` only — the `groups.modes` backfill block, inserted before line 103's `config$.next(...)`.

### Datastar page structure (GET/PATCH + signal streaming)
**Source:** `pages/groups.tsx:118-179` (route object shape), `pages/messages.tsx`/`pages/replies.tsx` likely share the same shape (not read this session but same `ServerSentEventGenerator.readSignals` + `stream.patchSignals` idiom per `.cursor/rules/datastar.mdc`)
**Apply to:** `pages/groups.tsx` PATCH extension only (`pages/notifications.tsx` stays GET-only, no PATCH needed for D-05).
```typescript
const reader = await ServerSentEventGenerator.readSignals(req);
if (!reader.success) throw new Error(reader.error);
return ServerSentEventGenerator.stream(async (stream) => {
  try {
    // ... mutate config$ ...
    stream.patchSignals(JSON.stringify({ saved: true }));
  } catch (error) {
    stream.patchSignals(JSON.stringify({ error: /* ... */ }));
  }
});
```

### Sender gate composition (D-09 layering — do not merge)
**Source:** `notifications/groups.ts:39-68` (`shouldNotify`)
**Apply to:** `notifications/groups.ts` only — the new `passesGroupModeGate` call must be a separate, sequential check before this function, never folded into it. Three other copies of a similar `shouldNotify` exist in `notifications/messages.ts`, `notifications/replies.ts`, `notifications/zaps.ts` (flagged as tech debt in `.planning/codebase/CONCERNS.md`) — do not touch them in this phase.

### Group pointer parsing (kind 10009 → `GroupPointer[]`)
**Source:** `services/nostr.ts:147-157` (`groups$`) and `notifications/groups.ts:106-112` (identical `.filter(t => t[0]==="group" && t[1]).map(getGroupPointerFromGroupTag)` idiom)
**Apply to:** `pages/groups.tsx` GET and PATCH — must reuse this exact filter/map chain (not reinvent) so the `/groups` page's list stays in lockstep with what `notifications/groups.ts` actually subscribes to and so PATCH's positional zip matches GET's render order.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `tests/helpers/groups.test.ts` | test | unit | No test infrastructure exists anywhere in the repo (`.planning/codebase/TESTING.md`: "None configured"). Use `bun:test` (`import { describe, test, expect } from "bun:test"`) directly against the new pure exports of `helpers/groups.ts` — no mocking needed since `getGroupMode`/`passesGroupModeGate`/`messageMentionsPubkey`/`summarizeGroupModes` are pure functions. |
| `tests/notifications/groups.test.ts` | test | unit/integration | No analog. Per RESEARCH.md, prefer testing the extracted pure gate functions directly (`getGroupMode`/`passesGroupModeGate` from `helpers/groups.ts`) rather than importing `notifications/groups.ts` itself, since that module self-subscribes to `RelayPool`/`EventStore` on import (top-level side effect) and would require mocking `services/nostr.ts`. |
| `tests/services/config.test.ts` | test | unit | No analog. `services/config.ts` has a top-level `await fs.exists(CONFIG_PATH)` side effect on import (`CONFIG_PATH = Bun.env.CONFIG ?? "config.json"`, line 84) — point `Bun.env.CONFIG` at a temp path *before* importing the module in the test file. |
| `tests/fixtures/config-pre-modes.json` | fixture | — | No analog; new fixture representing a pre-Phase-1 `config.json` (has `groups` but no `groups.modes` key) for the migration-backfill test. Base its shape on the current `BehaviorSubject` default in `services/config.ts:54-82` minus the `modes` field. |

## Metadata

**Analog search scope:** `services/`, `notifications/`, `helpers/`, `pages/`, `components/`, `package.json`, `tests/` (does not exist yet)
**Files scanned:** `services/config.ts`, `services/nostr.ts`, `notifications/groups.ts`, `helpers/groups.ts`, `pages/groups.tsx`, `pages/notifications.tsx`, `package.json`
**Pattern extraction date:** 2026-07-07
