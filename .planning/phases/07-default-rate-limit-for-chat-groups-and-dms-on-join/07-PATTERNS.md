# Phase 7: Default rate limit for chat groups and DMs on join - Pattern Map

**Mapped:** 2026-07-13
**Files analyzed:** 9 (all modifications of existing Phase-6 files; no new files this phase)
**Analogs found:** 9 / 9 — every file's analog is its OWN current form (additive extension of Phase 6)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `services/rate-limit-accounting.ts` | service (pure accounting) | transform (CRUD-like counter state) | itself (current `evaluate`/`RateLimitState`/`RateLimitConfig`) | exact (same file, extend in place) |
| `services/rate-limit.ts` | service (impure shell / choke point) | request-response | itself (current `rateLimitedNotify`/`InjectedDeps`) | exact |
| `notifications/groups.ts` | event-driven listener | event-driven | itself (current `rateLimitedNotify("groups", …)` call at :143) | exact |
| `notifications/messages.ts` | event-driven listener | event-driven | itself (current 2 `rateLimitedNotify("messages", …)` calls at :224, :318) | exact |
| `services/config.ts` | config/model | CRUD (config load + migration) | itself (current `AppConfig.rateLimit`, `DEFAULT_RATE_LIMIT_CONFIG`, migration block :277-334) | exact |
| `helpers/preferences.ts` | service (sync serialize/sanitize) | pub-sub (NIP-78 sync) | itself (current `SyncedPrefs.rateLimit`, `asRateLimit`, `PREFS_VERSION`) | exact |
| `pages/groups.tsx` | route/page (view + PATCH) | request-response | itself (current `rateLimitPerType` field/PATCH block :238-255, :301, :341-366) | exact |
| `pages/messages.tsx` | route/page (view + PATCH) | request-response | itself (current `rateLimitPerType` field/PATCH block :111-128, :175, :199-219) | exact |
| `tests/services/rate-limit-accounting.test.ts` | test | transform (unit test) | itself (current injected-`createRateLimitState`-per-case style, no shared state) | exact |

No "no analog" files this phase — every target file already exists with the exact pattern to extend (this is a pure additive extension of Phase 6, per D7-09 / RESEARCH.md).

## Pattern Assignments

### `services/rate-limit-accounting.ts` (service, pure accounting)

**Analog:** itself, current source

**RateLimitConfig to extend** (current lines 31-38):
```typescript
export type RateLimitConfig = {
  window: number;
  global: number;
  perType: Record<NotificationType, number>;
};
```
Add top-level siblings `perGroup: number; perDm: number;` (NOT nested inside `perType` — different axis, see RESEARCH Pattern 4 / Anti-Patterns).

**RateLimitState to extend** (current lines 83-92):
```typescript
export type RateLimitState = {
  windowStart: number;
  globalCount: number;
  perTypeCount: Record<NotificationType, number>;
  overflow: Record<NotificationType, number>;
};
```
Add `contexts: Record<string, number>;` — a flat map, keyed `` `${type}:${contextKey}` ``.

**createRateLimitState to extend** (current lines 109-116):
```typescript
export function createRateLimitState(now: number): RateLimitState {
  return {
    windowStart: now,
    globalCount: 0,
    perTypeCount: { replies: 0, zaps: 0, messages: 0, groups: 0 },
    overflow: { replies: 0, zaps: 0, messages: 0, groups: 0 },
  };
}
```
Add one line: `contexts: {},` — this single addition is the ENTIRE pruning mechanism (D7-02): `rollIfExpired` (current lines 124-131, unchanged) already discards/recreates the whole state on window tumble, so `contexts` resets for free alongside `perTypeCount`/`overflow`. Do not add any independent TTL/LRU eviction.

