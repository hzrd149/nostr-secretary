# Phase 5: DM notifications split into contacts and others categories - Pattern Map

**Mapped:** 2026-07-10
**Files analyzed:** 8 (5 modified, 1 new source, 3 test files modified, no new test file needed beyond the pure classifier)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `services/nostr.ts` (add `contacts$`/`isContact`) | service (reactive observable) | event-driven | `mutedPubkeys$`/`isMuted` (:288-333) for the timeout-fallback shape; `groups$`/`mailboxes$` (:82-127) for the no-signer `switchMap` shape | exact (mixed: simpler than `mutedPubkeys$`, matches `groups$`'s no-signer dependency) |
| `notifications/dm-category.ts` (new) | utility (pure classifier) | transform | `notifications/legacy-messages.ts` (:1-40, pure-unit extraction precedent) | role-match (this is a much smaller unit — one pure function, no deps object) |
| `services/config.ts` (schema split + migration) | config / model | CRUD (persisted JSON) | `migrateConfig` (:106-151) + `AppConfig.messages`/seed (:27-33, :64-69) | exact |
| `notifications/messages.ts` (layered gate, both listeners) | controller/listener | event-driven, request-response(-ish notify) | `shouldNotify` (:46-74) + both `.subscribe()` callbacks (:169-192 NIP-04, :226-259 NIP-17) | exact |
| `pages/messages.tsx` (two sections + signals) | route/component (SSR form) | request-response | its own existing single-section form (:30-114 GET, :122-179 PATCH) | exact |
| `helpers/preferences.ts` (SyncedPrefs split + version bump) | service (pure sync transform) | transform / pub-sub | its own `SyncedPrefs.messages`/`serializePrefs`/`sanitizeSyncedPrefs`/`mergePrefs` (:29-43, :53-81, :115-157, :167-192) | exact |
| `tests/services/config.test.ts` (add D5-06 migration cases) | test | CRUD (migration regression) | existing `migrateConfig` describe block (:49-84), specifically the D3-04 legacy-migration tests (:50-62) | exact |
| `tests/helpers/preferences.test.ts` (extend fixture + round-trip) | test | transform | existing `makeConfig`/`serializePrefs`/`sanitizeSyncedPrefs`/`mergePrefs` describe blocks (:24-63, :64-193) | exact |
| `tests/notifications/dm-category.test.ts` (new, pure classifier + gate truth-table) | test | transform | `notifications/legacy-messages.ts`'s network-safe pure-module test precedent (deps-mockable, no `services/nostr.ts` import) | role-match |

## Pattern Assignments

### `services/nostr.ts` — add `contacts$` + `isContact(pubkey)`

**Analog A (timeout-fallback shape):** `mutedPubkeys$` / `isMuted` (services/nostr.ts:289-333)

```ts
// services/nostr.ts:289-333 (mutedPubkeys$ / isMuted — the isContact template)
export const mutedPubkeys$ = combineLatest([
  user$.pipe(
    switchMap((user) =>
      eventStore.replaceable({ kind: kinds.Mutelist, pubkey: user }),
    ),
  ),
  signer$,
]).pipe(
  switchMap(async ([event, signer]) => {
    if (!event) return new Set<string>();
    // ... decrypt hidden mutes if signer present ...
  }),
  shareAndHold(),
);

/** Returns true if the user has muted the given pubkey */
export async function isMuted(pubkey: string): Promise<boolean> {
  const muted = await firstValueFrom(
    mutedPubkeys$.pipe(
      timeout({ first: 2000, with: () => of(new Set<string>()) }),
    ),
  );
  return muted.has(pubkey);
}
```

**Analog B (no-signer, simpler `switchMap` shape — the correct base for `contacts$` per Pitfall 1):** `groups$` (services/nostr.ts:117-127) and `mailboxes$` (services/nostr.ts:82-93)

```ts
// services/nostr.ts:117-127 — groups$: no signer dependency, single switchMap over user$
export const groups$ = combineLatest([user$, mailboxes$]).pipe(
  switchMap(([user, mailboxes]) => {
    if (!user || !mailboxes) return EMPTY;
    return eventStore.replaceable({ kind: 10009, pubkey: user });
  }),
  shareAndHold(),
);
```

**Do NOT copy** `mutedPubkeys$`'s `combineLatest([..., signer$])` + `unlockHiddenMutes` branch — RESEARCH Pitfall 1 confirms kind-3 is never hidden-tag-decrypted by the installed applesauce version, so `contacts$` needs only `user$` (mirror `groups$`'s simplicity), while reusing `isMuted`'s exact `firstValueFrom(...timeout({first:2000, with:()=>of(...)}))` fallback idiom for `isContact`.

