# Phase 6: Notification rate limiting per type and global with grouped overflow - Pattern Map

**Mapped:** 2026-07-10
**Files analyzed:** 13 (2 new services, 4 notification-listener call-site edits [5 call sites], 1 config edit, 1 preferences edit, 5 page edits, 3 new/modified tests)
**Analogs found:** 13 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `services/rate-limit.ts` (NEW) | service (impure choke point + timer) | event-driven | `services/nostr.ts` (`shareAndHold`/`timer` + `configValue().pipe(switchMap(...))`) + `services/ntfy.ts` (`sendNotification` primitive being wrapped) + `services/logs.ts` (module-level state) | role-match (composite of 3 analogs) |
| `services/rate-limit-accounting.ts` (NEW) | pure utility (accounting/decision unit) | transform | `notifications/dm-notification-gate.ts` | exact |
| `notifications/replies.ts` (MODIFY, 1 call site) | notification listener | request-response | itself (existing file, only call-target swap) | exact |
| `notifications/zaps.ts` (MODIFY, 1 call site) | notification listener | request-response | itself | exact |
| `notifications/messages.ts` (MODIFY, 2 call sites) | notification listener | request-response | itself | exact |
| `notifications/groups.ts` (MODIFY, 1 call site) | notification listener | request-response | itself | exact |
| `services/config.ts` (MODIFY) | config/model | CRUD | itself — `DEFAULT_MESSAGES_CONFIG` + `migrateConfig`'s `groups.modes` backfill (existing sections in same file) | exact |
| `helpers/preferences.ts` (MODIFY) | model/serialization | transform | itself — `SyncedPrefs`/`serializePrefs`/`sanitizeSyncedPrefs`/`asMessagesCategories`/`mergePrefs` (existing sections in same file) | exact |
| `pages/replies.tsx`, `zaps.tsx`, `messages.tsx`, `groups.tsx` (MODIFY, +1 field each) | route/page (controller) | request-response | `pages/replies.tsx` (has full `route={GET,PATCH}` already) | exact |
| `pages/notifications.tsx` (MODIFY, +first PATCH route) | route/page (controller) | request-response | `pages/replies.tsx`'s PATCH handler (template only — target file currently GET-only) | role-match (no PATCH precedent on this specific file) |
| `tests/services/rate-limit-accounting.test.ts` (NEW) | test | transform | `tests/notifications/dm-notification-gate.test.ts` (or equivalent pure-unit test file) | exact |
| `tests/services/config.test.ts` (MODIFY) | test | CRUD | itself (existing migration-regression tests) | exact |
| `tests/helpers/preferences.test.ts` (MODIFY) | test | transform | itself (existing sync round-trip + old-peer fallback tests) | exact |

## Pattern Assignments

### `services/rate-limit-accounting.ts` (NEW — pure utility, transform)

**Analog:** `notifications/dm-notification-gate.ts` (41 lines, full file read)

**Injected-dependency / clock-injected pure-function pattern** (`notifications/dm-notification-gate.ts:1-41`):
```typescript
import type { AppConfig } from "../services/config";
import type { DmCategory } from "./dm-category";

export type DmGateResult =
  | { pass: true }
  | { pass: false; reason: "category-disabled" }
  | { pass: false; reason: "not-whitelisted" };

/**
 * ... shouldNotify is injected rather than imported so this function has zero
 * dependency on services/nostr.ts's self-subscribing singletons -- it (and
 * this whole module) can be imported directly from a test file without
 * risking real network I/O ...
 */
export async function evaluateDmNotificationGates(
  category: DmCategory,
  messages: Pick<AppConfig["messages"], "contacts" | "others">,
  sender: string,
  shouldNotify: (pubkey: string) => Promise<boolean>,
): Promise<DmGateResult> {
  if (!messages[category].enabled)
    return { pass: false, reason: "category-disabled" };
  if (!(await shouldNotify(sender)))
    return { pass: false, reason: "not-whitelisted" };
  return { pass: true };
}
```

