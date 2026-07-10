# Phase 4: NIP-17 DM Notifications Hardening - Pattern Map

**Mapped:** 2026-07-10
**Files analyzed:** 6 (2 modified, 2 new source, 2 new test)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `services/nostr.ts` (`giftWraps$` rewrite, lines 217-240) | service (RxJS singleton) | event-driven (subscription) | same file, `tagged$` (lines 193-214) | role-match (same file, sibling observable; no `pool.request()` precedent exists anywhere in repo — genuinely new composition) |
| `helpers/gift-wrap-subscription.ts` (NEW) | utility (pure RxJS combinator) | transform / event-driven | `helpers/observable.ts` (`getValue`) | role-match (pure, no singleton imports, small RxJS utility) |
| `notifications/gift-wrap-messages.ts` (NEW) | service (pure decrypt/classify unit) | transform | `notifications/legacy-messages.ts` (`decryptLegacyDirectMessage`, `getMessageDisplayName`) | exact (direct Phase-3 precedent, same DI shape) |
| `notifications/messages.ts` (NIP-17 block, lines 194-247) | controller/listener (RxJS subscribe) | event-driven | same file, NIP-04 block (lines 113-192) | exact (sibling block in same file, already partially mirrors it) |
| `tests/helpers/gift-wrap-subscription.test.ts` (NEW) | test | transform | `tests/notifications/groups.test.ts` | role-match (network-safe pure-logic unit test) |
| `tests/notifications/gift-wrap-messages.test.ts` (NEW) | test | transform | `tests/notifications/legacy-messages.test.ts` | exact (same extracted-pure-unit test shape, DI mocks) |

## Pattern Assignments

### `services/nostr.ts` — `giftWraps$` rewrite (lines 217-240)

**Analog:** sibling observable `tagged$` in the same file (lines 193-214), plus RESEARCH.md's verified Example 1/2 (grounded directly against installed `node_modules/applesauce-relay` source).

**Current buggy shape** (lines 217-240, to be replaced):
```typescript
export const giftWraps$ = combineLatest([
  user$,
  messageInboxes$.pipe(defined()),
]).pipe(
  switchMap(([user, messageInboxes]) =>
    pool.subscription(
      messageInboxes,
      {
        "#p": [user],
        kinds: [kinds.GiftWrap],
        limit: 1,
      },
      { reconnect: Infinity },
    ),
  ),
  skip(1),
  mapEventsToStore(eventStore),
  share(),
);
```

**Imports pattern** (top of file, lines 1-51): existing `import { ... skip, ... } from "rxjs"` (line 39) — `skip` becomes dead after the fix and must be removed (Pitfall 2 in RESEARCH.md); add `catchError`, `concat` (used inside the new helper, not necessarily in this file directly), `EMPTY` (already imported line 29). `eventStore` is declared at line 63 in this same file and already used by `mapEventsToStore(eventStore)` at line 210/238 — reuse it directly for the new `pool.request()` seed call, do not create a new `EventStore()`.

**Sibling pattern to mirror** — `tagged$` (lines 193-214) shows the established `combineLatest([user$, X$.pipe(defined())]) -> switchMap -> pool.subscription(...) -> pipe(..., mapEventsToStore(eventStore)) -> share()` shape that `giftWraps$` must keep; only the inner `switchMap` body changes to compose seed+live via the new combinator instead of calling `pool.subscription()` directly.

**Target shape** (RESEARCH.md Example 1, verified against installed `applesauce-relay` source):
```typescript
import { notifyNewGiftWraps } from "../helpers/gift-wrap-subscription";

export const giftWraps$ = combineLatest([
  user$,
  messageInboxes$.pipe(defined()),
]).pipe(
  switchMap(([user, messageInboxes]) => {
    const giftWrapFilter = { "#p": [user], kinds: [kinds.GiftWrap] };

    const seed$ = pool
      .request(messageInboxes, giftWrapFilter, { eventStore, timeout: 10_000 })
      .pipe(catchError(() => EMPTY));

    const live$ = pool.subscription(messageInboxes, giftWrapFilter, {
      reconnect: Infinity,
    });

    return notifyNewGiftWraps(seed$, live$);
  }),
  mapEventsToStore(eventStore),
  share(),
);
```

