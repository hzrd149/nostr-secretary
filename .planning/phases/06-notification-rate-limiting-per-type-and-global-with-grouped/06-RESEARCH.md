# Phase 6: Notification rate limiting per type and global with grouped overflow - Research

**Researched:** 2026-07-10
**Domain:** In-process rate limiting + grouped-overflow notification for a single-process Bun/RxJS
app (no new external dependencies — this is a hand-rolled accumulate-and-flush pattern, not a
generic token-bucket problem).
**Confidence:** HIGH (architecture/patterns — read directly from source); MEDIUM (specific numeric
defaults — reasonable but not verified against any external spec, see Assumptions Log).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D6-01 (central service):** Add `services/rate-limit.ts`. All four listeners
  (`replies.ts`, `zaps.ts`, `messages.ts` — both NIP-04 and NIP-17 send sites — and `groups.ts`)
  route their `sendNotification(...)` through it, passing a **type** label. It is the single choke
  point (5 existing `sendNotification` call sites). Implement as a `rateLimitedNotify(type, options)`
  (or a wrapper the listeners call) that decides deliver-now vs. accumulate-for-grouped-summary.
- **D6-02 (sliding window):** Enforce a **sliding-window** counter per type AND a global bucket
  over a configurable window (default **60s**). A notification is delivered iff BOTH its type
  window and the global window are under their limits; otherwise it is counted toward the grouped
  overflow.
- **D6-03 ("type" = 4 coarse types):** The rate-limit "type" is one of the four existing coarse
  categories: **replies, zaps, messages, groups**. Do NOT split by Phase-5 contacts/others or by
  per-group/per-DM here — per-context limits are Phase 7. (For DMs, both the NIP-04 and NIP-17 send
  sites use the `messages` type.)