**Apply this shape to `rate-limit-accounting.ts`:** same "zero import of `services/nostr.ts`/`services/config.ts`/`services/ntfy.ts`" discipline; `now: number` takes the place of the injected `shouldNotify` — never call `Date.now()` inside. Exported functions: `createRateLimitState(now)`, `evaluate(state, type, now, config) => {deliver, state}`, `flushOverflow(state, now) => {summary, nextState}`, `formatOverflowSummary(overflow) => string | null`. Concrete reference implementation for all four functions is in `06-RESEARCH.md` "Pattern 2" / "Pattern 3" (already read directly from this session's research, HIGH confidence) — copy that code as the starting point, it already follows the exact analog shape above.

**Type union pattern** (mirrors `DmGateResult`'s discriminated union) — use a plain `NotificationType = "replies" | "zaps" | "messages" | "groups"` union, matching the 4 coarse types already hardcoded identically in all four listener files' `shouldNotify` (`replies.ts:26`, `zaps.ts:27`, `messages.ts` categories, `groups.ts:42`).

---

### `services/rate-limit.ts` (NEW — impure service, event-driven)

**Analogs:** `services/ntfy.ts` (sendNotification signature, 255 lines, full file read), `services/logs.ts` (module-level buffer, 10 lines, full file read), `services/nostr.ts` (RxJS timer pattern, lines 45-65 read)

**Primitive being wrapped** (`services/ntfy.ts:129-131`, `:43-74` types):
```typescript
export interface NtfyNotificationOptions {
  title?: string;
  message: string;         // required — non-empty (validated at services/ntfy.ts:140)
  // ...topic, server, priority, tags, delay, click, attach, filename, email, call, icon, actions, markdown
}
export async function sendNotification(
  options: NtfyNotificationOptions,
): Promise<NtfyResponse> { /* throws NtfyServiceError on !options.message?.trim() */ }
```
Note: `sendNotification` requires non-empty `message` — `formatOverflowSummary` must return `null` (not `""`) when nothing overflowed, and the flush caller must gate on `summary !== null` before calling `sendNotification`.

**Module-level state precedent** (`services/logs.ts:1-10`, full file):
```typescript
export const logs: { message: string; details?: Record<string, any> }[] = [];
export function log(message: string, details?: Record<string, any>) {
  if (details) console.log(message, details);
  else console.log(message);
  logs.push({ message, details });
  if (logs.length > 10_000) logs.shift();
}
```
`services/rate-limit.ts` mirrors this: a bare top-level `let state = createRateLimitState(...)` mutable variable, reassigned (never mutated in place) on every `evaluate`/`flushOverflow` call — same "module-level singleton service state" shape `services/logs.ts` and `services/config.ts`'s `config$` establish. **Pitfall (from RESEARCH.md):** tests must NEVER import `services/rate-limit.ts` directly (same failure mode as `services/config.ts`'s `config$` documented in `tests/services/config.test.ts:8-15`) — only import the pure `rate-limit-accounting.ts` from tests.

**RxJS timer/switchMap precedent for config-driven periodic scheduling** (`services/nostr.ts:57-62`):
```typescript
function shareAndHold<T>(timeout = 60_000): MonoTypeOperatorFunction<T> {
  return share({
    resetOnRefCountZero: () => timer(timeout),
    connector: () => new ReplaySubject(1),
  });
}
```
This confirms `timer`/RxJS-based scheduling (not raw `setInterval`) is the established idiom in this codebase for anything time-based tied to config. Use `configValue("rateLimit").pipe(switchMap((cfg) => interval(cfg.window * 1000)))` for the flush scheduler — `switchMap` gives automatic cancel+restart on live `window` edits with zero manual timer-handle bookkeeping, exactly like `shareAndHold`'s `resetOnRefCountZero: () => timer(timeout)` already does for a different config-driven concern in the same file.

**Grouped-summary bypass (D6-06):** the RxJS subscribe callback calls `sendNotification(...)` **directly** — never `rateLimitedNotify(...)` — to guarantee the summary itself is never rate-limited. Full drop-in reference code for both the `rateLimitedNotify` wrapper and the timer-driven flush subscription is in `06-RESEARCH.md`'s "Code Examples" section under "Pattern 3" (already vetted against these exact analog files this session).

---

### 5 call-site swaps: `notifications/{replies,zaps,messages×2,groups}.ts`

**Pattern:** 1:1 drop-in replacement — only the function name changes (`sendNotification` → `rateLimitedNotify`) plus a leading `type` string literal; the `options` object passed is IDENTICAL, and the existing `shouldNotify`/category-gate code immediately above each call site is untouched (D6-10).

- `notifications/replies.ts:102-107` (existing):
```typescript
await sendNotification({
  title: `${getDisplayName(profile)} replied to your post`,
  message: event.content,
  icon: getProfilePicture(profile),
  click: buildOpenLink(event),
});
```
→ becomes `await rateLimitedNotify("replies", { ...same fields... });` plus `import { rateLimitedNotify } from "../services/rate-limit";` (replacing/alongside the existing `import { sendNotification } from "../services/ntfy";` — the `sendNotification` import can be dropped from this file since it becomes unused here).

- `notifications/zaps.ts:107-112` (existing):
```typescript
await sendNotification({
  title: "Zap Received",
  message: `${getDisplayName(profile)} zapped you ${payment?.amount / 1000} sats`,
  icon: getProfilePicture(profile),
  click: buildOpenLink(event),
});
```
→ `rateLimitedNotify("zaps", { ...same... })`.

- `notifications/messages.ts:224-229` (NIP-04 send site):
```typescript
await sendNotification({
  title: `${displayName} sent you a message`,
  message: messages.sendContent ? content : "[content omitted]",
  icon: getProfilePicture(profile),
  click: buildOpenLink(event),
});
```
- `notifications/messages.ts:318-326` (NIP-17 send site):
```typescript
await sendNotification({
  title: `${displayName} sent you a message`,
  message: messages.sendContent ? content : "[content omitted]",
  icon: getProfilePicture(profile),
  click: buildOpenLink(rumor as unknown as NostrEvent),
});
```
→ BOTH become `rateLimitedNotify("messages", { ...same... })` — same `"messages"` type string, per D6-03/Pitfall 4 (do not invent `"messages-nip04"`/`"messages-nip17"`).

- `notifications/groups.ts:143-148` (existing):
```typescript
await sendNotification({
  title: `${getDisplayName(profile)} posted to ${getTagValue(metadata, "name")}`,
  message: message.content,
  icon: getTagValue(metadata, "picture") ?? getProfilePicture(profile),
  click: buildGroupLink(group, message),
});
```
→ `rateLimitedNotify("groups", { ...same... })`.

---

### `services/config.ts` (MODIFY — config/model, CRUD)

**Analog:** same file's existing `DEFAULT_MESSAGES_CONFIG` constant (`services/config.ts:71-77`) + the `groups.modes` migration-backfill block (`services/config.ts:219-231`).

**Default-constant pattern to mirror** (`services/config.ts:71-77`):
```typescript
export const DEFAULT_MESSAGES_CONFIG: AppConfig["messages"] = {
  contacts: { enabled: true },
  others: { enabled: false },
  sendContent: false,
  whitelists: [],
  blacklists: [],
};
```
→ New: `export const DEFAULT_RATE_LIMIT_CONFIG: AppConfig["rateLimit"] = { window: 60, global: 20, perType: { replies: 5, zaps: 5, messages: 5, groups: 5 } };` — same "exported so tests can assert against this default directly" comment convention.

**Migration-backfill guard pattern to mirror** (`services/config.ts:219-231`, the `groups.modes` backfill — this is the CLOSEST existing precedent for "add a new nested config object defensively"):
```typescript
if (parsed.groups == null || typeof parsed.groups !== "object") {
  parsed.groups = {};
}
if (
  parsed.groups.modes == null ||
  typeof parsed.groups.modes !== "object"
) {
  parsed.groups.modes = {};
}
```
→ New `rateLimit` backfill in `migrateConfig` follows the identical null/non-object guard shape, but seeds from `structuredClone(DEFAULT_RATE_LIMIT_CONFIG)` (not `{}`) since there is no legacy predecessor field to preserve partial values from (unlike `messages.enabled` → `contacts`/`others`).

**AppConfig type-field pattern** (`services/config.ts:37-58`, the `replies`/`zaps`/`groups` field shapes) — add `rateLimit: { window: number; global: number; perType: Record<"replies"|"zaps"|"messages"|"groups", number> };` as a new top-level `AppConfig` field, same flat-object style as the existing `replies`/`zaps` fields.

**BehaviorSubject seed** (`services/config.ts:79-103`) — add `rateLimit: DEFAULT_RATE_LIMIT_CONFIG,` to the `config$` seed object alongside `replies:`/`zaps:`/`groups:`.

---

### `helpers/preferences.ts` (MODIFY — model/serialization, transform)

**Analog:** same file's `SyncedPrefs` type + `serializePrefs`/`sanitizeSyncedPrefs`/`mergePrefs`/`asMessagesCategories` (all read in full, 261 lines).

**SyncedPrefs field-addition pattern** (`helpers/preferences.ts:37-56`, the `replies`/`zaps` shape is the simplest analog — no category split like `messages`):
```typescript
replies: { enabled: boolean; whitelists: string[]; blacklists: string[] };
zaps: { enabled: boolean; whitelists: string[]; blacklists: string[] };
```
→ New: `rateLimit: { window: number; global: number; perType: Record<"replies"|"zaps"|"messages"|"groups", number> };` added to `SyncedPrefs`. Bump `PREFS_VERSION` from `2` to `3` (`helpers/preferences.ts:28`), matching the existing "bumped to 2 for the D5-10 split" comment convention.

**serializePrefs field-by-field pattern** (`helpers/preferences.ts:75-79`, the `replies` block):
```typescript
replies: {
  enabled: config.replies.enabled,
  whitelists: config.replies.whitelists,
  blacklists: config.replies.blacklists,
},
```
→ New: `rateLimit: { window: config.rateLimit.window, global: config.rateLimit.global, perType: { ...config.rateLimit.perType } },` built field-by-field per the file's own "never spreads a whole sub-object" discipline (comment at `:59-65`).

**Coercion-helper pattern** (`helpers/preferences.ts:98-101` `asStringArray`, `:104-106` `asBoolean`) — add a new `asNonNegativeInt(value: unknown): number` helper following the exact same "coerce untrusted decrypted payload field defensively" shape:
```typescript
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}
function asBoolean(value: unknown): boolean {
  return value === true;
}
```
→ `function asNonNegativeInt(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback; }`

**CRITICAL — old-peer fallback pattern is the INVERSE of `asMessagesCategories`** (`helpers/preferences.ts:120-150`, read in full):
```typescript
function asMessagesCategories(raw: Record<string, unknown>): {
  contacts: { enabled: boolean };
  others: { enabled: boolean };
} {
  if (raw.contacts !== undefined || raw.others !== undefined) {
    // new-schema payload path
    ...
  }
  const legacyEnabled = asBoolean(raw.enabled);   // <-- seeds from a REAL legacy value
  return { contacts: { enabled: legacyEnabled }, others: { enabled: legacyEnabled } };
}
```
This pattern works ONLY because a legacy `messages.enabled` boolean exists to seed from. `rateLimit` has **no legacy predecessor** — a pre-Phase-6 payload's `raw.rateLimit` is simply `undefined`, full stop. Per RESEARCH.md Pitfall #6: the new `asRateLimit(raw)`-style helper (or inline in `sanitizeSyncedPrefs`) must, when `raw.rateLimit` is absent/malformed, fall back to **this device's own already-migrated local safe defaults** (`DEFAULT_RATE_LIMIT_CONFIG` from `services/config.ts`, imported into `helpers/preferences.ts`), NOT to `{global: 0, window: 0, perType: {...0}}`. This is the one place in this phase where copying the closest textual analog verbatim produces the WRONG behavior — write a fresh function, only borrowing the surrounding coercion style (guard-then-coerce), not the "legacy value" fallback logic itself.

**mergePrefs pattern** (`helpers/preferences.ts:226-227`, `replies`/`zaps` lines):
```typescript
replies: { ...current.replies, ...incoming.replies },
zaps: { ...current.zaps, ...incoming.zaps },
```
→ New: `rateLimit: { ...current.rateLimit, ...incoming.rateLimit },` — same shallow-merge-onto-current shape (note: `incoming.rateLimit.perType` should be spread as a whole object here since `SyncedPrefs.rateLimit.perType` is already-sanitized by this point).

---

### `pages/{replies,zaps,messages,groups}.tsx` (MODIFY — route/page, +1 field each)

**Analog:** `pages/replies.tsx` (143 lines, full file read) — the template for ALL FIVE page edits including `pages/notifications.tsx`'s brand-new PATCH handler.

**Full PATCH-handler + form pattern** (`pages/replies.tsx:82-141`, full route export):
```typescript
const route = {
  GET: async () => {
    return new Response(await RepliesConfigView(), {
      headers: { "Content-Type": "text/html" },
    });
  },
  PATCH: async (req: BunRequest) => {
    const reader = await ServerSentEventGenerator.readSignals(req);
    if (!reader.success) throw new Error(reader.error);
    return ServerSentEventGenerator.stream(async (stream) => {
      const { signals } = reader;
      const enabled = signals.enabled as boolean;
      // ...parse text fields...
      try {
        const currentConfig = config$.getValue();
        const newConfig = {
          ...currentConfig,
          replies: { enabled: !!enabled, whitelists, blacklists },
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
};
export default route;
```
**Form-field markup pattern** (`pages/replies.tsx:30-52`, the `enabled` checkbox) — use the same `data-bind`/label/`.help-text` shape for a new number input, e.g.:
```tsx
<div class="form-group">
  <label for="rateLimitPerType">Rate limit (per minute, 0 = unlimited)</label>
  <input type="number" id="rateLimitPerType" data-bind="rateLimitPerType" min="0"
    value={repliesConfig.rateLimitPerType ?? 5} />
  <div class="help-text">Max notifications of this type per window. 0 disables the limit.</div>
</div>
```
Apply identically (flat, page-scoped signal name e.g. `rateLimitPerType`) to `zaps.tsx`, `messages.tsx`, `groups.tsx`, reading/writing `config.rateLimit.perType.<type>` via `updateConfig`/`config$.next` in each page's existing PATCH body (merge into `newConfig.rateLimit.perType.<type>`, spreading the rest of `rateLimit` from `currentConfig.rateLimit`).

---

### `pages/notifications.tsx` (MODIFY — first-ever PATCH route on this file)

**Analog for the NEW PATCH handler:** `pages/replies.tsx:88-141`'s PATCH handler (same template as above) — this is a template copy, not an edit of an existing handler on this file, since `pages/notifications.tsx`'s current `route` export (`pages/notifications.tsx:436-444`, full route confirmed) is:
```typescript
const route = {
  GET: async () => {
    return new Response(await NotificationsView(), {
      headers: { "Content-Type": "text/html" },
    });
  },
};
export default route;
```
No `PATCH` key exists today. Add one following `pages/replies.tsx`'s exact shape: `ServerSentEventGenerator.readSignals(req)` → `stream(async (stream) => {...try/catch...config$.next(...)...stream.patchSignals(...)})`, merging into `newConfig.rateLimit.global` and `newConfig.rateLimit.window` (both fields live at this page's top level, not nested under a `perType.<type>` key like the 4 per-type pages). The page's `NotificationsView()` function (`pages/notifications.tsx:400-434`) needs a new form section (mirroring `pages/replies.tsx:30-58`'s `<div class="form-group">` + `data-bind` + "Save" button pattern) added inside the existing `<div class="notifications-container">`, plus the standard `data-show="$saved"`/`data-show="$error"` message divs already used in `pages/replies.tsx:19-29` (currently absent from `notifications.tsx`, since it has never had a mutating form before).