**Naming pitfall (from RESEARCH.md Anti-Patterns):** do NOT name the filter object `filter` — `filter` is already imported from `"rxjs"` in this file and used elsewhere (e.g. `tagged$` line 209); shadowing it breaks other code in scope. Use `giftWrapFilter`.

---

### `helpers/gift-wrap-subscription.ts` (NEW)

**Analog:** `helpers/observable.ts` (pure, no singleton imports, small exported utility) for file shape/style; RESEARCH.md Example 2 for the actual implementation (this is genuinely new logic, not adapted from an existing analog — no seed/live dedup combinator exists elsewhere in the repo).

**Style precedent** (`helpers/observable.ts`, full file, 8 lines):
```typescript
import { defined, simpleTimeout } from "applesauce-core";
import { firstValueFrom, type Observable } from "rxjs";

export function getValue<T>(
  observable: Observable<T>,
  timeout = 5_000,
): Promise<NonNullable<T>> {
  return firstValueFrom(observable.pipe(defined(), simpleTimeout(timeout)));
}
```
Note the shape: no top-level singleton imports (no `pool`, `eventStore`, `signer$`), a plain exported function taking an `Observable` and returning a derived value/observable — `notifyNewGiftWraps` follows this same "pure helper, safe to import in tests" convention.

**Target implementation** (RESEARCH.md Example 2, full):
```typescript
import type { NostrEvent } from "nostr-tools";
import { concat, filter, ignoreElements, Observable, tap } from "rxjs";

export function notifyNewGiftWraps(
  seed$: Observable<NostrEvent>,
  live$: Observable<NostrEvent>,
  seen: Set<string> = new Set(),
): Observable<NostrEvent> {
  return concat(
    seed$.pipe(
      tap((event) => seen.add(event.id)),
      ignoreElements(),
    ),
    live$.pipe(
      filter((event) => {
        if (seen.has(event.id)) return false;
        seen.add(event.id);
        return true;
      }),
    ),
  );
}
```
Critical invariant (Pitfall 1 in RESEARCH.md): `seen` must be checked on EVERY `live$` emission, not just seeded once — a relay resends its whole backlog on any fresh REQ, including the one `live$` itself opens.

---

### `notifications/gift-wrap-messages.ts` (NEW)

**Analog:** `notifications/legacy-messages.ts` (`decryptLegacyDirectMessage`, `getMessageDisplayName`) — DIRECT Phase-3 precedent, mirror its shape exactly.

**Full analog file structure** (`notifications/legacy-messages.ts`, 104 lines) — key excerpts:

Imports (lines 1-9):
```typescript
import {
  getDisplayName,
  npubEncode,
  type ProfileContent,
} from "applesauce-core/helpers";
import { unlockLegacyMessage } from "applesauce-common/helpers";
import type { NostrEvent } from "nostr-tools";

import { log } from "../services/logs";
```

DI-deps type pattern (lines 23-30):
```typescript
export type DecryptLegacyMessageDeps = {
  getProfile: (sender: string) => Promise<ProfileContent | undefined>;
  unlock: typeof unlockLegacyMessage;
  log: typeof log;
};
```

Core exported async function taking `deps` last, with a doc comment explaining WHY it's safe to import in tests (lines 32-78):
```typescript
export async function decryptLegacyDirectMessage(
  event: NostrEvent,
  pubkey: string,
  sender: string,
  signer: LegacySigner,
  deps: DecryptLegacyMessageDeps,
): Promise<DecryptedLegacyMessage | undefined> {
  const profile = await deps.getProfile(sender).catch(() => undefined);
  deps.log("Unlocking legacy message", { event: event.id, sender, signer: signer.pubkey });
  const content = await deps.unlock(event, pubkey, signer);
  if (!content) return undefined;
  return { sender, profile, content, event };
}
```

**Target implementation for the new file** (RESEARCH.md Example 4, mirroring the shape above but simpler — no profile lookup needed here, D4-05 keeps decrypt-failure handling in the caller not this module):
```typescript
import { unlockGiftWrap, type Rumor } from "applesauce-common/helpers";
import type { NostrEvent } from "nostr-tools";
import { kinds } from "nostr-tools";

export type UnwrapGiftWrapDeps = {
  unlock: typeof unlockGiftWrap;
};

export async function unlockPrivateDirectMessage(
  event: NostrEvent,
  signer: Parameters<typeof unlockGiftWrap>[1],
  deps: UnwrapGiftWrapDeps = { unlock: unlockGiftWrap },
): Promise<Rumor | undefined> {
  const rumor = await deps.unlock(event, signer);
  if (rumor.kind !== kinds.PrivateDirectMessage) return undefined;
  return rumor;
}
```

