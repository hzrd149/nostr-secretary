# Phase 3: Review and add NIP-04 DM support - Pattern Map

**Mapped:** 2026-07-09
**Files analyzed:** 6 (2 new, 4 modified)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `const.ts` (modify) | config | CRUD (permission list) | same file, existing `nip44_encrypt`/`nip44_decrypt` entries (lines 20-24) | exact (in-file precedent) |
| `notifications/messages.ts` (modify) | event-driven listener | streaming/event-driven | same file's NIP-17 block (lines 152-205) | exact (in-file precedent) |
| `services/config.ts` (modify) | service/config migration | CRUD (one-time migration) | same file, same migration block (lines 106-119) | exact (in-file precedent) |
| reconnect hint surface (new export + render) | provider/component | event-driven (reactive flag -> UI) | `services/preferences.ts#enabled$` + `pages/notifications.tsx#SyncStatusHint()` (lines 362-382) | exact (D2-14 precedent) |
| `tests/notifications/messages.test.ts` (new) | test | unit / request-response | `tests/notifications/groups.test.ts` (network-safety pattern) + `tests/helpers/preferences.test.ts` (PrivateKeySigner round-trip, lines 301-326) | exact (combined precedent) |
| `tests/const.test.ts` (modify) | test | unit | same file, existing `nip44_decrypt` test case (lines 21-23) | exact (in-file precedent) |

## Pattern Assignments

### `const.ts` — add `nip04_decrypt` permission (D3-02)

**Analog:** same file, lines 20-24 (existing `SIGNER_PERMISSIONS` array)

**Current state** (`const.ts:1-24`):
```typescript
import {
  NostrConnectSigner,
  type NostrConnectionClassMethods,
} from "applesauce-signers";
import { kinds } from "nostr-tools";
...
export const SIGNER_PERMISSIONS = [
  ...NostrConnectSigner.buildSigningPermissions([kinds.ClientAuth, 30078]),
  "nip44_encrypt",
  "nip44_decrypt",
];
```

**Pattern to copy:** add `Permission.Nip04Decrypt` (imported from `applesauce-signers/helpers`) as a new
array entry, following the exact string-literal-vs-constant convention already mixed in this array
(existing entries are hand-typed strings; RESEARCH.md recommends importing the constant for this one
new entry — do not convert the existing string literals, that is out of scope):
```typescript
import { Permission } from "applesauce-signers/helpers";
...
export const SIGNER_PERMISSIONS = [
  ...NostrConnectSigner.buildSigningPermissions([kinds.ClientAuth, 30078]),
  "nip44_encrypt",
  "nip44_decrypt",
  Permission.Nip04Decrypt, // "nip04_decrypt" — D3-02
];
```
No call-site changes needed — `services/signer.ts:113-121` (QR, `getPendingSignerConnectUrl`) and
`:150-158` (bunker URI, `saveBunkerSigner`) both already read `SIGNER_PERMISSIONS` from `const.ts`
by reference.

---

### `notifications/messages.ts` — catchError parity + deep-link + dead-import removal (D3-06/D3-07/D3-08)

**Analog:** same file, NIP-17 block, lines 152-177 (the `catchError` shape) and 181-205 (the
`.subscribe()` shape with click already wired — but note NIP-17 does NOT set `click`; the actual
click precedent is `replies.ts`/`zaps.ts` below)

**Imports pattern to fix** (current `messages.ts:1-38`):
```typescript
import { defined } from "applesauce-core";
import { getDisplayName, getProfilePicture } from "applesauce-core/helpers";
import {
  getLegacyMessageCorraspondant,   // <-- DEAD IMPORT, remove (D3-08)
  getLegacyMessageReceiver,
  unlockGiftWrap,
  unlockLegacyMessage,
} from "applesauce-common/helpers";
import { kinds } from "nostr-tools";
import {
  catchError, combineLatest, EMPTY, filter, from, map, mergeMap, of,
  shareReplay, switchMap, tap,
} from "rxjs";
import { loadLists } from "../helpers/lists";
import { getValue } from "../helpers/observable";
import config$, { getConfig } from "../services/config";
import { log } from "../services/logs";
import {
  blacklist$, eventStore, giftWraps$, isMuted, messageInboxes$, signer$,
  tagged$, whitelist$,
} from "../services/nostr";
import { sendNotification } from "../services/ntfy";
```
Add `import { buildOpenLink } from "../helpers/link";` (mirrors `replies.ts:9`/`zaps.ts:10`).