---

### Tests

**`tests/services/rate-limit-accounting.test.ts` (NEW)** — analog: `notifications/dm-notification-gate.ts`'s consumer test file, importing ONLY the pure module (never `services/rate-limit.ts`) and constructing fresh state via `createRateLimitState(now)` per test case, injecting `now` as a literal number — same zero-real-timer discipline the codebase already uses for pure notification-gate units.

**`tests/services/config.test.ts` (MODIFY)** — analog: existing `groups.modes` migration-regression tests in the same file (mirrors the `services/config.ts:219-231` backfill logic being tested) — add cases for `migrateConfig` backfilling `rateLimit` when absent/null/malformed, and idempotency on an already-migrated config.

**`tests/helpers/preferences.test.ts` (MODIFY)** — analog: existing `asMessagesCategories`-adjacent sync round-trip + old-schema-payload tests in the same file — add `serializePrefs`/`sanitizeSyncedPrefs`/`mergePrefs` round-trip cases for `rateLimit`, PLUS an explicit regression test asserting the OPPOSITE fallback direction from `asMessagesCategories` (absent `raw.rateLimit` → local safe defaults, NOT zero/unlimited) — see Pitfall #6 above.

## Shared Patterns

### Module-scope singleton state + side effects
**Source:** `services/logs.ts` (full file), `services/config.ts`'s `config$` `BehaviorSubject`
**Apply to:** `services/rate-limit.ts`'s module-level `state` variable and its RxJS timer subscription — established codebase idiom for per-process, non-persisted state.