**Concrete new code (from RESEARCH, verified against real `eventStore.contacts()` accessor and existing import conventions):**
```ts
// New export, placed near mutedPubkeys$/isMuted (services/nostr.ts, after line 333)
export const contacts$ = user$.pipe(
  switchMap((user) => eventStore.contacts(user)),
  shareAndHold(),
);

export async function isContact(pubkey: string): Promise<boolean> {
  const contacts = await firstValueFrom(
    contacts$.pipe(
      timeout({ first: 2000, with: () => of([] as ProfilePointer[]) }),
    ),
  );
  return contacts.some((c) => c.pubkey === pubkey);
}
```
Existing imports already present in `services/nostr.ts` cover everything needed (`switchMap`, `shareAndHold` (local helper, :56-61), `firstValueFrom`, `timeout`, `of` — all already imported at :28-45); only new addition is `import type { ProfilePointer } from "nostr-tools";`.

---

### `notifications/dm-category.ts` (new)

**Analog:** `notifications/legacy-messages.ts` (:1-40) — established shape for a pure, network-free extracted unit with no top-level singleton imports (safe to import directly in tests, unlike `services/nostr.ts` or `notifications/messages.ts` which self-subscribe at import time).

```ts
// notifications/legacy-messages.ts:1-30 — the "no singleton imports, safe for tests" shape to mirror
import { getDisplayName, npubEncode, type ProfileContent } from "applesauce-core/helpers";
import { unlockLegacyMessage } from "applesauce-common/helpers";
import type { NostrEvent } from "nostr-tools";
import { log } from "../services/logs";

export type DecryptLegacyMessageDeps = {
  getProfile: (sender: string) => Promise<ProfileContent | undefined>;
  unlock: typeof unlockLegacyMessage;
  log: typeof log;
};
```

`dm-category.ts` is proportionately much smaller (RESEARCH Example 2) — no deps object needed since it's a single pure boolean→enum mapping:
```ts
export type DmCategory = "contacts" | "others";

export function classifyDmSender(isFollowed: boolean): DmCategory {
  return isFollowed ? "contacts" : "others";
}
```

---

### `services/config.ts` — schema split + migration

**Analog:** existing `AppConfig.messages` (services/config.ts:27-33), `config$` seed (:64-69), `migrateConfig` (:106-151)

**Current shape to replace:**
```ts
// services/config.ts:27-33 (AppConfig type)
messages: {
  enabled: boolean;
  sendContent: boolean;
  whitelists: string[];
  blacklists: string[];
};
```
```ts
// services/config.ts:64-69 (config$ seed)
messages: {
  enabled: false,
  sendContent: false,
  whitelists: [],
  blacklists: [],
},
```

**Migration pattern to extend (services/config.ts:106-151, `migrateConfig`):**
```ts
// services/config.ts:124-151 — existing migrateConfig; the D3-04 directMessageNotifications
// reshape (lines 126-134) is the model for the new D5-06 step: guard on presence, mutate
// `parsed` in place, return it. Pure function, no I/O, unit-testable in isolation.
export function migrateConfig(parsed: any): any {
  if (parsed.directMessageNotifications !== undefined && !parsed.messages) {
    parsed.messages = {
      enabled: parsed.directMessageNotifications,
      sendContent: false,
      whitelists: [],
      blacklists: [],
    };
    delete parsed.directMessageNotifications;
  }
  // ... groups.modes backfill follows the same guard-then-mutate shape ...
  return parsed;
}
```
New D5-06 step goes here (RESEARCH Example 4): guard `parsed.messages.contacts === undefined && parsed.messages.others === undefined`, seed both from `parsed.messages.enabled === true`, `delete parsed.messages.enabled`.

**6 call sites that must move together (RESEARCH Pitfall 2 — verify each during implementation):**
1. `notifications/messages.ts:78` — `enabled$`'s `map((c) => c.messages.enabled)`
2. `pages/messages.tsx:36` — `checked={messagesConfig.enabled}`
3. `pages/messages.tsx:154` — PATCH handler `messages: { enabled: !!enabled, ... }`
4. `helpers/preferences.ts:57` — `serializePrefs`
5. `helpers/preferences.ts:133` — `sanitizeSyncedPrefs` (via `asBoolean(messages.enabled)`)
6. `helpers/preferences.ts:175` — `mergePrefs`

Plus test fixtures: `tests/helpers/preferences.test.ts:38,180,273`; `tests/services/config.test.ts:50-62`.

---

### `notifications/messages.ts` — layered category gate in BOTH listeners

**Analog:** `shouldNotify` (notifications/messages.ts:46-74) — the existing gate this phase layers on top of, unmodified; both `.subscribe()` bodies (:169-192 NIP-04, :226-259 NIP-17).

