# Phase 2: Save notification preferences as encrypted 1xxxx nostr event - Pattern Map

**Mapped:** 2026-07-07
**Files analyzed:** 8
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `helpers/preferences.ts` (NEW) | utility (pure transform) | transform | `helpers/groups.ts` | exact (pure helper, no `services/nostr` import) |
| `services/preferences.ts` (NEW) | service | event-driven / pub-sub | `services/nostr.ts` (`groups$`, `mutedPubkeys$`, `giftWraps$`) | exact |
| `services/config.ts` (NOT MODIFIED — loop prevention lives in new `services/preferences.ts` per 02-03; see resolution note below) | service/config store | event-driven | `services/config.ts` itself (`:126-128`) | exact (self-modify) |
| `const.ts` (MODIFY: `SIGNER_PERMISSIONS`) | config | — | `const.ts` itself (`:11-13`) | exact (self-modify) |
| `pages/signer.tsx` (MODIFY x2 call sites) | route/page | request-response | same file's existing `getNostrConnectURI`/`fromBunkerURI` calls | exact |
| `pages/home.tsx` (MODIFY x1 call site) | route/page | request-response | same file's existing `getNostrConnectURI` call | exact |
| `tests/helpers/preferences.test.ts` (NEW) | test | — | `tests/helpers/groups.test.ts` | exact |
| `tests/services/preferences.test.ts` (NEW, if added) / `tests/fixtures/*` | test / fixture | — | `tests/services/config.test.ts` + `tests/fixtures/config-pre-modes.json` | exact |

## Pattern Assignments

### `helpers/preferences.ts` (utility, transform) — NEW

**Analog:** `helpers/groups.ts` (full file read, 99 lines)

**Why this analog:** `helpers/groups.ts` is the established split-out for **pure, side-effect-free logic** that must be independently unit-testable without importing `services/nostr.ts` (Pitfall 6 in RESEARCH.md explicitly calls this out — `services/nostr.ts` opens live relay connections at import time). `getGroupMode`, `passesGroupModeGate`, `summarizeGroupModes`, `isGroupNotificationMode` are all pure functions operating on plain data — the exact shape `serializePrefs`/`mergePrefs` need.