**Current NIP-04 block, no catchError, no click, no event threaded** (`messages.ts:99-150`):
```typescript
enabledSigner
  .pipe(
    switchMap((signer) =>
      tagged$.pipe(
        filter((event) => event.kind === kinds.EncryptedDirectMessage),
        mergeMap(async (event) => {
          const { pubkey } = getConfig();
          if (!pubkey) return;
          const sender = getLegacyMessageReceiver(event, pubkey);
          if (!sender) return;
          const profile = await getValue(eventStore.profile(sender).pipe(defined()));
          log("Unlocking legacy message", { event: event.id, sender, signer: signer.pubkey });
          const content = await unlockLegacyMessage(event, pubkey, signer);
          if (!content) return;
          return { sender, profile, content };
        }),
      ),
    ),
    defined(),
  )
  .subscribe(async ({ sender, profile, content }) => {
    if (!content) return;
    if (!(await shouldNotify(sender)))
      return log("Skipping notification for blacklisted/non-whitelisted sender", { sender });
    const { messages } = getConfig();
    const displayName = getDisplayName(profile);
    await sendNotification({
      title: `${displayName} sent you a message`,
      message: messages.sendContent ? content : "[content omitted]",
      icon: getProfilePicture(profile),
    });
  });
```

**Analog — NIP-17 catchError block to mirror** (`messages.ts:152-177`):
```typescript
enabledSigner
  .pipe(
    switchMap((signer) =>
      giftWraps$.pipe(
        mergeMap((event) => {
          log("Unlocking gift wrap", { event: event.id, signer: signer.pubkey });
          return from(unlockGiftWrap(event, signer)).pipe(
            catchError((error) => {
              log("Failed to unlock gift wrap", {
                event: event.id,
                signer: signer.pubkey,
                error: Reflect.get(error, "message") || "Unknown error",
              });
              return EMPTY;
            }),
          );
        }),
      ),
    ),
    filter((rumor) => rumor.kind === kinds.PrivateDirectMessage),
  )
```

**Analog — click deep-link, exact call shape** (`notifications/replies.ts` lines ~101-111, and
`notifications/zaps.ts` lines ~106-115 — identical shape in both):
```typescript
await sendNotification({
  title: `${getDisplayName(profile)} replied to your post`,
  message: event.content,
  icon: getProfilePicture(profile),
  click: buildOpenLink(event),
});
```

**Target rewrite for the NIP-04 block** (combining catchError + click + event-threading, per
RESEARCH.md Code Example 3 — wrap the *entire* async body, not just `unlockLegacyMessage`, since
`getValue(eventStore.profile(...))` is also unguarded today):
```typescript
mergeMap((event) => {
  const { pubkey } = getConfig();
  if (!pubkey) return EMPTY;
  const sender = getLegacyMessageReceiver(event, pubkey);
  if (!sender) return EMPTY;

  return from(
    (async () => {
      const profile = await getValue(eventStore.profile(sender).pipe(defined()));
      log("Unlocking legacy message", { event: event.id, sender, signer: signer.pubkey });
      const content = await unlockLegacyMessage(event, pubkey, signer);
      if (!content) return undefined;
      return { sender, profile, content, event };
    })(),
  ).pipe(
    catchError((error) => {
      log("Failed to unlock legacy message", {
        event: event.id,
        signer: signer.pubkey,
        error: Reflect.get(error, "message") || "Unknown error",
      });
      nip04DecryptDegraded$.next(true); // D3-07
      return EMPTY;
    }),
  );
}),
```
and in `.subscribe()`, thread `event` through and add `click: buildOpenLink(event)`. Reset
`nip04DecryptDegraded$.next(false)` on the happy path per RESEARCH Open Question 2.

---

### `services/config.ts` — fix `sendContent` migration default (D3-04)