```ts
// notifications/messages.ts:169-192 — NIP-04 .subscribe(), the exact insertion point
.subscribe(async ({ sender, profile, content, event }) => {
  if (!content) return;

  // Check if we should notify for this sender
  if (!(await shouldNotify(sender)))
    return log(
      "Skipping notification for blacklisted/non-whitelisted sender",
      { sender },
    );

  const { messages } = getConfig();
  const displayName = getMessageDisplayName(profile, sender);

  await sendNotification({
    title: `${displayName} sent you a message`,
    message: messages.sendContent ? content : "[content omitted]",
    icon: getProfilePicture(profile),
    click: buildOpenLink(event),
  });
});
```
```ts
// notifications/messages.ts:226-259 — NIP-17 .subscribe(), the second (identical) insertion point
.subscribe(async (rumor) => {
  const { pubkey, messages } = getConfig();
  if (!pubkey) return;

  const sender = rumor.pubkey;

  if (!(await shouldNotify(sender)))
    return log("Skipping notification for blacklisted/non-whitelisted sender", { sender });

  const profile = await getValue(eventStore.profile(sender)).catch(() => undefined);
  const content = rumor.content;
  const displayName = getMessageDisplayName(profile, sender);

  await sendNotification({ ... });
});
```

**D5-07 layering:** insert the category gate as a NEW, separate statement immediately BEFORE each existing `if (!(await shouldNotify(sender))) return ...` — do not merge into `shouldNotify`'s body (it stays byte-identical, its existing test must not need updating):
```ts
import { classifyDmSender } from "./dm-category";
import { isContact } from "../services/nostr"; // add to existing import list at :34-42

// inserted before the existing shouldNotify check, in BOTH callbacks:
const category = classifyDmSender(await isContact(sender));
const { messages } = getConfig();
if (!messages[category].enabled)
  return log("Skipping notification: category disabled", { sender, category });
```

**`enabled$` update (notifications/messages.ts:76-90):**
```ts
// notifications/messages.ts:77-78 — current
export const enabled$ = config$.pipe(
  map((c) => c.messages.enabled),
  ...
```
Change to `map((c) => c.messages.contacts.enabled || c.messages.others.enabled)` per RESEARCH's recommended discretion choice (no derived config field kept — computed directly in the observable).

---

### `pages/messages.tsx` — two sections + two new signals

**Analog:** its own existing single-section form.

```tsx
// pages/messages.tsx:30-52 — existing single checkbox to be replaced with two of this shape
<div class="form-group">
  <div style="display: flex; align-items: flex-start; gap: 10px;">
    <input
      type="checkbox"
      id="enabled"
      data-bind="enabled"
      checked={messagesConfig.enabled}
      style="margin-top: 4px; width: 20px; height: 20px;"
    />
    <div style="flex: 1;">
      <label for="enabled" style="font-weight: bold; margin-bottom: 8px; display: block;">
        Enable Direct Message Notifications
      </label>
      <div class="help-text">...</div>
    </div>
  </div>
</div>
```
```ts
// pages/messages.tsx:122-166 — PATCH handler, current shape
const enabled = signals.enabled as boolean;
const sendContent = signals.sendContent as boolean;
// ...
const newConfig = {
  ...currentConfig,
  messages: { enabled: !!enabled, sendContent: !!sendContent, whitelists, blacklists },
};
config$.next(newConfig);
stream.patchSignals(JSON.stringify({ saved: true, ...newConfig.messages }));
```