**Imports pattern** (`helpers/groups.ts:1-11`) — note the one function needing I/O (`getGroupMetadata`) imports `pool` from `services/nostr`, but the **pure** functions below it do not import anything from services:
```typescript
import type { NostrEvent } from "nostr-tools";
import {
  encodeGroupPointer,
  type GroupPointer,
} from "applesauce-common/helpers";
```
For `helpers/preferences.ts`, mirror only the pure-function half — do **not** import `services/nostr.ts`. Import `AppConfig` as a type-only import from `services/config` (type-only imports don't pull the module's runtime side effects across Bun's module graph the way a value import would, but note `services/config.ts` itself has top-level `await fs.exists`; RESEARCH.md's Pitfall 6 warning is specifically about `services/nostr.ts`, not `services/config.ts` — `tests/services/config.test.ts` already imports `services/config` directly and works fine under `tests/setup.ts`'s `Bun.env.CONFIG` isolation).

**Core pattern — defensive lookup with fallback** (`helpers/groups.ts:74-82`, `getGroupMode`):
```typescript
export function getGroupMode(
  modes: Record<string, GroupNotificationMode> | undefined | null,
  group: GroupPointer,
): GroupNotificationMode {
  const stored = modes?.[encodeGroupPointer(group)];
  return isGroupNotificationMode(stored)
    ? stored
    : DEFAULT_GROUP_NOTIFICATION_MODE;
}
```
Mirror this defensive-narrowing style for `serializePrefs`/`mergePrefs`: never trust a field's shape from an untrusted source (inbound decrypted JSON off the wire) without validating it, same as `isGroupNotificationMode`'s job of validating persisted/`config.json` data.

**Validation pattern** (`helpers/groups.ts:93-98`, `isGroupNotificationMode`):
```typescript
export function isGroupNotificationMode(
  value: unknown,
): value is GroupNotificationMode {
  return value === "all" || value === "mentions" || value === "muted";
}
```
Use this same type-guard style if `mergePrefs` needs to validate `incoming.groups.modes` entries (values decrypted from a remote/untrusted event) before merging into local `AppConfig`.

**Concrete target implementation** is already fully drafted in RESEARCH.md `## Pattern 5` (`serializePrefs`, `mergePrefs`, `PREFS_NAMESPACE`, `PREFS_VERSION`, `SyncedPrefs` type) — copy that verbatim as the starting point, cross-referencing `AppConfig`'s actual field shape below.

**`AppConfig` shape to subset from** (`services/config.ts:8-56`):
```typescript
export type AppConfig = {
  pubkey?: string;
  lookupRelays: string[];
  server?: string;
  topic?: string;
  email?: string;
  appLink?: string;
  signer?: SerializedAccount<any, any>;
  whitelists: string[];
  blacklists: string[];
  messages: { enabled: boolean; sendContent: boolean; whitelists: string[]; blacklists: string[] };
  replies: { enabled: boolean; whitelists: string[]; blacklists: string[] };
  zaps: { enabled: boolean; whitelists: string[]; blacklists: string[] };
  groups: {
    enabled: boolean; whitelists: string[]; blacklists: string[];
    groupLink: string;
    modes: Record<string, GroupNotificationMode>;
  };
};
```
D2-04/D2-05/Pitfall 8: sync `messages.{enabled,whitelists,blacklists}` (NOT `sendContent`), all of `replies`, all of `zaps`, `groups.{enabled,whitelists,blacklists,modes}` (NOT `groupLink`), top-level `whitelists`/`blacklists`/`appLink`. Never `pubkey`, `signer`, `server`, `topic`, `email`, `lookupRelays`.

---

### `services/preferences.ts` (service, event-driven/pub-sub) — NEW

**Analog:** `services/nostr.ts` — specifically `groups$` (`:147-157`), `mutedPubkeys$` (`:288-317`), `giftWraps$` (`:246-270`, as an **anti-pattern** to avoid copying its `skip(1)` idiom), and the module-scope-singleton-with-side-effects-at-import convention of the whole file.

**Imports pattern** (`services/nostr.ts:1-52`) — project convention: deep imports from `applesauce-*` packages, RxJS named imports listed alphabetically-ish, local imports last:
```typescript
import { EventStore, mapEventsToStore, simpleTimeout } from "applesauce-core";
import { unixNow } from "applesauce-core/helpers";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { NostrConnectSigner } from "applesauce-signers";
import { kinds } from "nostr-tools";
import {
  BehaviorSubject, combineLatest, EMPTY, filter, firstValueFrom, map,
  merge, NEVER, of, ReplaySubject, share, shareReplay, skip, startWith,
  switchMap, timeout, timer, toArray,
} from "rxjs";
import config$, { configValue } from "./config";
import { log } from "./logs";
```
For `services/preferences.ts`, mirror this ordering: `applesauce-*` deep imports → `nostr-tools` → `rxjs` named imports → local `./nostr`, `./config`, `./logs`, `../helpers/preferences`.

**"Cache/share" helper to reuse** (`services/nostr.ts:54-59`):
```typescript
function shareAndHold<T>(timeout = 60_000): MonoTypeOperatorFunction<T> {
  return share({
    resetOnRefCountZero: () => timer(timeout),
    connector: () => new ReplaySubject(1),
  });
}
```
This is a private, non-exported helper local to `services/nostr.ts` — either import it if exported, or duplicate the ~5-line pattern locally in `services/preferences.ts` if it stays unexported (check current export status before deciding).

**Reactive parameterized-replaceable read pattern** (`services/nostr.ts:147-157`, `groups$` — closest structural analog for `preferencesEvent$`):
```typescript
export const groups$ = combineLatest([user$, mailboxes$]).pipe(
  switchMap(([user, mailboxes]) => {
    if (!user || !mailboxes) return EMPTY;
    return eventStore.replaceable({
      kind: 10009,
      pubkey: user,
    });
  }),
  // Cache value fro 60s
  shareAndHold(),
);
```
For kind 30078 (addressable, not just replaceable), add `identifier: PREFS_NAMESPACE` per RESEARCH.md Pattern 3 / Pitfall 2 — do not omit it (`groups$`'s kind 10009 is a *plain* replaceable kind with no `d`-tag, so it's a partial match; RESEARCH.md's Pattern 3 code block already has the full corrected version for an addressable kind).

**Decrypt-in-`switchMap(async...)` pattern** (`services/nostr.ts:288-317`, `mutedPubkeys$` — closest analog for the decrypt-and-apply half):
```typescript
export const mutedPubkeys$ = combineLatest([
  user$.pipe(switchMap((user) => eventStore.replaceable({ kind: kinds.Mutelist, pubkey: user }))),
  signer$,
]).pipe(
  switchMap(async ([event, signer]) => {
    if (!event) return new Set<string>();
    if (signer && hasHiddenTags(event) && !isHiddenMutesUnlocked(event)) {
      try {
        await unlockHiddenMutes(event, signer);
      } catch (error) {
        log("Failed to unlock private mutes", {
          error: Reflect.get(error as object, "message") || "Unknown error",
        });
      }
    }
    const hidden = getHiddenMutedThings(event);
    const mutes = getMutedThings(event);
    return hidden ? mergeMutes(mutes, hidden).pubkeys : mutes.pubkeys;
  }),
  shareAndHold(),
);
```
Copy this exact shape for the prefs subscribe-and-apply pipeline: `combineLatest([preferencesEvent$, signer$])` → `switchMap(async ([event, signer]) => {...})` → try/catch around the decrypt call → `log(...)` on failure (never throw out of the pipeline, keep it alive). RESEARCH.md Pattern 4 has the concrete drop-in version using `unlockAppData`/`getAppDataContent` instead of `unlockHiddenMutes`/`getHiddenMutedThings`.

**Live relay subscription pattern** (`services/nostr.ts:222-244`, `tagged$` — closest analog for the raw `pool.subscription(...)` REQ):
```typescript
export const tagged$ = combineLatest([user$, mailboxes$.pipe(defined())]).pipe(
  switchMap(([user, mailboxes]) =>
    pool
      .subscription(
        mailboxes?.inboxes,
        { "#p": [user], since: unixNow() - 1 },
        { reconnect: Infinity, resubscribe: true },
      )
      .pipe(
        onlyEvents(),
        filter((event) => event.pubkey !== user),
        mapEventsToStore(eventStore),
      ),
  ),
  share(),
);
```
Mirror `{ reconnect: Infinity, resubscribe: true }` options and `onlyEvents()` + `mapEventsToStore(eventStore)` piping exactly, per RESEARCH.md Pattern 4.

**Anti-pattern — do NOT copy** (`services/nostr.ts:246-270`, `giftWraps$`'s `skip(1)`):
```typescript
export const giftWraps$ = combineLatest([user$, messageInboxes$.pipe(defined())]).pipe(
  switchMap(([user, messageInboxes]) => pool.subscription(messageInboxes, {...}, { reconnect: Infinity })),
  // Skip the first event since we only want new ones
  skip(1),
  mapEventsToStore(eventStore),
  share(),
);
```
CONTEXT.md D2-09 and RESEARCH.md Pitfall 5 explicitly flag this `skip(1)` idiom as fragile and NOT to be used for the prefs loop-prevention. Use payload-equality (RESEARCH.md Pattern 5) instead.

**Error handling / auth-retry pattern** (`services/nostr.ts:203-220`) — try/catch around a signer round-trip, logged via `log()`, never thrown out of the subscription:
```typescript
try {
  await relay.authenticate(signer);
  log("Authenticated to relay", { relay: relay.url });
} catch (error) {
  log("Error authenticating to relay", {
    relay: relay.url, error, response: relay.authenticationResponse,
  });
}
```
Same shape for wrapping `signer.nip44.encrypt/decrypt`/`signer.signEvent` calls in `services/preferences.ts` (with an added `timeout()` wrapper per RESEARCH.md Pitfall 3).

**Signer availability gate pattern** (`services/nostr.ts:124-145`, `signer$` BehaviorSubject + restore-on-config-change subscription) — use `signer$.value` (sync snapshot) inside the publish handler exactly as done throughout `services/nostr.ts`, and gate `enabled$` off `combineLatest([config$, signer$])` per D2-12.

---

### `services/config.ts` (NOT MODIFIED — resolution note)

> **Resolution (locked in 02-03-PLAN.md):** `services/config.ts` is intentionally left UNMODIFIED. Loop prevention (D2-09) lives entirely in the new `services/preferences.ts` via a `lastKnownPayloadJSON` payload-equality guard + `created_at` high-water-mark — NOT by guarding the `config.ts:126` save-on-change subscription. The analysis below explains why that is sufficient; the "MODIFY" framing was the pre-planning hypothesis and no longer applies.

(Original save-on-change analysis, retained for context — guard save-on-change subscription, `:126-128`)

**Analog:** the file's own existing subscription, which is what must be modified/guarded:
```typescript
// Save config when it changes
config$.pipe(skip(1)).subscribe((config) => {
  fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
});
```
This save-on-change is unconditional today (any `config$.next(...)`, local or remote-origin, triggers a `config.json` write — which is fine/desired per D2-15 "never lose the setting locally"). D2-09's loop-prevention concern is specifically about **not re-publishing to nostr**, not about skipping the local save — so this file likely needs **no structural change**, only confirmation that `services/preferences.ts`'s own `lastKnownPayloadJSON` guard (RESEARCH.md Pattern 5) is sufficient and lives entirely in the new service. If planning decides `config.ts:126` itself needs a guard (e.g. to avoid a redundant write when nothing meaningful changed), the `skip(1)` + `.subscribe(...)` shape above is the pattern to extend — e.g. add a `distinctUntilChanged` before it, matching the style already used in `messageInboxes$` (`services/nostr.ts:106-117`, `distinctUntilChanged`-adjacent debounce/timeout chaining).

**Migration/backfill pattern to mirror if `SyncedPrefs.version` needs future migration** (`services/config.ts:97-119`):
```typescript
if (parsed.directMessageNotifications !== undefined && !parsed.messages) {
  parsed.messages = { enabled: parsed.directMessageNotifications, sendContent: parsed.directMessageNotifications, whitelists: [], blacklists: [] };
  delete parsed.directMessageNotifications;
}
if (parsed.groups && (parsed.groups.modes == null || typeof parsed.groups.modes !== "object")) {
  parsed.groups.modes = {};
}
```
Defensive-guard style: check for `null`/wrong-type before trusting a persisted/inbound shape. Same defensiveness should apply when `mergePrefs` receives a decrypted `SyncedPrefs` object of unknown/untrusted provenance (remote nostr event).

---

### `const.ts` (MODIFY: `SIGNER_PERMISSIONS`)

**Current state** (`const.ts:11-13`):
```typescript
export const SIGNER_PERMISSIONS = NostrConnectSigner.buildSigningPermissions([
  kinds.ClientAuth,
]);
```
**Target** (per RESEARCH.md Pitfall 4, exact construction verified against `applesauce-signers` source):
```typescript
export const SIGNER_PERMISSIONS = [
  ...NostrConnectSigner.buildSigningPermissions([kinds.ClientAuth, 30078]),
  "nip44_encrypt",
  "nip44_decrypt",
];
```
**Critical:** per RESEARCH.md Pitfall 4, this constant is currently **dead code** — no call site passes it anywhere. Expanding it alone has zero effect; it must also be wired into all 3 call sites below.

---

### `pages/signer.tsx` (MODIFY x2 call sites)

**Analog:** the file's own current calls, which need `permissions: SIGNER_PERMISSIONS` added.

**Call site 1** (`pages/signer.tsx:33-36`, GET handler, QR-code connect URI):
```typescript
const connectUrl = signer.getNostrConnectURI({
  name: "Nostr Secretary",
});
```
Target: `signer.getNostrConnectURI({ name: "Nostr Secretary", permissions: SIGNER_PERMISSIONS })`. Note the second call on the same line (`qrCodeUrl`'s inline `signer.getNostrConnectURI()`) also needs the same options object — currently called with zero args.

**Call site 2** (`pages/signer.tsx:310-314`, PATCH handler, manual bunker URI connect):
```typescript
const signer = await NostrConnectSigner.fromBunkerURI(
  bunkerUri.trim(),
);
```
Target: `NostrConnectSigner.fromBunkerURI(bunkerUri.trim(), { permissions: SIGNER_PERMISSIONS })` per RESEARCH.md Pitfall 4's exact recommendation.

**Import to add**: `import { SIGNER_PERMISSIONS } from "../const";` alongside the existing `import { DEFAULT_SIGNER_RELAY } from "../const";` (`pages/signer.tsx:8`) — merge into one import statement.

---

### `pages/home.tsx` (MODIFY x1 call site)

**Analog:** the file's own current call (`pages/home.tsx:256-259`), structurally identical to `pages/signer.tsx`'s call site 1:
```typescript
const connectUrl = signer.getNostrConnectURI({
  name: "Nostr Secretary",
});
const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(signer.getNostrConnectURI())}`;
```
Same target fix as `pages/signer.tsx` call site 1 — add `permissions: SIGNER_PERMISSIONS` to both `getNostrConnectURI()` invocations. Import `SIGNER_PERMISSIONS` from `../const` (check existing import block for `DEFAULT_SIGNER_RELAY`-style const imports to merge into).

---

### `tests/helpers/preferences.test.ts` (NEW test)

**Analog:** `tests/helpers/groups.test.ts` (full file pattern, 1-40 of ~N lines shown)

**Imports pattern** (`tests/helpers/groups.test.ts:1-14`):
```typescript
import { describe, test, expect } from "bun:test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";
import {
  type GroupNotificationMode,
  DEFAULT_GROUP_NOTIFICATION_MODE,
  messageMentionsPubkey,
  passesGroupModeGate,
  getGroupMode,
  summarizeGroupModes,
  isGroupNotificationMode,
} from "../../helpers/groups";
```
Mirror exactly: import only from `../../helpers/preferences` (never `services/nostr`, per Pitfall 6), use `bun:test`'s `describe`/`test`/`expect`, build small fixture data inline (`makeMessage`-style helper at `groups.test.ts:27-38`) rather than importing large fixtures.

**Structure**: one `describe(...)` block per exported function (`serializePrefs`, `mergePrefs`), asserting subset-extraction and merge-preservation behavior — e.g. "excludes `sendContent`", "excludes `groupLink`", "preserves local `signer`/`pubkey`/`server`/`topic`/`email`/`lookupRelays` on merge" (D2-05/D2-08 requirements).

---

### `tests/services/preferences.test.ts` (if planning adds a config-round-trip style test) + fixtures

**Analog:** `tests/services/config.test.ts` (full 43-line file) + `tests/fixtures/config-pre-modes.json` (full 30-line fixture)

**Key caveat inherited from RESEARCH.md Pitfall 6**: `tests/services/config.test.ts` imports `services/config` directly (not `services/nostr`), which is safe because `services/config.ts` has no relay-connection side effects, only a top-level `fs.exists`/`fs.readFile` guarded by `Bun.env.CONFIG` (set by `tests/setup.ts` per the comment block at `config.test.ts:4-11`). **`services/preferences.ts` will import `services/nostr.ts`** (for `signer$`, `pool`, `eventStore`, `user$`, `mailboxes$`) — so a test file that imports `services/preferences.ts` directly WILL open live relay connections at import time, exactly the gap `tests/notifications/groups.test.ts` already documents as WR-04. **Recommendation carried into PATTERNS.md**: do not create `tests/services/preferences.test.ts` importing the real module; instead keep all preferences-logic tests in `tests/helpers/preferences.test.ts` (pure functions only) and document the `services/preferences.ts` RxJS-wiring test gap as an accepted, tracked follow-up, matching WR-04's precedent.

**Fixture pattern** (`tests/fixtures/config-pre-modes.json`, full file):
```json
{
  "topic": "pre-modes-fixture-topic",
  "lookupRelays": ["wss://purplepag.es"],
  "appLink": "nostr:{link}",
  "whitelists": [],
  "blacklists": [],
  "messages": { "enabled": false, "sendContent": false, "whitelists": [], "blacklists": [] },
  "replies": { "enabled": true, "whitelists": [], "blacklists": [] },
  "zaps": { "enabled": true, "whitelists": [], "blacklists": [] },
  "groups": { "enabled": true, "whitelists": ["existing-whitelisted-pubkey"], "blacklists": ["existing-blacklisted-pubkey"], "groupLink": "https://chachi.chat/{hostname}/{group}" }
}
```
If a `serializePrefs`/`mergePrefs` round-trip test wants a fixture-driven `AppConfig` object (rather than an inline literal), add a similarly-shaped `tests/fixtures/*.json` and load it the same way `config-pre-modes.json` is loaded by `tests/setup.ts` — but for pure `helpers/preferences.ts` unit tests, an inline object literal (as `groups.test.ts` does with `makeMessage`) is simpler and avoids coupling to the `Bun.env.CONFIG` test-isolation machinery entirely.

---

## Shared Patterns

### Logging
**Source:** `services/logs.ts` (`log` function, imported everywhere as `import { log } from "./logs"` / `"../services/logs"`)
**Apply to:** All new/modified service and helper error paths.
```typescript
log("Failed to decrypt/apply remote notification preferences", {
  error: error instanceof Error ? error.message : String(error),
});
```
Never use `console.log`/`console.error` directly — every existing catch block in `services/nostr.ts` (`:211-217`, `:303-306`) and `helpers/groups.ts` routes through `log()`.

### Timeout-wrapping signer round-trips
**Source:** RESEARCH.md Pitfall 3, existing convention at `helpers/groups.ts:21-26` (`getGroupMetadata`'s `timeout({ first: 2000, with: () => of(undefined) })`) and `services/nostr.ts:290,116` (`simpleTimeout(10_000)`)
**Apply to:** Every `signer.nip44.encrypt`/`.decrypt`/`.signEvent` call in `services/preferences.ts` — `NostrConnectSigner.makeRequest` has no built-in timeout and can hang forever (Pitfall 3).
```typescript
const metadata = await firstValueFrom(
  pool.relay(group.relay).request({...}).pipe(timeout({ first: 2000, with: () => of(undefined) })),
);
```

### Module-scope singleton with side effects at import
**Source:** `services/nostr.ts` (whole-file convention), `services/config.ts` (whole-file convention)
**Apply to:** `services/preferences.ts` — self-subscribing observables exported at module scope, `.subscribe()` calls executed at import time (no explicit `init()` function), following STRUCTURE.md's "Where to Add New Code" guidance already cited in RESEARCH.md.

### Defensive shape validation for untrusted/persisted data
**Source:** `services/config.ts:114-119` (`groups.modes` backfill), `helpers/groups.ts:93-98` (`isGroupNotificationMode`)
**Apply to:** `mergePrefs` in `helpers/preferences.ts` — the decrypted inbound `SyncedPrefs` payload is untrusted (could come from a third-party web app per the phase's own interop goal); validate shape/types before merging into local `AppConfig`, don't trust it blindly.

## No Analog Found

None — all 8 files have a strong existing analog in the codebase (see table above). The one genuinely novel piece of logic — payload-equality loop-prevention (RESEARCH.md Pattern 5) — has no in-repo precedent to copy (the existing `giftWraps$` `skip(1)` attempt at a related problem is flagged as the wrong pattern to copy, not a positive analog), but RESEARCH.md already supplies a complete, ready-to-use implementation for it.

## Metadata

**Analog search scope:** `services/`, `helpers/`, `pages/`, `tests/helpers/`, `tests/services/`, `tests/fixtures/`, `const.ts`
**Files read in full:** `services/nostr.ts` (337 lines), `services/config.ts` (150 lines), `const.ts` (13 lines), `tests/services/config.test.ts` (43 lines), `helpers/groups.ts` (99 lines), `tests/helpers/groups.test.ts` (partial, 40/N lines — sufficient for pattern extraction), `tests/fixtures/config-pre-modes.json` (30 lines); targeted reads of `pages/signer.tsx` (lines 1-45, 295-325) and `pages/home.tsx` (lines 245-265)
**Pattern extraction date:** 2026-07-07