- **D6-04 (accumulate, don't drop):** When a per-type or global limit is hit, do NOT drop the
  notification silently — increment a per-type **overflow counter** for the current window.
- **D6-05 (one combined summary at window end):** At the end of the window (a debounced/timer
  flush), if any overflow accumulated, send **one combined grouped notification** whose body
  summarizes the withheld per-type counts, e.g. "47 new mentions, 12 group messages, 3 zaps". Reset
  the counters after flushing. (One combined message, not per-type separate summaries.)
- **D6-06 (grouped summary bypasses the limiter):** The grouped summary notification is emitted via
  `sendNotification` **directly, bypassing** `rateLimitedNotify`, so it can never itself be
  rate-limited/suppressed.
- **D6-07 (configurable, synced):** Limits are configurable in `AppConfig` — a **global** limit and
  a **per-type** limit for each of the four types (and the window). These are notification **rules**,
  so they sync via the Phase-2 kind-30078 event (extend `helpers/preferences.ts` `SyncedPrefs` +
  serialize/sanitize, following D2-04). Follow the `migrateConfig` pattern to add fields with a
  migration + defaults.
- **D6-08 (minimal UI):** Add a rate-limit field to each existing per-type config page
  (`pages/replies.tsx`, `pages/zaps.tsx`, `pages/messages.tsx`, `pages/groups.tsx`) for that type's
  limit, and a **global** limit control on `pages/notifications.tsx`. Reuse the existing form +
  Datastar signal + PATCH pattern; flat signal names. Keep it minimal (a number input per limit).
- **D6-09 (defaults):** Sensible anti-spam defaults — **per-type ≈ 5 per minute**, **global ≈ 20 per
  minute**, **window = 60s**. Planning may tune exact numbers; a limit of `0` should mean "unlimited"
  (disabled) so users can turn rate limiting off per type or globally. New installs get these
  defaults; existing configs get them via migration (rate limiting is additive — do not surprise
  users by suppressing more than the defaults imply; document any behavior change in CHANGELOG).
- **D6-10 (last gate, tight scope):** The rate limiter is the **final** gate before delivery — it
  runs AFTER the existing `shouldNotify` and the Phase-5 per-category gate. It must NOT change which
  events qualify for a notification, only whether a qualifying notification is delivered now vs.
  grouped. No per-context (per-group/per-DM) limits (Phase 7). No changes to decrypt/unwrap/mute
  logic. Preserve `sendContent` behavior (grouped summaries are counts only — never DM plaintext,
  regardless of `sendContent`).

### Claude's Discretion
- The exact sliding-window data structure (ring of timestamps vs. per-window counter with a timer)
  and where per-process rate state lives (module-level in `services/rate-limit.ts`, like
  `services/logs.ts`'s buffer).
- The flush mechanism (RxJS timer/debounce vs. a `setInterval`/`setTimeout`), so long as it emits at
  most one grouped summary per window and resets counters.
- Exact config field shape (`rateLimit: { global, window, perType: {...} }` vs. per-type nested in
  each section) — pick what migrates/syncs cleanly and keeps the UI simple.
- Extract the pure decision/accounting logic (window accounting, overflow summary formatting) into a
  network-safe testable unit (mirroring Phase 3-5's extracted units) so it can be unit-tested
  without real timers/relays (inject a clock).

### Deferred Ideas (OUT OF SCOPE)
- Per-context (per-group / per-DM-conversation) rate limits + auto-defaults on join — explicitly
  Phase 7.
- Priority-aware limiting (never rate-limit urgent/zap-over-threshold, etc.) — not requested; revisit
  if users ask.
- Persisting rate-limit state across restarts — in-memory per-process is acceptable (mirrors the app's
  in-memory EventStore/log buffer).
</user_constraints>

<phase_requirements>
## Phase Requirements

No formal REQ-IDs exist for this phase; `.planning/phases/06-.../06-CONTEXT.md`'s D6-01..D6-10
decisions are the contract and are treated as the requirement set for planning/verification.

| ID | Description | Research Support |
|----|-------------|------------------|
| D6-01 | Central `services/rate-limit.ts`, `rateLimitedNotify(type, options)` wraps all 5 call sites | See "Architecture Patterns" §1, "Code Examples" §1-2; call sites confirmed at `notifications/replies.ts:102`, `zaps.ts:107`, `messages.ts:224`+`:318`, `groups.ts:143` |
| D6-02 | Per-type AND global window counters, deliver iff both under limit | See "Architecture Patterns" §1 (tumbling-window recommendation), "Code Examples" §2 |
| D6-03 | Type = coarse `replies\|zaps\|messages\|groups`; both DM send sites use `"messages"` | See "Common Pitfalls" #4 |
| D6-04 | Accumulate overflow per type instead of dropping | See "Code Examples" §2 (`evaluate`) |
| D6-05 | One combined grouped summary at window end, reset counters | See "Architecture Patterns" §1 (RxJS timer flush), "Code Examples" §3 (`flushOverflow`/`formatOverflowSummary`) |
| D6-06 | Grouped summary bypasses the limiter | See "Code Examples" §4; "Validation Architecture" test for this |
| D6-07 | Config shape + sync via kind-30078 + `migrateConfig` | See "Standard Stack"/"Config shape", "helpers/preferences.ts extension" |
| D6-08 | Minimal per-type + global number-input UI | See "Architecture Patterns" §UI; `pages/notifications.tsx` currently has no PATCH route (new finding, Pitfall #7) |
| D6-09 | Defaults 5/min per-type, 20/min global, 60s window, `0` = unlimited, additive migration | See "Common Pitfalls" #5, Assumptions Log A1 |
| D6-10 | Rate limiter is the last gate; never changes `shouldNotify`/category gating; grouped summary never contains DM plaintext | See "Common Pitfalls" #3; "Architectural Responsibility Map" |
</phase_requirements>

## Summary

This phase adds no new external dependency — it is a small, stateful, in-process accounting
problem layered on primitives the codebase already has: `services/config.ts`'s `BehaviorSubject`
pattern, `services/logs.ts`'s module-level buffer, RxJS (already a dependency, `^7.8.2`
`[VERIFIED: package.json:27]`), and the Phase 3-5 precedent of extracting a **pure,
network-safe, clock/dependency-injected unit** for anything that needs deterministic unit tests
(`notifications/dm-category.ts`, `notifications/dm-notification-gate.ts`,
`notifications/legacy-messages.ts` — all zero-import-of-`services/nostr.ts` pure functions covered
directly by `tests/notifications/*.test.ts`).

The single most important design call this research makes: despite CONTEXT.md's "sliding-window"
wording (D6-02), the actual required behavior — accumulate overflow, flush **once at window end**,
**reset** counters (D6-04/05) — is a **tumbling (fixed-interval) window**, not a classic
sliding-window log of individual timestamps. A ring-of-timestamps sliding log has no natural "window
end" moment to trigger a single combined flush; you'd need a *separate* flush timer bolted on
top anyway, making the ring redundant complexity for this specific use case. Recommend: a
**per-window counter + reset, driven by an RxJS timer keyed off the configurable window**, which
satisfies D6-02's "counter over a configurable window" language, is trivially clock-injectable
(pass `now: number` as an explicit param, never read `Date.now()` inside the pure logic), and
naturally produces the "flush + reset" moment D6-05 needs. `services/rate-limit.ts` is the impure,
stateful shell (owns the module-level state + the RxJS timer + the two `sendNotification` calls —
the gated one and the bypass one); a sibling pure module
`services/rate-limit-accounting.ts` holds all decision/formatting logic with zero imports from
`services/nostr.ts`/`services/config.ts`/`services/ntfy.ts`, so it is safe to import directly from
tests exactly like `notifications/dm-category.ts` is today.

The riskiest parts of this phase are NOT the counting logic (that's simple) — they are (1) the sync
fallback for a not-yet-upgraded peer device (a pre-Phase-6 `SyncedPrefs` payload has no `rateLimit`
key at all; unlike Phase 5's `asMessagesCategories` fallback, there is no legacy value to seed from,
so the fallback must apply this device's own already-migrated safe defaults, NOT `0`/unlimited — see
Pitfall #6), and (2) `pages/notifications.tsx` currently has **no PATCH route at all** (`GET`-only,
confirmed at `pages/notifications.tsx:436-444`) — adding the global rate-limit field is the first
mutating-form addition to that page, not a copy-paste of an existing pattern (see Pitfall #7).

**Primary recommendation:** `services/rate-limit.ts` (impure, module-level state, RxJS timer) wraps
a pure `services/rate-limit-accounting.ts` (`evaluate`, `flushOverflow`, `formatOverflowSummary`,
all clock-injected); `rateLimitedNotify(type, options)` is a drop-in swap for the 5 existing
`sendNotification(...)` call sites; config lives in one new `AppConfig.rateLimit: { global, window,
perType: {replies, zaps, messages, groups} }` field, migrated with defaults `{global: 20, window: 60,
perType: {each: 5}}`, synced via a `SyncedPrefs.rateLimit` addition (`PREFS_VERSION` bump to 3) with
an explicit "absent → apply local safe defaults" fallback.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Rate-limit choke point (`rateLimitedNotify`) | Service Layer (`services/rate-limit.ts`) | — | D6-01 explicit; same tier as `services/ntfy.ts`'s delivery primitive it wraps |
| Window/overflow accounting (pure `evaluate`/`flushOverflow`) | Service Layer (`services/rate-limit-accounting.ts`) | — | Co-located pure sibling of its stateful consumer, clock-injected, network-free — mirrors `notifications/dm-category.ts`'s role but at service tier since D6-01 frames this as a central service, not a per-listener helper |
| Flush scheduling (RxJS timer keyed on `config.rateLimit.window`) | Service Layer (`services/rate-limit.ts`) | — | Module-level side effect; same shape as `services/nostr.ts`'s `shareAndHold`/`services/logs.ts`'s buffer |
| Grouped summary delivery (bypass) | Service Layer → `services/ntfy.ts#sendNotification` directly | — | D6-06 explicit bypass — never routes back through `rateLimitedNotify` |
| Rate-limit config schema + migration + defaults | Service Layer (`services/config.ts`) | — | Same tier/pattern as existing `AppConfig`/`migrateConfig`/`DEFAULT_MESSAGES_CONFIG` |
| Rate-limit sync (`SyncedPrefs.rateLimit`) | Service Layer (`helpers/preferences.ts`) | — | D6-07; same tier as the existing D2-04 rules-sync subset |
| Per-type/global rate-limit number inputs | HTTP/Page Layer (`pages/{replies,zaps,messages,groups,notifications}.tsx`) | — | Same tier as existing `enabled` checkbox + `WhitelistBlacklist` fields |
| Listener call-site routing (5 `sendNotification`→`rateLimitedNotify` swaps) | Notification Listener Layer (`notifications/{replies,zaps,messages,groups}.ts`) | — | Only the import + call target changes; `shouldNotify`/category gates stay exactly where they are (D6-10) |

## Standard Stack

### Core

No new packages. This phase is implemented entirely with the existing dependency set.

| Library | Version | Purpose | Why Standard (for this phase) |
|---------|---------|---------|-------------------------------|
| `rxjs` | `^7.8.2` `[VERIFIED: package.json:27]` | `timer`/`interval` for the periodic window-flush; `switchMap` off `configValue("rateLimit")` so a live window-duration edit automatically cancels+restarts the timer | Already the project's sole reactive-scheduling dependency; every other module-level periodic/derived-state pattern in the codebase (`shareAndHold`, `config$`, `enabled$`) is built on it — introducing a second scheduling primitive (raw `setInterval`) would be an inconsistency, not a simplification |
| `bun:test` | bundled with Bun (project uses `bun test`, `[VERIFIED: package.json:13]`) | Unit tests for the pure accounting module, config migration, and sync round-trip | Existing test runner (`tests/*.test.ts`, `bunfig.toml`) — no new test framework needed |

### Supporting

None required.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled tumbling-window counter (`services/rate-limit-accounting.ts`) | An npm rate-limiting package (e.g. token-bucket/leaky-bucket libraries) `[ASSUMED]` | General-purpose limiter packages solve *throttle-and-block/queue* semantics (delay or reject a request). None solve this phase's specific requirement: accumulate suppressed items **by type**, then emit **one combined human-readable summary** at window end and bypass the limiter for that summary. That composition is domain-specific to this app's notification UX — hand-rolling ~40 lines of pure counter logic is simpler and more testable than adapting a generic limiter's API to fake this behavior. No package recommendation follows from this; see Package Legitimacy Audit. |
| RxJS `timer`/`interval` for the flush tick | Raw `setInterval`/`setTimeout` | `setInterval` is used nowhere else in the codebase; reacting to a live `config.rateLimit.window` change would require manual `clearInterval`+`setInterval` bookkeeping in an RxJS-free branch. `configValue("rateLimit").pipe(switchMap(cfg => interval(cfg.window * 1000)))` gets automatic cancel-and-restart on window-duration change for free, consistent with every other config-driven observable in `services/nostr.ts` |
| Fixed/tumbling window (counter + periodic reset) | True sliding-window log (ring of timestamps, per-item expiry) | A sliding log has no discrete "window end" event to hang a single combined flush on — CONTEXT.md's D6-04/05 (accumulate → flush once → reset) is tumbling-window shaped, regardless of the "sliding-window" label in D6-02's title. Implementing a ring anyway would still need a bolted-on separate flush timer, so it adds complexity with no behavioral benefit for this phase's exact requirements |

**Installation:** None — no new packages to install.

**Version verification:** `rxjs@7.8.2` already installed and pinned in `package.json`
`[VERIFIED: package.json:27]`; no version bump needed. Confirmed present in `node_modules` implicitly
via existing `bun run lint`/`bun test` passing on the current tree (not independently re-verified
this session — treat as `[ASSUMED]` that no `rxjs` upgrade is required, since the required operators
(`timer`, `interval`, `switchMap`) have been stable RxJS 7.x API since 7.0).

## Package Legitimacy Audit

No external packages are installed by this phase — table intentionally empty.

**Packages removed due to [SLOP] verdict:** none (no packages proposed).
**Packages flagged as suspicious [SUS]:** none (no packages proposed).

## Architecture Patterns

### System Architecture Diagram

```text
┌────────────────────────────────────────────────────────────────────┐
│  notifications/{replies,zaps,messages,groups}.ts                    │
│  (existing: tagged$/giftWraps$ → shouldNotify → category gate)      │
│  5 call sites, unchanged EXCEPT the final call:                     │
│     sendNotification(opts)  →  rateLimitedNotify(type, opts)        │
└───────────────────────────┬──────────────────────────────────────────┘
                            │  rateLimitedNotify("replies"|"zaps"|"messages"|"groups", opts)
                            ▼
┌────────────────────────────────────────────────────────────────────┐
│  services/rate-limit.ts  (impure — module-level state)              │
│                                                                       │
│   state: RateLimitState (from rate-limit-accounting.ts)             │
│                                                                       │
│   rateLimitedNotify(type, opts):                                     │
│     now = Date.now()/1000                                            │
│     { deliver, state: next } = evaluate(state, type, now, config)    │
│     state = next                                                     │
│     if (deliver) return sendNotification(opts)   ───────────────┐   │
│     // else: silently counted into overflow, no notification    │   │
│                                                                    │   │
│   configValue("rateLimit").pipe(switchMap(cfg =>                 │   │
│     interval(cfg.window * 1000)                                  │   │
│   )).subscribe(() => {                                            │   │
│     { summary, nextState } = flushOverflow(state, now)            │   │
│     state = nextState                                             │   │
│     if (summary) sendNotification({ title, message: summary }) ──┼──┐│
│   })                                                               │  ││
└─────────────────────────────────────────────────────────────────┘  ││
                            │ (pure calls only, no I/O)               ││
                            ▼                                          ││
┌────────────────────────────────────────────────────────────────────┐││
│  services/rate-limit-accounting.ts  (pure, clock-injected)         │││
│    evaluate(state, type, now, config) → { deliver, state }         │││
│    flushOverflow(state, now) → { summary, nextState }               │││
│    formatOverflowSummary(overflow) → string | null                 │││
└────────────────────────────────────────────────────────────────────┘││
                                                                        ▼▼
                                                        ┌──────────────────────┐
                                                        │ services/ntfy.ts      │
                                                        │ sendNotification()    │
                                                        │ (services/ntfy.ts:129)│
                                                        └──────────────────────┘
```

### Recommended Project Structure

```
services/
├── rate-limit.ts              # NEW — impure choke point + RxJS flush timer (D6-01)
├── rate-limit-accounting.ts   # NEW — pure evaluate/flushOverflow/formatOverflowSummary (Discretion)
├── config.ts                  # MODIFIED — AppConfig.rateLimit + migrateConfig + defaults (D6-07/09)
notifications/
├── replies.ts                 # MODIFIED — 1 call-site swap (line 102)
├── zaps.ts                    # MODIFIED — 1 call-site swap (line 107)
├── messages.ts                 # MODIFIED — 2 call-site swaps (lines 224, 318), both type "messages"
├── groups.ts                  # MODIFIED — 1 call-site swap (line 143)
helpers/
├── preferences.ts             # MODIFIED — SyncedPrefs.rateLimit + serialize/sanitize/merge (D6-07), PREFS_VERSION → 3
pages/
├── replies.tsx, zaps.tsx, messages.tsx, groups.tsx  # MODIFIED — +1 number input each (D6-08)
├── notifications.tsx          # MODIFIED — +PATCH route (currently GET-only, see Pitfall #7) +global/window inputs
tests/
├── services/rate-limit-accounting.test.ts  # NEW — pure unit, clock-injected (mirrors dm-category.test.ts)
├── services/config.test.ts                 # MODIFIED — +migrateConfig rateLimit cases
├── helpers/preferences.test.ts             # MODIFIED — +serialize/sanitize/merge + old-peer fallback cases
```

### Pattern 1: Drop-in wrapper signature at all 5 call sites

**What:** `rateLimitedNotify(type: NotificationType, options: NtfyNotificationOptions): Promise<void>`
— same `options` object every listener already builds for `sendNotification`; only the function name
+ leading `type` argument changes.
**When to use:** Every one of the 5 existing `sendNotification(...)` calls in the notification
listeners, replaced 1:1.
**Example:**
```typescript
// Source: notifications/replies.ts:102-107 (existing, to be modified)
// BEFORE:
await sendNotification({
  title: `${getDisplayName(profile)} replied to your post`,
  message: event.content,
  icon: getProfilePicture(profile),
  click: buildOpenLink(event),
});

// AFTER (D6-01):
import { rateLimitedNotify } from "../services/rate-limit";
// ...
await rateLimitedNotify("replies", {
  title: `${getDisplayName(profile)} replied to your post`,
  message: event.content,
  icon: getProfilePicture(profile),
  click: buildOpenLink(event),
});
```
Both DM send sites in `notifications/messages.ts` (line 224 NIP-04, line 318 NIP-17) pass the SAME
`"messages"` type per D6-03 — they intentionally share one per-type bucket, not two.

### Pattern 2: Pure, clock-injected accounting unit

**What:** All window math and overflow bookkeeping lives in pure functions that take `now: number`
(unix seconds) as an explicit parameter — never call `Date.now()`/`unixNow()` internally. This
mirrors the "inject a clock" discretion note and the exact shape of the Phase-5 precedent
(`evaluateDmNotificationGates` takes `shouldNotify` as an injected function parameter rather than
importing it).
**When to use:** `services/rate-limit-accounting.ts` — the ONLY file in this phase's new code that
tests should import directly.
**Example:**
```typescript
// Source: new file, services/rate-limit-accounting.ts — pattern mirrors
// notifications/dm-notification-gate.ts's injected-dependency, zero-I/O style
export type NotificationType = "replies" | "zaps" | "messages" | "groups";

export type RateLimitConfig = {
  window: number; // seconds
  global: number; // 0 = unlimited
  perType: Record<NotificationType, number>; // 0 = unlimited per type
};

export type RateLimitState = {
  windowStart: number; // unix seconds, start of current tumbling window
  globalCount: number;
  perTypeCount: Record<NotificationType, number>;
  overflow: Record<NotificationType, number>;
};

export function createRateLimitState(now: number): RateLimitState {
  return {
    windowStart: now,
    globalCount: 0,
    perTypeCount: { replies: 0, zaps: 0, messages: 0, groups: 0 },
    overflow: { replies: 0, zaps: 0, messages: 0, groups: 0 },
  };
}

/** Rolls the window if `now` has crossed `config.window` since `windowStart`,
 *  discarding (NOT flushing) any prior overflow -- callers that need the
 *  discarded overflow surfaced MUST call flushOverflow() before this if a
 *  rollover is imminent (see Pitfall #8 on live config.window edits). */
function rollIfExpired(
  state: RateLimitState,
  now: number,
  windowSeconds: number,
): RateLimitState {
  if (now - state.windowStart < windowSeconds) return state;
  return createRateLimitState(now);
}

export function evaluate(
  state: RateLimitState,
  type: NotificationType,
  now: number,
  config: RateLimitConfig,
): { deliver: boolean; state: RateLimitState } {
  let next = rollIfExpired(state, now, config.window);

  const typeLimit = config.perType[type];
  const underType = typeLimit === 0 || next.perTypeCount[type] < typeLimit;
  const underGlobal = config.global === 0 || next.globalCount < config.global;

  if (underType && underGlobal) {
    next = {
      ...next,
      globalCount: next.globalCount + 1,
      perTypeCount: { ...next.perTypeCount, [type]: next.perTypeCount[type] + 1 },
    };
    return { deliver: true, state: next };
  }

  next = {
    ...next,
    overflow: { ...next.overflow, [type]: next.overflow[type] + 1 },
  };
  return { deliver: false, state: next };
}
```

### Pattern 3: Flush + reset, bypassing the limiter

**What:** A pure `flushOverflow` that formats the combined summary and resets state; the impure
`services/rate-limit.ts` calls `sendNotification` (never `rateLimitedNotify`) with the result.
**When to use:** Called from the RxJS timer tick in `services/rate-limit.ts` (D6-05/06).
**Example:**
```typescript
// Source: new file, services/rate-limit-accounting.ts
const TYPE_LABELS: Record<NotificationType, string> = {
  replies: "new replies",
  zaps: "zaps",
  messages: "messages",
  groups: "group messages",
};

/** Formats "47 replies, 12 group messages" -- only non-zero types, comma-joined.
 *  Returns null (never an empty string) if nothing overflowed, so callers can
 *  gate the sendNotification call on this instead of on ntfy.ts's own
 *  required-message check (services/ntfy.ts:140). */
export function formatOverflowSummary(
  overflow: Record<NotificationType, number>,
): string | null {
  const parts = (Object.keys(overflow) as NotificationType[])
    .filter((t) => overflow[t] > 0)
    .map((t) => `${overflow[t]} ${TYPE_LABELS[t]}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function flushOverflow(
  state: RateLimitState,
  now: number,
): { summary: string | null; nextState: RateLimitState } {
  return {
    summary: formatOverflowSummary(state.overflow),
    nextState: createRateLimitState(now),
  };
}
```
```typescript
// Source: new file, services/rate-limit.ts -- the ONLY caller of sendNotification
// for the grouped summary; deliberately does NOT go through rateLimitedNotify (D6-06).
import { interval, switchMap } from "rxjs";
import { configValue } from "./config";
import { sendNotification } from "./ntfy";
import {
  createRateLimitState,
  evaluate,
  flushOverflow,
  type NotificationType,
} from "./rate-limit-accounting";
import { log } from "./logs";

let state = createRateLimitState(Date.now() / 1000);

export async function rateLimitedNotify(
  type: NotificationType,
  options: Parameters<typeof sendNotification>[0],
) {
  const { rateLimit } = (await import("./config")).getConfig();
  const now = Date.now() / 1000;
  const result = evaluate(state, type, now, rateLimit);
  state = result.state;
  if (result.deliver) return sendNotification(options);
  log("Notification accumulated for grouped overflow summary", { type });
}

configValue("rateLimit")
  .pipe(switchMap((cfg) => interval(cfg.window * 1000)))
  .subscribe(async () => {
    const now = Date.now() / 1000;
    const { summary, nextState } = flushOverflow(state, now);
    state = nextState;
    if (summary)
      // D6-06: direct sendNotification call, bypasses rateLimitedNotify entirely
      await sendNotification({
        title: "Notification summary",
        message: summary,
      });
  });
```

### Anti-Patterns to Avoid

- **Storing the accumulated `NtfyNotificationOptions` (or event content) in `RateLimitState.overflow`:**
  Only ever store an integer count per type. D6-10 requires the grouped summary to be counts only,
  never DM plaintext — the safest way to guarantee this is to make it structurally impossible for
  plaintext to enter the overflow structure in the first place, rather than filtering it out at
  format time.
- **Reading `Date.now()`/`unixNow()` inside `evaluate`/`flushOverflow`:** Breaks clock injection and
  makes the pure unit untestable without real timers — always take `now` as a parameter (Discretion
  note, mirrors the Phase-5 injected-`shouldNotify` precedent).
- **A second, independent module-level `setInterval` per rate-limit type:** D6-05 requires exactly
  ONE combined flush per window across ALL types, not four independent per-type timers that could
  each emit their own summary at slightly different times.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Periodic flush scheduling that must restart cleanly when the configurable window duration changes | Manual `clearInterval`/`setInterval` bookkeeping tied to a config-change listener | `configValue("rateLimit").pipe(switchMap(cfg => interval(cfg.window * 1000)))` | `switchMap` automatically unsubscribes the old interval and starts a new one whenever `rateLimit` config emits a new value — zero manual timer-handle bookkeeping, consistent with every other config-driven observable in `services/nostr.ts` |
| Generic token-bucket/leaky-bucket throttling | A third-party rate-limiter npm package | Hand-rolled `services/rate-limit-accounting.ts` (this phase) | No known package combines per-type + global dual-gating AND accumulate-then-flush-one-combined-summary AND a bypass path for the summary itself — the domain-specific composition is the actual complexity here, not the counting arithmetic; see "Alternatives Considered" |

**Key insight:** The complexity in this phase is entirely in the *product behavior* (accumulate,
combine, bypass, sync, migrate) not in the *counting algorithm* — a generic rate-limiting library
would only replace ~15 lines of `evaluate()` while adding an API-adaptation burden for everything
else this phase needs. Hand-rolling the whole small pure unit is the correct call, consistent with
CONTEXT.md's own Claude's Discretion framing.

## Common Pitfalls

### Pitfall 1: Sliding-window wording vs. tumbling-window behavior
**What goes wrong:** Building a true sliding-window log (per-timestamp ring buffer with individual
expiry) because D6-02 says "sliding-window."
**Why it happens:** The CONTEXT.md decision title uses "sliding-window" terminology, but the actual
required behavior (D6-04/05: accumulate → flush once at window end → reset) is tumbling-window
shaped.
**How to avoid:** Implement a fixed-interval counter + reset (Pattern 2/3 above), not a ring of
timestamps. Confirm with the planner/reviewer that this is an intentional terminology-vs-behavior
reconciliation, not a missed requirement.
**Warning signs:** A design that tracks individual notification timestamps instead of aggregate
counts is over-engineered for this phase's actual requirements.

### Pitfall 2: Module-level state shared across test files
**What goes wrong:** If `services/rate-limit.ts` (the impure, stateful module) is ever imported
directly by a test, its module-level `state` variable persists for the whole `bun test` process
(same failure mode already documented for `services/config.ts`'s top-level `config$` in
`tests/services/config.test.ts:8-15`).
**Why it happens:** Bun shares one module cache across every file in a `bun test` run.
**How to avoid:** Tests must import ONLY `services/rate-limit-accounting.ts` (the pure module) and
construct fresh `RateLimitState` objects per test via `createRateLimitState(now)` — never import
`services/rate-limit.ts` from a test file, exactly like `tests/notifications/dm-category.test.ts`'s
top-of-file note explains for `notifications/dm-category.ts` vs. `notifications/messages.ts`.
**Warning signs:** A test that needs `beforeEach` to "reset" rate-limit state — a sign the pure
module's state isn't being constructed fresh per test.

### Pitfall 3: Grouped summary must never carry DM content
**What goes wrong:** A refactor that "simplifies" the overflow structure by storing the last
`NtfyNotificationOptions` per type (to reuse its `message` field) accidentally lets DM plaintext
(when `messages.sendContent === true`) leak into the flush's combined summary.
**Why it happens:** `notifications/messages.ts:224` and `:318` build `options.message` as either the
real DM content or `"[content omitted]"` depending on `sendContent` — if `rateLimitedNotify` ever
stored that whole `options` object for later reuse rather than a bare integer count, the stored
value could be real plaintext.
**How to avoid:** `RateLimitState.overflow` is (and must remain) `Record<NotificationType, number>`
— structurally incapable of holding message content. Never widen it to store the original
`options`.
**Warning signs:** Any function signature in the rate-limit module that takes `options:
NtfyNotificationOptions` and returns something other than `void`/a boolean deliver decision.

### Pitfall 4: Both DM send sites share one `"messages"` bucket
**What goes wrong:** Treating the NIP-04 (`messages.ts:224`) and NIP-17 (`messages.ts:318`) send
sites as needing separate rate-limit types (e.g. `"messages-nip04"` / `"messages-nip17"`).
**Why it happens:** They are two different code paths/listeners in the same file, which can read
as "two types."
**How to avoid:** D6-03 is explicit: both pass `"messages"`. `NotificationType` has exactly 4
members (`replies | zaps | messages | groups`) — no 5th or 6th type for DM sub-protocols.
**Warning signs:** A `NotificationType` union with more than 4 members.

### Pitfall 5: Migration must be additive, not surprising
**What goes wrong:** An existing user upgrades and suddenly starts missing notifications they used
to get, because the new rate limit's defaults are stricter than their actual notification volume.
**Why it happens:** D6-09 sets anti-spam defaults (5/min per-type, 20/min global) that are
reasonable for a "typical" user but could be lower than an actual power user's legitimate
notification rate.
**How to avoid:** Ship the defaults as specified (this is the explicit, accepted D6-09 decision —
"planning may tune exact numbers" is about the specific integers, not about whether to apply a
limit at all) — but the plan MUST add a CHANGELOG entry describing the new default behavior change,
per D6-09's explicit instruction, and MUST make the `0` = unlimited escape hatch discoverable in the
UI (D6-08's number input should have visible help text: "0 = unlimited").
**Warning signs:** No CHANGELOG entry for this phase; no help text near the number inputs.

### Pitfall 6: Sync fallback for a not-yet-upgraded peer has NO legacy value to seed from
**What goes wrong:** Copying the `asMessagesCategories` old-peer-fallback pattern verbatim — that
pattern works because a legacy `messages.enabled` flag existed to seed the new fields from. Rate
limiting has no legacy predecessor field; a pre-Phase-6 `SyncedPrefs` payload simply has no
`rateLimit` key at all. If the sanitizer falls back to `{global: 0, window: 0, perType: {...: 0}}`
(interpreting "absent" the same way it'd interpret an explicit "disable everything"), an
already-upgraded device would have its rate limiting **silently disabled** the moment it receives a
sync payload from an un-upgraded peer — inverting D6-09's "additive, must not surprise" intent.
**Why it happens:** Superficial pattern-matching to Phase 5's `asMessagesCategories` without
checking whether an equivalent legacy value actually exists for this field.
**How to avoid:** When `raw.rateLimit` is absent from a decrypted payload, `sanitizeSyncedPrefs`
must fall back to this device's own local safe defaults (the same constant `migrateConfig` seeds
new installs with), NOT to `0`/unlimited. Add an explicit regression test mirroring
`tests/helpers/preferences.test.ts`'s old-schema tests, but asserting the OPPOSITE fallback
direction (defaults-on, not defaults-off) from the DM-category precedent.
**Warning signs:** A sanitizer that treats "key absent" and "key present with all zeros" as
equivalent — they must not be, for this field specifically.

### Pitfall 7: `pages/notifications.tsx` has no PATCH route today
**What goes wrong:** Assuming the global rate-limit + window fields can be added the same way a
per-type field is added to `pages/replies.tsx` (which already has a `route = { GET, PATCH }`
object).
**Why it happens:** `pages/notifications.tsx`'s `route` export (`pages/notifications.tsx:436-444`)
currently has ONLY a `GET` handler — it's a read-only overview/dashboard page today, unlike every
per-type config page.
**How to avoid:** This phase must ADD a `PATCH` handler (and the Datastar form markup +
`data-on-click="@patch(location.href)"` button) to `pages/notifications.tsx` for the first time —
budget this as new work, not a copy-paste of an existing PATCH handler on that specific file (the
per-type pages' PATCH handlers, e.g. `pages/replies.tsx:88-141`, are still the right template to
copy from).
**Warning signs:** A plan step that says "update the existing PATCH handler in
`pages/notifications.tsx`" — there isn't one yet.

### Pitfall 8: Live `config.rateLimit.window` edits can silently drop pending overflow
**What goes wrong:** A user edits the window duration mid-window via the UI. The RxJS
`switchMap`-based timer (Pattern 3) tears down the old `interval` subscription and starts a new one
immediately — any overflow accumulated under the OLD window is never flushed (it sits in `state`
until the NEW interval's first tick, which delays the summary by up to the new window's full
duration, or — if `evaluate`'s `rollIfExpired` fires first based on wall-clock time — is silently
discarded by `createRateLimitState` without ever being summarized).
**Why it happens:** `configValue("rateLimit")` emitting a new config value is treated purely as
"restart the timer," with no explicit flush-before-restart step.
**How to avoid:** In the `switchMap`, flush any pending overflow (best-effort, direct
`sendNotification` bypass) before returning the new `interval(...)`, so a live window-duration edit
never discards an in-flight grouped summary. This is a secondary/lower-priority pitfall relative to
#6 — flag it for the planner as a nice-to-have hardening step, not a hard blocker, since D6-09 does
not require preserving overflow across a live-edit boundary.
**Warning signs:** No test exercising "config.rateLimit changes mid-window with pending overflow."

## Code Examples

Verified patterns from this codebase (not third-party docs — no Context7/official-docs lookup was
needed since no new library is introduced):

### Existing sendNotification signature being wrapped
```typescript
// Source: services/ntfy.ts:129-131, :43-74 (NtfyNotificationOptions), :8-14 (NtfyPriority)
export async function sendNotification(
  options: NtfyNotificationOptions,
): Promise<NtfyResponse> {
  // Requires non-empty options.message (services/ntfy.ts:140) -- formatOverflowSummary
  // must never be called with an empty result; it returns `null` instead, and callers
  // must gate the sendNotification call on `summary !== null`.
```

### Existing 5 call sites (unmodified signature, only the call target changes)
```typescript
// Source: notifications/replies.ts:102-107
await sendNotification({ title: ..., message: event.content, icon: ..., click: ... });
// Source: notifications/zaps.ts:107-112
await sendNotification({ title: "Zap Received", message: ..., icon: ..., click: ... });
// Source: notifications/messages.ts:224-229 (NIP-04) and :318-326 (NIP-17)
await sendNotification({ title: ..., message: messages.sendContent ? content : "[content omitted]", icon: ..., click: ... });
// Source: notifications/groups.ts:143-148
await sendNotification({ title: ..., message: message.content, icon: ..., click: ... });
```

### AppConfig / migrateConfig extension pattern to mirror
```typescript
// Source: services/config.ts:71-77 (DEFAULT_MESSAGES_CONFIG precedent to mirror)
export const DEFAULT_RATE_LIMIT_CONFIG: AppConfig["rateLimit"] = {
  window: 60,
  global: 20,
  perType: { replies: 5, zaps: 5, messages: 5, groups: 5 },
};
// migrateConfig should backfill a missing/malformed `rateLimit` key the same defensive way
// migrateConfig backfills `groups.modes` (services/config.ts:219-231): guard null/non-object
// top-level `rateLimit`, then structuredClone(DEFAULT_RATE_LIMIT_CONFIG) if absent/invalid.
```

## State of the Art

Not applicable in the "framework version drift" sense — this is entirely new, hand-rolled
application logic with no external API surface to go stale. The one relevant "current approach"
note: RxJS 7.x's `timer`/`interval`/`switchMap` combination for config-driven periodic scheduling
has been stable since RxJS 7.0 and is already the idiom used elsewhere in this codebase
(`services/nostr.ts`'s `shareAndHold`) — no deprecated API risk.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Default values per-type ≈5/min, global ≈20/min, window=60s are "sensible anti-spam defaults" for a typical single-user Nostr notification volume | Standard Stack, Pitfall #5 | These are D6-09's own stated targets (already user-approved in CONTEXT.md), not independently verified against any usage telemetry for this specific app — if a user's real notification volume is much higher (e.g. a very active group), the additive-migration default could start suppressing notifications the user considers normal. Mitigated by the `0`=unlimited escape hatch and D6-09's explicit CHANGELOG requirement. |
| A2 | No third-party rate-limiting npm package fits this phase's accumulate+flush+bypass requirements well enough to be worth adopting | Don't Hand-Roll, Alternatives Considered | Based on training-data knowledge of common Node rate-limiter packages' typical API shape (token-bucket/queueing), not a fresh package-registry search this session — if a purpose-built "grouped notification digest" package exists, adopting it could reduce this phase's new code, but the composition need (bypass path + per-type+global dual gate + Nostr-specific `NotificationType`) is narrow enough that hand-rolling remains low-risk either way. |
| A3 | `rxjs@^7.8.2`'s `timer`/`interval`/`switchMap` operators require no version bump and behave as expected for this use case | Standard Stack | Not independently re-verified via `npm view`/Context7 this session — based on the already-installed, already-imported-elsewhere version in `package.json:27`. Low risk: these are foundational RxJS 7.x operators unchanged across the entire major version. |

**If this table is empty:** N/A — see above.

## Open Questions

1. **Exact default integers (5/min, 20/min) — final tuning**
   - What we know: D6-09 states "≈5 per minute" per-type and "≈20 per minute" global as targets,
     explicitly leaving exact numbers to planning.
   - What's unclear: Whether "5 per minute" should be interpreted as literally `5` per a `60`-second
     window (the simplest, most literal reading) or some other window/limit combination that
     produces an equivalent effective rate.
   - Recommendation: Use the literal reading — `window: 60, perType: {each: 5}, global: 20` — since
     it's the simplest mapping of D6-09's own words and keeps `window` a single shared value for
     both per-type and global buckets (avoiding a second "per-type window" concept D6-07 doesn't
     ask for).

2. **Whether the grouped-summary notification itself should also count against nothing (verified) or whether it needs its own priority/tag**
   - What we know: D6-06 only specifies it bypasses `rateLimitedNotify`; it says nothing about
     `NtfyPriority` or `tags` for the summary notification.
   - What's unclear: Whether the summary should use `NtfyPriority.Default` (unset, matching the 4
     existing per-event notifications, none of which set `priority` today per the Code Examples
     above) or a distinct priority/tag so users can visually distinguish "digest" notifications from
     individual ones in the ntfy app.
   - Recommendation: Default to matching existing behavior (no explicit priority/tags set, same as
     all 4 existing call sites) — this is a minimal-UI phase (D6-08); a distinct visual treatment
     can be a follow-up if users ask.

## Environment Availability

No new external dependency, service, or CLI tool is introduced by this phase — the existing ntfy
HTTP client and Bun runtime (already required by every prior phase) are sufficient.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (Bun's built-in test runner) `[VERIFIED: package.json:13, bunfig.toml]` |
| Config file | `bunfig.toml` (existing — wires `tests/setup.ts` preload for the CONFIG-isolation fixture) |
| Quick run command | `bun test tests/services/rate-limit-accounting.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D6-02 | Under-limit notification delivers (`deliver: true`, counters increment) | unit | `bun test tests/services/rate-limit-accounting.test.ts -t "under limit"` | ❌ Wave 0 |
| D6-04 | Over-limit notification accumulates into `overflow[type]` instead of delivering | unit | `bun test tests/services/rate-limit-accounting.test.ts -t "accumulates"` | ❌ Wave 0 |
| D6-05 | `flushOverflow` returns the combined summary string and resets `state` to zero counts | unit | `bun test tests/services/rate-limit-accounting.test.ts -t "flush"` | ❌ Wave 0 |
| D6-06 | Grouped summary path calls `sendNotification` directly, never through `rateLimitedNotify` | integration (spy on `sendNotification`) | `bun test tests/services/rate-limit.test.ts -t "bypass"` | ❌ Wave 0 (needs a mock/spy strategy for `services/ntfy.ts#sendNotification` — see note below) |
| D6-09 (0=unlimited) | `perType[type] === 0` or `global === 0` always allows delivery | unit (table test) | `bun test tests/services/rate-limit-accounting.test.ts -t "unlimited"` | ❌ Wave 0 |
| D6-02 (interaction) | Both per-type AND global must be under limit; table test across 4 combinations | unit (table test) | `bun test tests/services/rate-limit-accounting.test.ts -t "interaction"` | ❌ Wave 0 |
| D6-07/09 | `migrateConfig` backfills `rateLimit` with `DEFAULT_RATE_LIMIT_CONFIG` for absent/null/malformed input, idempotent on already-migrated input | unit | `bun test tests/services/config.test.ts -t "rateLimit"` | ❌ Wave 0 |
| D6-07 | `serializePrefs`/`sanitizeSyncedPrefs`/`mergePrefs` round-trip `rateLimit`; old-peer payload (no `rateLimit` key) falls back to safe local defaults, NOT zero/unlimited (Pitfall #6) | unit | `bun test tests/helpers/preferences.test.ts -t "rateLimit"` | ❌ Wave 0 |
| D6-03 | Both DM send sites pass `"messages"` as the type (not two separate types) | unit/manual code check | grep-based check in code review, not a runtime test | N/A |

### Sampling Rate
- **Per task commit:** `bun test tests/services/rate-limit-accounting.test.ts tests/services/config.test.ts tests/helpers/preferences.test.ts`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green before `/gsd-verify-work`, plus `bun run lint` (`tsc --noEmit`,
  the project's only static-analysis gate per `package.json:9-13`).

### Wave 0 Gaps
- [ ] `tests/services/rate-limit-accounting.test.ts` — the pure unit's full test matrix (D6-02/04/05/09)
- [ ] `tests/services/rate-limit.test.ts` — D6-06 bypass assertion; will likely need to mock/spy
  `services/ntfy.ts#sendNotification` (no existing precedent for mocking `sendNotification` in this
  codebase — `services/ntfy.ts` has zero test coverage today per CONCERNS.md's "Entire codebase is
  untested" note being only partially resolved by Phases 3-5's additions). Recommend `bun:test`'s
  `mock.module()` (Bun's built-in module-mocking API) to replace `sendNotification` for this one
  test file, or restructure `rateLimitedNotify`/the flush handler to accept an injectable
  `send: typeof sendNotification` parameter (defaulting to the real one) purely for testability —
  the latter is more consistent with this phase's own "inject a clock" pattern and is the
  recommended approach.
- [ ] `tests/services/config.test.ts` additions for `rateLimit` migration cases
- [ ] `tests/helpers/preferences.test.ts` additions for `rateLimit` sync + old-peer fallback cases
- Framework install: none — `bun:test` already configured.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Out of scope — this phase adds no new route auth surface (existing CONCERNS.md "No authentication on any HTTP route" gap is pre-existing and not this phase's job to fix) |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A |
| V5 Input Validation | yes | New `rateLimit` number inputs (D6-08) and the sync-side `sanitizeSyncedPrefs` extension must validate/coerce untrusted input the same way existing fields do: PATCH handlers must clamp incoming values to non-negative integers (mirror `helpers/preferences.ts`'s `asStringArray`/`asBoolean` coercion helpers — add an `asNonNegativeInt(value: unknown): number` helper for `rateLimit` fields) before merging into `config$`/`AppConfig` |
| V6 Cryptography | no | This phase adds no new crypto surface — the `rateLimit` fields ride inside the EXISTING NIP-44-encrypted kind-30078 sync event (`helpers/preferences.ts`'s established encrypt/decrypt path), no new encryption logic |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A malicious/malformed decrypted `SyncedPrefs.rateLimit` payload (e.g. `perType.replies: "DROP TABLE"` or a negative number) crashing `evaluate()`'s arithmetic or producing an unbounded/negative effective limit | Tampering | `sanitizeSyncedPrefs`'s new `asNonNegativeInt` coercion must reject non-numeric/negative/NaN values the same defensive way `asStringArray`/`asModes` already reject malformed entries (`helpers/preferences.ts:97-118`) — never trust a decrypted peer payload's numeric fields without coercion, per the file's existing ASVS V5 comments |
| A PATCH request to a per-type page or `/notifications` submitting a negative or non-numeric `rateLimit` signal | Tampering | Same `asNonNegativeInt`-style clamp applied server-side in each PATCH handler before merging into `config$.next(...)`, mirroring `pages/replies.tsx:98-112`'s existing whitelist/blacklist sanitization pattern |
| An attacker-controlled peer publishing a kind-30078 event with `rateLimit.global: 999999999` to effectively disable rate limiting via sync (a "sync poisoning" variant of an existing, pre-existing weakness — anyone who compromises the user's own signer/nsec can publish this event; this is not a NEW attack surface introduced by this phase, since the same signer compromise already lets an attacker rewrite whitelists/blacklists via the same sync mechanism) | Tampering | No new mitigation needed beyond what D2-04/08's existing high-water-mark (`isNewerPrefs`) + self-encryption already provide — flagged here for completeness only, not as a new phase-6-specific risk |

## Sources

### Primary (HIGH confidence — read directly from the repository this session)
- `services/ntfy.ts` — `sendNotification`/`NtfyNotificationOptions`/`NtfyPriority` (the wrapped primitive)
- `services/config.ts` — `AppConfig`, `migrateConfig`, `DEFAULT_MESSAGES_CONFIG` (the config+migration pattern to mirror)
- `helpers/preferences.ts` — `SyncedPrefs`, `serializePrefs`/`sanitizeSyncedPrefs`/`mergePrefs`, `PREFS_VERSION`, `asMessagesCategories` (the sync-extension + old-peer-fallback pattern, and where it does NOT directly transfer — Pitfall #6)
- `services/logs.ts` — module-level state precedent
- `notifications/{replies,zaps,messages,groups}.ts` — all 5 `sendNotification` call sites, `shouldNotify` gate placement
- `notifications/dm-notification-gate.ts`, `notifications/dm-category.ts` — extracted-pure-unit + injected-dependency test pattern
- `pages/replies.tsx`, `pages/notifications.tsx` — existing Datastar PATCH-form pattern; and the GET-only gap on `pages/notifications.tsx`
- `tests/notifications/dm-category.test.ts`, `tests/services/config.test.ts`, `tests/helpers/preferences.test.ts` — existing test conventions (network-safe pure-unit imports, migration regression tests, sync round-trip tests) mirrored by this phase's Wave 0 test plan
- `.planning/codebase/ARCHITECTURE.md`, `CONVENTIONS.md`, `CONCERNS.md` — layering conventions, "No rate limiting on outbound notifications" gap this phase closes
- `package.json` — confirmed no new dependency needed (`rxjs@^7.8.2` already present)

### Secondary (MEDIUM confidence)
- `.planning/phases/05-.../05-RESEARCH.md` and `05-CONTEXT.md` — the layered-gate + migrateConfig-extension + extracted-pure-unit precedent this phase explicitly mirrors per its own canonical_refs

### Tertiary (LOW confidence)
- None — no WebSearch/external documentation lookup was performed this session, since this phase introduces no new library or external API surface. All external-facing claims are marked `[ASSUMED]` in the Assumptions Log above rather than presented as verified.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependency, existing `rxjs` version confirmed in `package.json`
- Architecture: HIGH — every pattern cited traces to a specific file:line read this session
- Pitfalls: HIGH for codebase-specific pitfalls (#2, #3, #4, #6, #7 — all derived from direct source reads); MEDIUM for the tuning/default-value pitfall (#5, depends on real-world usage not measurable this session)

**Research date:** 2026-07-10
**Valid until:** 30 days (stable, hand-rolled internal logic with no external dependency to go stale) — re-verify only if `rxjs` major-version-bumps or the notification listener files are substantially refactored before this phase executes.