No top-level singleton imports (no `pool`, `eventStore`, `signer$`) — matches the legacy-messages.ts precedent that makes it safe to unit-test directly.

---

### `notifications/messages.ts` — NIP-17 block (lines 194-247)

**Analog A (deep-link, D4-04):** the NIP-04 block in the SAME file (line 190): `click: buildOpenLink(event)`. Also `helpers/link.ts`'s `buildOpenLink` signature (lines 28-42) — takes a `NostrEvent`, reads only `.kind`/pointer helpers.

**Analog B (error-guard, D4-06):** the NIP-04 block's `catchError` in the SAME file (lines 148-163), specifically line 152:
```typescript
error: error instanceof Error ? error.message : String(error),
```
Contrast with the current NIP-17 `catchError` (lines 208-216) which uses the unsafe form:
```typescript
error: Reflect.get(error, "message") || "Unknown error",
```
This must be replaced with the identical `instanceof Error` guard used in the NIP-04 block.

**Analog C (rewire to extracted unit, D4-09):** the NIP-04 block's `mergeMap` (lines 120-137) already calls out to `decryptLegacyDirectMessage(...)` from `./legacy-messages` — the NIP-17 `mergeMap` (lines 201-217) should be rewired the same way to call `unlockPrivateDirectMessage(event, signer, { unlock: unlockGiftWrap })` from `./gift-wrap-messages`, replacing the current inline `from(unlockGiftWrap(event, signer)).pipe(...)` + separate `filter((rumor) => rumor.kind === kinds.PrivateDirectMessage)` (line 221) — the extracted unit already does the kind filter internally, returning `undefined` for non-DM rumors, so the outer `.pipe` needs a `filter(defined())`-style guard afterward instead.

**Current NIP-17 block in full** (lines 194-247), the direct edit target — imports needed: `unlockPrivateDirectMessage` from `./gift-wrap-messages` (replacing/supplementing the raw `unlockGiftWrap` import at line 6), `buildOpenLink` already imported at line 24.

**Target NIP-17 subscribe callback addition** (D4-04, applied to lines 242-246):
```typescript
await sendNotification({
  title: `${displayName} sent you a message`,
  message: messages.sendContent ? content : "[content omitted]",
  icon: getProfilePicture(profile),
  click: buildOpenLink(rumor as unknown as NostrEvent),
});
```
Note the required cast (RESEARCH.md Anti-Patterns): `Rumor` lacks `.sig`, so `rumor as unknown as NostrEvent` is needed to satisfy `buildOpenLink`'s `NostrEvent` parameter type — confirmed safe at runtime since `buildOpenLink`'s internal `getEventPointerForEvent`/`getAddressPointerForEvent` (see `helpers/link.ts` lines 16-19, 34-38) only read `.id`/`.kind`/`.pubkey`, never `.sig`. This exact double-cast pattern already exists at `tests/helpers/preferences.test.ts:34` (`{...} as unknown as AppConfig["signer"]`).

---

### `tests/helpers/gift-wrap-subscription.test.ts` (NEW)

**Analog:** `tests/notifications/groups.test.ts` — network-safe precedent for testing pure decision logic with `bun:test`, `describe`/`test`/`expect`, without importing the self-subscribing `notifications/*.ts` singleton modules. Structural shape (imports, `describe` block, fixture builder function) to mirror:
```typescript
import { describe, test, expect } from "bun:test";
import type { NostrEvent } from "nostr-tools";
// import ONLY the pure module under test — never notifications/messages.ts
// or services/nostr.ts (network-via-loader), per this file's own header
// comment precedent.
```
Full target test content: RESEARCH.md Example 3 (`tests/helpers/gift-wrap-subscription.test.ts`) — uses `rxjs`'s `of`/`Subject` to simulate seed (completing) vs. live (persistent) observables, asserting the 4 dedup-contract cases (historical-not-emitted, new-wrap-emitted, empty-seed-still-notifies, live-dedup-of-repeats).