**New shape (RESEARCH Example 5, flat signal names per Pitfall 4 — never dotted paths, matching this codebase's existing `enabled`/`sendContent` flat-signal convention):**
```tsx
<input type="checkbox" id="contactsEnabled" data-bind="contactsEnabled" checked={messagesConfig.contacts.enabled} />
<input type="checkbox" id="othersEnabled" data-bind="othersEnabled" checked={messagesConfig.others.enabled} />
```
```ts
const contactsEnabled = signals.contactsEnabled as boolean;
const othersEnabled = signals.othersEnabled as boolean;
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
`sendContent` (:54-86) and `<WhitelistBlacklist>` (:88-92) stay exactly as-is (D5-04/D5-08 — shared, unchanged).

---

### `helpers/preferences.ts` — sync split + `PREFS_VERSION` bump

**Analog:** its own `SyncedPrefs.messages` (:29-43), `serializePrefs` (:53-81), `sanitizeSyncedPrefs` (:115-157), `mergePrefs` (:167-192).

```ts
// helpers/preferences.ts:29-43 — current SyncedPrefs (messages field is the one to split)
export type SyncedPrefs = {
  version: number;
  messages: { enabled: boolean; whitelists: string[]; blacklists: string[] };
  replies: { enabled: boolean; whitelists: string[]; blacklists: string[] };
  zaps: { enabled: boolean; whitelists: string[]; blacklists: string[] };
  groups: { enabled: boolean; whitelists: string[]; blacklists: string[]; modes: Record<string, GroupNotificationMode> };
  whitelists: string[];
  blacklists: string[];
  appLink?: string;
};
```
```ts
// helpers/preferences.ts:53-60 — serializePrefs's messages block (analog for the split)
messages: {
  enabled: config.messages.enabled,
  whitelists: config.messages.whitelists,
  blacklists: config.messages.blacklists,
},
```
```ts
// helpers/preferences.ts:90-92 — asBoolean coercer, reused for the two new fields
function asBoolean(value: unknown): boolean {
  return value === true;
}
```
```ts
// helpers/preferences.ts:130-136 — sanitizeSyncedPrefs's messages block (analog; needs the
// Pitfall-5 old-schema fallback added — see RESEARCH Example 6's asMessagesCategories helper)
messages: {
  enabled: asBoolean(messages.enabled),
  whitelists: asStringArray(messages.whitelists),
  blacklists: asStringArray(messages.blacklists),
},
```
```ts
// helpers/preferences.ts:173-178 — mergePrefs's messages block (analog)
messages: {
  ...current.messages,
  enabled: incoming.messages.enabled,
  whitelists: incoming.messages.whitelists,
  blacklists: incoming.messages.blacklists,
},
```

New shape per RESEARCH Example 6 (`PREFS_VERSION = 2`, `messages: { contacts: {enabled}, others: {enabled}, whitelists, blacklists }`, plus a `asMessagesCategories(raw)` helper in `sanitizeSyncedPrefs` that falls back to the old flat `enabled` boolean when `raw.contacts`/`raw.others` are both absent — this is the Pitfall 5 stale-peer-payload fix, required for D5-10's "do not break the existing sync round-trip").

---

## Shared Patterns

### Timeout-fallback reactive read (services/nostr.ts)
**Source:** `isMuted` (services/nostr.ts:325-333)
**Apply to:** `isContact`
```ts
firstValueFrom(obs$.pipe(timeout({ first: 2000, with: () => of(fallbackValue) })))
```
This exact idiom is what makes D5-02's "unavailable → others" fallback free — no special-case code, the timeout's fallback value alone determines the "not a contact" default.

### Pure extracted unit, no singleton imports (network-safe testing)
**Source:** `notifications/legacy-messages.ts` (:1-40)
**Apply to:** `notifications/dm-category.ts`
Never import `services/nostr.ts` or `notifications/messages.ts` (both self-subscribe to the live RelayPool/EventStore at import time) from a pure unit meant to be tested directly.

### Config migration — guard, mutate in place, return
**Source:** `migrateConfig` (services/config.ts:124-151)
**Apply to:** the new D5-06 messages.contacts/others migration step
Guard on the new fields' absence, mutate `parsed` in place, `delete` the superseded field, return `parsed`. Add a corresponding `tests/services/config.test.ts` regression test mirroring the existing D3-04 tests (:50-62).

### Layered gate — new gate is a separate statement, never merged into the old one
**Source:** `shouldNotify` (notifications/messages.ts:46-74) kept byte-identical; Phase-1 D-09 precedent
**Apply to:** both `.subscribe()` callbacks in `notifications/messages.ts`
Insert `if (!messages[category].enabled) return log(...)` immediately before, never inside, the existing `if (!(await shouldNotify(sender))) return ...`.

### Flat Datastar signal names, never dotted paths
**Source:** `pages/messages.tsx` (`enabled`, `sendContent`), `pages/groups.tsx` (`mode_${index}`)
**Apply to:** `pages/messages.tsx`'s two new signals — `contactsEnabled` / `othersEnabled`, mapped to the nested config shape only inside the PATCH handler.

### Sync sanitizer — defensive coercion with schema-version fallback
**Source:** `sanitizeSyncedPrefs` (helpers/preferences.ts:115-157), `asBoolean`/`asStringArray`/`asModes` coercers
**Apply to:** the new `asMessagesCategories` helper (Pitfall 5) — must special-case "no contacts/others keys present" (pre-Phase-5 peer payload) by falling back to the old `messages.enabled` boolean, not silently coercing to `false`.

## No Analog Found

None — every file in scope has at least a role-match analog in the existing codebase; this phase is a pure composition of already-established patterns (RESEARCH's "Don't Hand-Roll" table confirms no new primitives are needed).

## Metadata

**Analog search scope:** `services/nostr.ts`, `services/config.ts`, `notifications/messages.ts`, `notifications/legacy-messages.ts`, `notifications/gift-wrap-messages.ts`, `pages/messages.tsx`, `helpers/preferences.ts`, `tests/services/config.test.ts`, `tests/helpers/preferences.test.ts`
**Files scanned:** 9 (all read in full — all ≤ 342 lines)
**Pattern extraction date:** 2026-07-10