**evaluate() to extend — most-restrictive-wins gate** (current lines 143-172, full existing function):
```typescript
export function evaluate(
  state: RateLimitState,
  type: NotificationType,
  now: number,
  config: RateLimitConfig,
): { deliver: boolean; state: RateLimitState } {
  const rolled = rollIfExpired(state, now, config.window);

  const typeLimit = config.perType[type];
  const underType = typeLimit === 0 || rolled.perTypeCount[type] < typeLimit;
  const underGlobal = config.global === 0 || rolled.globalCount < config.global;

  if (underType && underGlobal) {
    const next: RateLimitState = {
      ...rolled,
      globalCount: rolled.globalCount + 1,
      perTypeCount: {
        ...rolled.perTypeCount,
        [type]: rolled.perTypeCount[type] + 1,
      },
    };
    return { deliver: true, state: next };
  }

  const next: RateLimitState = {
    ...rolled,
    overflow: { ...rolled.overflow, [type]: rolled.overflow[type] + 1 },
  };
  return { deliver: false, state: next };
}
```
Extend with a 5th optional `context?: string` param and a third `underContext` gate computed from the SAME `rolled` (never a second `rollIfExpired` call — see Anti-Patterns). Full target shape is in RESEARCH.md "Pattern 2" (already copy-paste ready, cites this exact current code as its base). Key discipline to preserve:
- One `rollIfExpired` call feeds all three gates.
- Delivery requires `underType && underGlobal && underContext`.
- On delivery, increment `globalCount`, `perTypeCount[type]`, AND `contexts[key]` (when `contextKey` present) in the SAME return.
- On rejection, ONLY `overflow[type]++` — `contexts` is never touched on rejection (D7-07; no per-context overflow substructure).
- Add a small `contextLimitFor(type, config)` helper mapping `"groups" → config.perGroup`, `"messages" → config.perDm`, else `0`.

**No new clamp constant** — reuse the existing plain non-negative-int check pattern; `perGroup`/`perDm` do NOT need a `MIN_WINDOW_SECONDS`-style clamp (0 is a safe, already-handled "unlimited" sentinel here, unlike `window`).

---

### `services/rate-limit.ts` (service, impure shell)

**Analog:** itself, current source

**InjectedDeps to extend** (current lines 78-81):
```typescript
type InjectedDeps = {
  now?: number;
  send?: typeof sendNotification;
};
```
Add `context?: string;` as a new optional key on the SAME bag — not a new positional parameter (fully backward-compatible with every existing test call and the 4 non-chat call sites).

**rateLimitedNotify to extend** (current lines 101-122, full function):
```typescript
export async function rateLimitedNotify(
  type: NotificationType,
  options: Parameters<typeof sendNotification>[0],
  { now, send }: InjectedDeps = {},
): Promise<void> {
  const effectiveNow = now ?? Date.now() / 1000;
  const effectiveSend = send ?? sendNotification;
  const { rateLimit } = getConfig();

  const result = evaluate(state, type, effectiveNow, {
    ...rateLimit,
    window: clampWindowSeconds(rateLimit.window),
  });
  state = result.state;

  if (result.deliver) {
    await effectiveSend(options);
    return;
  }

  log("Notification accumulated for grouped overflow summary", { type });
}
```
Destructure `context` too (`{ context, now, send }`), pass it as `evaluate`'s new 5th argument. Do NOT log `context` in the `log(...)` call (privacy parity with existing `{ type }`-only log).

**Do not touch** the flush-timer block (current lines 163-175, `configValue("rateLimit").pipe(map(cfg => clampWindowSeconds(cfg.window)), distinctUntilChanged(), switchMap(...))`) — it projects only `window`, deliberately ignoring unrelated `rateLimit` sub-field writes (CR-01 fix); `perGroup`/`perDm` changes must NOT restart the flush timer. Leave untouched.

---

### `notifications/groups.ts` (event-driven listener)

**Analog:** itself, current call site (lines 119-149, full subscribe block; `encodeGroupPointer` imported line 8, `group: GroupPointer` destructured line 119)

**Current call to extend** (lines 143-148):
```typescript
await rateLimitedNotify("groups", {
  title: `${getDisplayName(profile)} posted to ${getTagValue(metadata, "name")}`,
  message: message.content,
  icon: getTagValue(metadata, "picture") ?? getProfilePicture(profile),
  click: buildGroupLink(group, message),
});
```
Add a 3rd argument `{ context: encodeGroupPointer(group) }` — `encodeGroupPointer` is already imported (line 8) and `group` already in scope; no new lookup/import needed.

---

### `notifications/messages.ts` (event-driven listener, 2 call sites)

**Analog:** itself, current call sites (NIP-04 at lines 224-229; NIP-17 at lines 318-326)

**NIP-04 site to extend** (`sender` destructured at line 172, from `getLegacyMessageReceiver` at line 127):
```typescript
await rateLimitedNotify("messages", {
  title: `${displayName} sent you a message`,
  message: messages.sendContent ? content : "[content omitted]",
  icon: getProfilePicture(profile),
  click: buildOpenLink(event),
});
```
Add `{ context: sender }` as 3rd arg.