**Analog:** same file, same block (already the exact location to change) — `services/config.ts:106-119`

**Current (buggy) code:**
```typescript
if (parsed.directMessageNotifications !== undefined && !parsed.messages) {
  parsed.messages = {
    enabled: parsed.directMessageNotifications,
    sendContent: parsed.directMessageNotifications, // Default to same value  <-- BUG
    whitelists: [],
    blacklists: [],
  };
  delete parsed.directMessageNotifications;
}
```

**Fix:** change `sendContent: parsed.directMessageNotifications` to `sendContent: false` per
CONCERNS.md / D3-04. `enabled` continues to inherit the legacy value; only `sendContent` becomes
unconditionally `false`.

---

### Reconnect hint (D3-07) — new reactive flag + non-blocking UI read

**Analog 1 (reactive flag source):** `services/preferences.ts` — grep confirms `prefsSyncEnabled$`
is the exported reactive flag consumed by `pages/notifications.tsx`; equivalent shape:
```typescript
export const enabled$ = combineLatest([config$, signer$]).pipe(
  map(([, signer]) => Boolean(signer)),
  distinctUntilChanged(),
  shareAndHold(),
);
```
For D3-07 use a simpler `BehaviorSubject<boolean>` exported from `notifications/messages.ts` since
this is an edge-triggered failure signal, not a derived config/signer state:
```typescript
import { BehaviorSubject } from "rxjs";
export const nip04DecryptDegraded$ = new BehaviorSubject(false);
```

**Analog 2 (non-blocking async component render):** `pages/notifications.tsx:362-382`
(`SyncStatusHint`):
```tsx
async function SyncStatusHint() {
  const syncEnabled = await firstValueFrom(prefsSyncEnabled$).catch(() => false);

  if (syncEnabled) {
    return (
      <div class="sync-hint sync-enabled">
        Settings sync is enabled — your notification settings are synced across devices.
      </div>
    );
  }

  return (
    <div class="sync-hint">
      Connect a signer to sync your settings across devices.{" "}
      <a href="/signer">Connect a signer</a>
    </div>
  );
}
```
Mounted in `NotificationsView()` as `<SyncStatusHint />` (line 392). Mirror this exact
async-function-returns-JSX, `.catch(() => false)`-guarded shape for a new
`DmDecryptHint()`/similar in `pages/messages.tsx` or `pages/notifications.tsx`, reading
`nip04DecryptDegraded$` via `firstValueFrom(...).catch(() => false)`.

---

### `tests/notifications/messages.test.ts` (new) — D3-09

**Analog 1 (network-safety precedent — do NOT import self-subscribing module):**
`tests/notifications/groups.test.ts` lines 1-23:
```typescript
import { describe, test, expect } from "bun:test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";
import {
  passesGroupModeGate,
  type GroupNotificationMode,
} from "../../helpers/groups";

// NOTE: This file intentionally does NOT import notifications/groups.ts.
// That module self-subscribes to RelayPool/EventStore at import time
// ... Instead, this local `decide` helper documents the exact D-09 layering
// implemented in notifications/groups.ts's `.subscribe()` callback ...
```
Apply identically: do NOT import `notifications/messages.ts` (or the barrel `notifications/index.ts`).
For `shouldNotify` gate coverage, either export `shouldNotify` (one-line visibility change, per
RESEARCH Assumption A3) and call it directly with an unset `pubkey` in the test config (to stay
inside the bounded 2s `isMuted` timeout fallback and avoid live network), or write a local mirror
function following the `decide()` shape above.