---

### `tests/notifications/gift-wrap-messages.test.ts` (NEW)

**Analog:** `tests/notifications/legacy-messages.test.ts` — exact structural match (extracted pure unit, DI mocks, no singleton imports). Header-comment convention to mirror (lines 11-18 of the analog):
```typescript
// notifications/legacy-messages.ts has no top-level singleton imports or
// side effects (unlike notifications/messages.ts / services/nostr.ts, which
// self-subscribe to the live RelayPool/EventStore at import time -- see
// tests/notifications/messages.test.ts's precedent), so it is safe to
// import directly here.
```

**Signer fixture:** `tests/helpers/preferences.test.ts` imports `PrivateKeySigner` from `"applesauce-signers"` (line 2) as the standard signer fixture. Reuse this same import; `PrivateKeySigner` exposes `.nip44`, required for the NIP-17 gift-wrap round trip.

Full target test content: RESEARCH.md Example 4's test file — uses `GiftWrapFactory.create()` from `applesauce-common/factories` + `PrivateKeySigner` from `applesauce-signers` for a real (in-memory, no network) gift-wrap round trip, asserting `unlockPrivateDirectMessage` returns the rumor for kind 14 and `undefined` for other kinds.

---

## Shared Patterns

### Safe error-extraction guard (D4-06)
**Source:** `notifications/messages.ts:152` (NIP-04 `catchError`)
```typescript
error: error instanceof Error ? error.message : String(error),
```
**Apply to:** `notifications/messages.ts`'s NIP-17 `catchError` (currently line 212, `Reflect.get(error, "message") || "Unknown error"`).

### Deep-link click pattern (D4-04)
**Source:** `notifications/messages.ts:190` (NIP-04 block), `helpers/link.ts:28-42` (`buildOpenLink`)
```typescript
click: buildOpenLink(event), // NIP-04
click: buildOpenLink(rumor as unknown as NostrEvent), // NIP-17 target — cast required, rumor has no .sig
```
**Apply to:** `notifications/messages.ts`'s NIP-17 `sendNotification(...)` call (lines 242-246).

### Extracted pure-unit + DI-deps pattern (D4-09 test extraction)
**Source:** `notifications/legacy-messages.ts` (whole file) + `tests/notifications/legacy-messages.test.ts` (whole file)
**Apply to:** `notifications/gift-wrap-messages.ts` (new) and its test — same shape: `type XDeps = {...}`, exported async function taking `deps` last (or with a real-default `deps` param for lighter DI, per RESEARCH.md Example 4's `deps: UnwrapGiftWrapDeps = { unlock: unlockGiftWrap }` convention, slightly simpler than legacy-messages.ts's no-default style since there's no log/profile side channel needed here), no top-level singleton imports.

### `combineLatest([user$, X$.pipe(defined())]) -> switchMap -> ... -> mapEventsToStore(eventStore) -> share()` (RxJS singleton observable shape)
**Source:** `services/nostr.ts` — both `tagged$` (lines 193-214) and the existing `giftWraps$` (lines 217-240)
**Apply to:** the rewritten `giftWraps$` — keep this outer shape; only the `switchMap` body's use of `pool.subscription()` alone changes to a seed+live composition via `notifyNewGiftWraps`.

## No Analog Found

None — all 6 files have a strong analog (see table above). The only genuinely novel logic is the `notifyNewGiftWraps` combinator body itself (no seed/live RxJS dedup pattern exists elsewhere in the repo); RESEARCH.md's Example 2 (grounded against installed `applesauce-relay` source, not training-data recollection) is the reference implementation to use in place of a codebase analog for that one function body.

## Metadata

**Analog search scope:** `services/nostr.ts`, `notifications/messages.ts`, `notifications/legacy-messages.ts`, `helpers/link.ts`, `helpers/observable.ts`, `tests/notifications/legacy-messages.test.ts`, `tests/notifications/groups.test.ts`, `tests/helpers/preferences.test.ts`
**Files scanned:** 8 read directly + grep sweep for `pool.request(` (zero hits outside RESEARCH.md — confirmed novel) and `eventStore` usage sites in `services/nostr.ts`
**Pattern extraction date:** 2026-07-10