**NIP-17 site to extend** (`sender = rumor.pubkey` at line 268):
```typescript
await rateLimitedNotify("messages", {
  title: `${displayName} sent you a message`,
  message: messages.sendContent ? content : "[content omitted]",
  icon: getProfilePicture(profile),
  click: buildOpenLink(rumor as unknown as NostrEvent),
});
```
Add `{ context: sender }` as 3rd arg — SAME raw pubkey, no transport prefix (Pitfall 4: NIP-04 and NIP-17 from the same counterparty must share ONE `"messages:<pubkey>"` bucket).

---

### `services/config.ts` (config/model)

**Analog:** itself, current `AppConfig["rateLimit"]` (lines 68-83), `DEFAULT_RATE_LIMIT_CONFIG` (lines 116-120), migration block (lines 277-334)

**AppConfig["rateLimit"] to extend** (current lines 71-83):
```typescript
rateLimit: {
  window: number;
  global: number;
  perType: {
    replies: number;
    zaps: number;
    messages: number;
    groups: number;
  };
};
```
Add top-level siblings `perGroup: number; perDm: number;`.

**DEFAULT_RATE_LIMIT_CONFIG to extend** (current lines 116-120):
```typescript
export const DEFAULT_RATE_LIMIT_CONFIG: AppConfig["rateLimit"] = {
  window: 60,
  global: 20,
  perType: { replies: 5, zaps: 5, messages: 5, groups: 5 },
};
```
Add `perGroup: 3, perDm: 5,` (D7-06 defaults).

**Migration block to extend** (current lines 300-333, the `global`/`perType` backfill pattern to mirror line-for-line):
```typescript
if (!isValidNonNegativeNumber(parsed.rateLimit.global))
  parsed.rateLimit.global = DEFAULT_RATE_LIMIT_CONFIG.global;
```
Add two mirrored lines:
```typescript
if (!isValidNonNegativeNumber(parsed.rateLimit.perGroup))
  parsed.rateLimit.perGroup = DEFAULT_RATE_LIMIT_CONFIG.perGroup;
if (!isValidNonNegativeNumber(parsed.rateLimit.perDm))
  parsed.rateLimit.perDm = DEFAULT_RATE_LIMIT_CONFIG.perDm;
```
Use the existing `isValidNonNegativeNumber` helper already defined at lines 297-298 in this same function — no new clamp constant (Pitfall 2).

---

### `helpers/preferences.ts` (sync serialize/sanitize)

**Analog:** itself, current `SyncedPrefs.rateLimit` (lines 66-75), `serializePrefs` (lines 86-125), `asRateLimit` (lines 219-251), `PREFS_VERSION` (line 38)

**SyncedPrefs.rateLimit to extend** (current lines 66-75):
```typescript
rateLimit: {
  window: number;
  global: number;
  perType: {
    replies: number;
    zaps: number;
    messages: number;
    groups: number;
  };
};
```
Add `perGroup: number; perDm: number;` top-level siblings.

**serializePrefs to extend** (current lines 114-123):
```typescript
rateLimit: {
  window: config.rateLimit.window,
  global: config.rateLimit.global,
  perType: {
    replies: config.rateLimit.perType.replies,
    zaps: config.rateLimit.perType.zaps,
    messages: config.rateLimit.perType.messages,
    groups: config.rateLimit.perType.groups,
  },
},
```
Add `perGroup: config.rateLimit.perGroup, perDm: config.rateLimit.perDm,` — build field-by-field (never spread a whole sub-object), matching this file's existing anti-leak discipline (Pitfall 8).

**asRateLimit to extend** (current lines 219-251, full function — the exact per-field `asNonNegativeInt(source.X, DEFAULT_RATE_LIMIT_CONFIG.X)` pattern to mirror):
```typescript
function asRateLimit(raw: Record<string, unknown>): SyncedPrefs["rateLimit"] {
  const rateLimit = raw.rateLimit;
  if (rateLimit === null || typeof rateLimit !== "object")
    return structuredClone(DEFAULT_RATE_LIMIT_CONFIG);

  const source = rateLimit as Record<string, unknown>;
  const perType = (source.perType ?? {}) as Record<string, unknown>;

  return {
    window: clampWindowSeconds(
      asNonNegativeInt(source.window, DEFAULT_RATE_LIMIT_CONFIG.window),
    ),
    global: asNonNegativeInt(source.global, DEFAULT_RATE_LIMIT_CONFIG.global),
    perType: { /* ...existing per-field coercion... */ },
  };
}
```
Add two more lines to the returned object:
```typescript
perGroup: asNonNegativeInt(source.perGroup, DEFAULT_RATE_LIMIT_CONFIG.perGroup),
perDm: asNonNegativeInt(source.perDm, DEFAULT_RATE_LIMIT_CONFIG.perDm),
```
Never spread `source`/`raw.rateLimit` wholesale (Pitfall 6) — always per-field `asNonNegativeInt`.