**Analog 2 (PrivateKeySigner + manual event decrypt round-trip):**
`tests/helpers/preferences.test.ts` lines 301-326 (`describe("event round-trip ...")`):
```typescript
test("a manually-built, self-encrypted kind-30078 event decrypts back to the original SyncedPrefs via applesauce's app-data helpers", async () => {
  const signer = new PrivateKeySigner();
  const ownPubkey = await signer.getPublicKey();
  ...
  const ciphertext = await signer.nip44.encrypt(ownPubkey, plaintext);
  const template: EventTemplate = { kind: PREFS_KIND, created_at: unixNow(), tags: [["d", PREFS_NAMESPACE]], content: ciphertext };
  const signed = await signer.signEvent(template);
  await unlockAppData(signed, signer);
  const decrypted = getAppDataContent<SyncedPrefs>(signed);
  expect(decrypted).toEqual(payload);
});
```
Mirror this shape for NIP-04 using `unlockLegacyMessage` + `signer.nip04.encrypt`, exactly as
RESEARCH.md's Code Example 4 shows (manually-built kind-4 `NostrEvent`, `PrivateKeySigner` sender +
receiver, `unlockLegacyMessage(event, receiverPubkey, receiverSigner)`).

---

### `tests/const.test.ts` — add `nip04_decrypt` case (D3-02/D3-09)

**Analog:** same file, lines 1-24 (existing `describe("SIGNER_PERMISSIONS", ...)` block, especially
the `nip44_decrypt` case, lines 21-23):
```typescript
import { describe, test, expect } from "bun:test";
import { SIGNER_PERMISSIONS } from "../const";

describe("SIGNER_PERMISSIONS", () => {
  ...
  test("includes nip44_decrypt (D2-13)", () => {
    expect(SIGNER_PERMISSIONS).toContain("nip44_decrypt");
  });
});
```
Add directly-analogous case:
```typescript
test("includes nip04_decrypt (D3-02)", () => {
  expect(SIGNER_PERMISSIONS).toContain("nip04_decrypt");
});
```

## Shared Patterns

### Error handling — `catchError(() => EMPTY)` with sanitized log
**Source:** `notifications/messages.ts:166-173` (NIP-17 block, existing)
**Apply to:** the new NIP-04 catchError block in the same file (D3-08)
```typescript
catchError((error) => {
  log("Failed to unlock gift wrap", {
    event: event.id,
    signer: signer.pubkey,
    error: Reflect.get(error, "message") || "Unknown error",
  });
  return EMPTY;
}),
```
Never log the raw `error` object or event `content`/ciphertext — only `Reflect.get(error, "message")`.

### Click deep-link
**Source:** `notifications/replies.ts` (~line 106), `notifications/zaps.ts` (~line 111)
**Apply to:** `notifications/messages.ts` NIP-04 `sendNotification` call only (D3-06; leave NIP-17 alone per D3-10)
```typescript
click: buildOpenLink(event),
```
Requires `import { buildOpenLink } from "../helpers/link";` and threading the raw `event` through
the NIP-04 mergeMap's return value.

### Non-blocking degrade-and-hint
**Source:** `services/preferences.ts` reactive flag + `pages/notifications.tsx#SyncStatusHint` (lines 362-382)
**Apply to:** new `nip04DecryptDegraded$` export in `notifications/messages.ts` + new hint render function (D3-07)
```tsx
async function SomeHint() {
  const flag = await firstValueFrom(someFlag$).catch(() => false);
  return flag ? <div>...</div> : <div>...</div>;
}
```

### Test isolation — never import self-subscribing notification modules
**Source:** `tests/notifications/groups.test.ts` (top-of-file NOTE comment, lines 8-23)
**Apply to:** `tests/notifications/messages.test.ts` (D3-09) — test pure helpers
(`unlockLegacyMessage`, `shouldNotify` or a local mirror) directly, never import
`notifications/messages.ts` or `notifications/index.ts`.

## No Analog Found

None — every file in this phase has a strong in-repo analog (this is a harden phase modifying
existing, well-precedented code paths).

## Metadata

**Analog search scope:** `const.ts`, `notifications/*.ts`, `services/*.ts`, `helpers/link.ts`,
`pages/notifications.tsx`, `tests/**`
**Files scanned:** `const.ts`, `notifications/messages.ts`, `notifications/replies.ts`,
`notifications/zaps.ts`, `helpers/link.ts`, `services/config.ts`, `services/signer.ts`,
`services/preferences.ts`, `pages/notifications.tsx`, `tests/const.test.ts`,
`tests/helpers/preferences.test.ts`, `tests/notifications/groups.test.ts`
**Pattern extraction date:** 2026-07-09