### RxJS `configValue(...).pipe(switchMap(...))` for config-driven scheduling
**Source:** `services/nostr.ts:57-62` (`shareAndHold`'s `resetOnRefCountZero: () => timer(timeout)`), `services/config.ts:255-260` (`configValue` helper itself)
**Apply to:** `services/rate-limit.ts`'s flush-interval scheduler — `configValue("rateLimit").pipe(switchMap((cfg) => interval(cfg.window * 1000)))`.

### `log()` never `console.log` directly
**Source:** `services/logs.ts:2-4`; used throughout `notifications/*.ts` (e.g. `replies.ts:57`, `:79`, `:91`)
**Apply to:** Any diagnostic logging inside `services/rate-limit.ts` (e.g. logging an accumulated/overflowed notification) — use `import { log } from "./logs";`, never bare `console.log`.

### Datastar PATCH-form pattern (`ServerSentEventGenerator`)
**Source:** `pages/replies.tsx:1-8` (imports), `:82-141` (full route)
**Apply to:** All 5 page edits — the 4 per-type pages extend their existing PATCH bodies; `pages/notifications.tsx` gets this whole pattern freshly.

### ASVS V5 defensive coercion of untrusted decrypted sync payloads
**Source:** `helpers/preferences.ts:98-118` (`asStringArray`/`asBoolean`/`asModes`)
**Apply to:** New `asNonNegativeInt` helper for `rateLimit.window`/`.global`/`.perType.*` fields in `sanitizeSyncedPrefs`.

## No Analog Found

None — every file in scope has at least a role-match analog in the existing codebase; the only near-miss is `pages/notifications.tsx`'s PATCH handler, which has no in-file precedent but a strong cross-file template (`pages/replies.tsx`), captured above rather than listed as "no analog."

## Metadata

**Analog search scope:** `services/`, `notifications/`, `helpers/`, `pages/`, `tests/` (all read directly, full files where ≤ 327 lines; targeted offset reads for `notifications/messages.ts` and `services/nostr.ts`)
**Files scanned (full or targeted read):** `services/ntfy.ts`, `services/logs.ts`, `services/config.ts`, `services/nostr.ts` (partial), `helpers/preferences.ts`, `notifications/dm-notification-gate.ts`, `notifications/replies.ts`, `notifications/zaps.ts`, `notifications/groups.ts`, `notifications/messages.ts` (partial), `pages/replies.tsx`, `pages/notifications.tsx` — 12 files
**Pattern extraction date:** 2026-07-10