**PREFS_VERSION** (current line 38: `export const PREFS_VERSION = 3;`) — bump to `4`, following the same "forward-compat marker" comment convention already at lines 27-34.

---

### `pages/groups.tsx` (route/page)

**Analog:** itself, current `rateLimitPerType` field (view lines 238-255) + PATCH clamp/merge (lines 301, 341-347, 359-366)

**View block to copy as a template** (current lines 238-255):
```tsx
<div class="form-group">
  <label
    for="rateLimitPerType"
    style="font-weight: bold; margin-bottom: 8px; display: block;"
  >
    Rate Limit
  </label>
  <input
    type="number"
    id="rateLimitPerType"
    data-bind="rateLimitPerType"
    min="0"
    value={String(currentConfig.rateLimit.perType.groups)}
  />
  <div class="help-text">
    Max group notifications per window. 0 = unlimited.
  </div>
</div>
```
Add a SECOND, distinctly-named block (`id`/`data-bind="rateLimitPerGroup"`, bound to `currentConfig.rateLimit.perGroup`, help text mentioning "any single group" + "0 = unlimited" per Pitfall 5). Do NOT reuse the `rateLimitPerType` signal name (Pitfall 7/Anti-Patterns — this page already HAS a rate-limit field; this is an ADDITIONAL second field, not the first).

**PATCH handler to extend** (current lines 301, 344-347, 359-366):
```typescript
const rawRateLimitPerType = Number(signals.rateLimitPerType);
...
const rateLimitPerType =
  Number.isFinite(rawRateLimitPerType) && rawRateLimitPerType >= 0
    ? Math.floor(rawRateLimitPerType)
    : currentConfig.rateLimit.perType.groups;
...
rateLimit: {
  ...currentConfig.rateLimit,
  perType: {
    ...currentConfig.rateLimit.perType,
    groups: rateLimitPerType,
  },
},
```
Add a mirrored `rawRateLimitPerGroup`/`rateLimitPerGroup` clamp block, and merge `perGroup: rateLimitPerGroup` as a TOP-LEVEL sibling of `perType` in the `rateLimit: { ... }` object (not nested inside `perType`).

---

### `pages/messages.tsx` (route/page)

**Analog:** itself, current `rateLimitPerType` field (view lines 111-128) + PATCH clamp/merge (lines 175, 199-202, 213-219)

**View block to copy as a template** (current lines 111-128):
```tsx
<div class="form-group">
  <label
    for="rateLimitPerType"
    style="font-weight: bold; margin-bottom: 8px; display: block;"
  >
    Rate Limit
  </label>
  <input
    type="number"
    id="rateLimitPerType"
    data-bind="rateLimitPerType"
    min="0"
    value={String(currentConfig.rateLimit.perType.messages)}
  />
  <div class="help-text">
    Max message notifications per window. 0 = unlimited.
  </div>
</div>
```
Add a SECOND block for `rateLimitPerDm` / `currentConfig.rateLimit.perDm` (help text: "any single DM conversation" + "0 = unlimited").

**PATCH handler to extend** (current lines 175, 199-202, 213-219):
```typescript
const rawRateLimitPerType = Number(signals.rateLimitPerType);
...
const rateLimitPerType =
  Number.isFinite(rawRateLimitPerType) && rawRateLimitPerType >= 0
    ? Math.floor(rawRateLimitPerType)
    : currentConfig.rateLimit.perType.messages;
...
rateLimit: {
  ...currentConfig.rateLimit,
  perType: {
    ...currentConfig.rateLimit.perType,
    messages: rateLimitPerType,
  },
},
```
Add mirrored `rawRateLimitPerDm`/`rateLimitPerDm` clamp block; merge `perDm: rateLimitPerDm` as top-level sibling of `perType`.

---

### `tests/services/rate-limit-accounting.test.ts` (test)

**Analog:** itself, current style (full file header/imports lines 1-28, first `describe` blocks lines 30-60)

**Import + fixture pattern to keep** (current lines 1-28):
```typescript
import { describe, test, expect } from "bun:test";
import {
  createRateLimitState,
  evaluate,
  flushOverflow,
  formatOverflowSummary,
  type NotificationType,
  type RateLimitConfig,
} from "../../services/rate-limit-accounting";

const ALL_TYPES: NotificationType[] = ["replies", "zaps", "messages", "groups"];

function makeConfig(overrides: Partial<RateLimitConfig> = {}): RateLimitConfig {
  return {
    window: 60,
    global: 20,
    perType: { replies: 5, zaps: 5, messages: 5, groups: 5 },
    ...overrides,
  };
}
```
Extend `makeConfig` with `perGroup: 3, perDm: 5,` defaults (overridable). This file imports ONLY the pure accounting module (never `services/rate-limit.ts`) and constructs fresh state per case via `createRateLimitState(now)` — no `beforeEach` reset needed; keep this discipline for the new per-context test cases (isolation between different context keys, lazy creation on first `evaluate()` call, pruning on window tumble via `rollIfExpired`, most-restrictive-wins layering, overflow-rollup into `overflow[type]` only, `0 = unlimited` for `perGroup`/`perDm`).

**Existing `evaluate` call shape to extend** (current line 46): `evaluate(state, "replies", 1001, config)` — add a 5th optional `context` argument for the new per-context cases: `evaluate(state, "groups", 1001, config, "example.com'abc123")`.

---

## Shared Patterns

### Options-bag extension (not positional params)
**Source:** `services/rate-limit.ts:78-81` (`InjectedDeps`)
**Apply to:** `services/rate-limit.ts`, and any test constructing `rateLimitedNotify(type, options, { ... })`
Add new optional keys to the SAME bag rather than new positional parameters — keeps all 4 non-chat call sites (`notifications/replies.ts`, `notifications/zaps.ts`) untouched.

### Non-negative-int coercion (never a wholesale spread)
**Source:** `services/config.ts:297-298` (`isValidNonNegativeNumber`), `helpers/preferences.ts:146-150` (`asNonNegativeInt`)
**Apply to:** `services/config.ts` migration, `helpers/preferences.ts` `asRateLimit`, both PATCH handlers in `pages/groups.tsx`/`pages/messages.tsx`
```typescript
// services/config.ts:297-298
const isValidNonNegativeNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
// helpers/preferences.ts:146-150
function asNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return fallback;
  return Math.floor(value);
}
```
Never `{ ...raw.rateLimit }` wholesale-spread an untrusted payload — always per-field coercion (Pitfall 6).

### Top-level-siblings, not nested config fields
**Source:** `services/config.ts:71-83`, `helpers/preferences.ts:66-75`
**Apply to:** `services/config.ts`, `helpers/preferences.ts`
`perGroup`/`perDm` are top-level siblings of `perType`, never nested inside it — `perType` represents a different axis ("total across all instances of this type") from `perGroup`/`perDm` ("per single instance of a chat-type context").

### Same rollIfExpired/window reset drives all pruning
**Source:** `services/rate-limit-accounting.ts:124-131` (`rollIfExpired`), `:109-116` (`createRateLimitState`)
**Apply to:** `services/rate-limit-accounting.ts`'s new `contexts` map
No new eviction/TTL/LRU code — `contexts: {}` resets for free every time the existing tumbling-window logic recreates state.

### Flush-timer isolation — do not touch
**Source:** `services/rate-limit.ts:163-175`
**Apply to:** No file in this phase should modify these lines. The `distinctUntilChanged()` on `clampWindowSeconds(cfg.window)` deliberately ignores unrelated `rateLimit` sub-field writes (including the new `perGroup`/`perDm`) — this is an intentional CR-01 fix from Phase 6, not an oversight.

## Metadata

**Analog search scope:** `services/`, `notifications/`, `helpers/`, `pages/`, `tests/services/` (all files named explicitly in CONTEXT.md/RESEARCH.md — no broader glob search needed since every target file already exists and was read directly)
**Files scanned:** 9 (all fully read; each ≤ 400 lines, single-pass reads)
**Pattern extraction date:** 2026-07-13
