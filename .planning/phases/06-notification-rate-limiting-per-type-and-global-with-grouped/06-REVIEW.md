---
phase: 06-notification-rate-limiting-per-type-and-global-with-grouped
reviewed: 2026-07-10T21:28:19Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - services/rate-limit.ts
  - services/rate-limit-accounting.ts
  - notifications/replies.ts
  - notifications/zaps.ts
  - notifications/messages.ts
  - notifications/groups.ts
  - services/config.ts
  - helpers/preferences.ts
  - tests/services/rate-limit.test.ts
  - tests/services/rate-limit-accounting.test.ts
  - pages/notifications.tsx
findings:
  critical: 2
  warning: 4
  info: 1
  total: 7
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-07-10T21:28:19Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

The pure accounting core (`services/rate-limit-accounting.ts`) is solid: the counts-only `RateLimitState`/`overflow` shape structurally cannot carry DM plaintext (D6-10 holds), `evaluate()`'s under-type/under-global/0-unlimited logic is correct at every boundary I traced (including the `<` vs `<=` window-roll boundary, verified against the existing test at exactly `windowStart + window`), and `flushOverflow`/`formatOverflowSummary` are pure and side-effect-free. The 5 call-site swaps in `notifications/{replies,zaps,messages,groups}.ts` are confirmed via diff to be mechanical (`sendNotification` → `rateLimitedNotify(type, ...)`), with `shouldNotify`/category gates/`sendContent`-aware message fields byte-for-byte unchanged. `runFlush` does bypass `rateLimitedNotify` directly (D6-06), confirmed both by reading and by the existing saturated-bucket test. `helpers/preferences.ts`'s sync layer is carefully defensive (`asNonNegativeInt`, absent-key-falls-back-to-local-defaults, round-trip tested).

However, the impure shell in `services/rate-limit.ts` that wires the pure core to a live RxJS timer has two reproduced, unshipped-quality bugs that undermine the core module's correctness guarantees: (1) the config-driven flush timer has no `distinctUntilChanged`, so **any** unrelated `config$` write anywhere in the app resets the flush countdown, and can indefinitely starve the grouped-overflow summary (verified by a standalone repro: 8 unrelated config writes every 400ms against a 1000ms window produced a single flush tick only after the writes stopped); and (2) the newly-added `rateLimit.window` field can be set to `0` through the `/notifications` PATCH route (`min="0"`, and the UI help text explicitly documents `0` as valid/"unlimited" for this field) which turns `interval(cfg.window * 1000)` into `interval(0)` — reproduced at ~930 ticks/second, an unbounded busy loop, not a "disable the limiter" behavior. Both are reachable through ordinary use of the shipped UI, not adversarial input.

## Critical Issues

### CR-01: Flush timer restarts (and can be starved indefinitely) on any unrelated config write

**File:** `services/rate-limit.ts:129-133`
**Issue:** The flush timer is built as:
```ts
configValue("rateLimit")
  .pipe(switchMap((cfg) => interval(cfg.window * 1000)))
  .subscribe(() => { void runFlush(); });
```
`configValue("rateLimit")` is `config$.pipe(map((c) => c.rateLimit))` (services/config.ts:328-332) with no `distinctUntilChanged`. `config$` is a single `BehaviorSubject<AppConfig>` shared by every settings surface in the app (replies/zaps/messages/groups toggles, whitelist/blacklist edits, the `/config` page, and inbound NIP-78 preference sync via `mergePrefs`). **Every** `config$.next()` — even one that never touches `rateLimit` — re-emits through `configValue("rateLimit")`, and `switchMap`'s project function re-runs `interval(cfg.window * 1000)`, unsubscribing the in-flight interval and starting a brand-new one from zero.

I reproduced this directly (rxjs `switchMap`/`interval`, standalone script): with a 1000ms window and unrelated config writes every 400ms, the flush tick that should have fired within ~1s was pushed out repeatedly and only fired ~1.5s after the writes stopped — i.e. under any workload where config is touched more often than the rate-limit window, the grouped-overflow summary (the *only* notification a rate-limited user ever gets for the withheld senders) can be delayed indefinitely, silently dropping visibility into overflowed notifications. This directly violates the stated D6-05 invariant ("fires at most once per window" is preserved, but "fires at least once per window" — the actual guarantee users depend on — is not).

**Fix:** Only restart the interval when `window` actually changes:
```ts
import { distinctUntilChanged, interval, switchMap } from "rxjs";

configValue("rateLimit")
  .pipe(
    map((cfg) => cfg.window),
    distinctUntilChanged(),
    switchMap((window) => interval(window * 1000)),
  )
  .subscribe(() => { void runFlush(); });
```

### CR-02: `rateLimit.window = 0` turns the flush timer into an unbounded busy loop

**File:** `services/rate-limit.ts:130`; UI surface at `pages/notifications.tsx:456-466`, `pages/notifications.tsx:525-532`
**Issue:** The `/notifications` PATCH handler clamps `rateLimitWindow` to `>= 0` only (`Number.isFinite(rawRateLimitWindow) && rawRateLimitWindow >= 0 ? Math.floor(...) : ...`, pages/notifications.tsx:529-532), and the corresponding `<input type="number" min="0">` (pages/notifications.tsx:456-461) plus its help text — "Window duration in seconds shared by the global and per-type limits. **0 = unlimited.**" (pages/notifications.tsx:464-466) — actively tells the user `0` is a valid, meaningful value. But unlike `global`/`perType` (where `0` really does mean "unlimited" per `evaluate()`'s `typeLimit === 0 || ...` check in services/rate-limit-accounting.ts:118-120), `window` has no such branch: `cfg.window * 1000 === 0` is passed straight to rxjs `interval()`, and `rxjs/internal/observable/interval.js` only clamps *negative* periods to 0 — it does not special-case `0` at all, so `timer(0, 0)` fires repeatedly with (effectively) 0ms spacing.

I reproduced this directly against the installed rxjs (`^7.8.2`): `interval(0)` produced ~186 ticks in 200ms (~930/sec) and would continue indefinitely while subscribed. Every tick calls `runFlush()`, which does real work (reads/writes module state, and calls `sendNotification` whenever overflow is non-empty) — this is a user-reachable, UI-documented resource-exhaustion bug, not a hardening nice-to-have. (The pure accounting layer has its own, silent, secondary failure mode for `window = 0`: `rollIfExpired`'s `now - state.windowStart < windowSeconds` is `now - windowStart < 0`, which is false on essentially every call, so `evaluate()` resets to a fresh all-zero window on almost every invocation — silently defeating rate limiting rather than the "unlimited" semantics the UI promises.)

**Fix:** Enforce a minimum of `1` for `window` everywhere it's accepted from outside the accounting core — the PATCH handler (`Math.max(1, Math.floor(rawRateLimitWindow))` when finite/`>=0`, falling back to current value otherwise) and `migrateConfig`'s rateLimit backfill (see WR-03) — and remove/correct the "0 = unlimited" wording for the `window` field specifically (it does not apply to `window`, only to `global`/`perType`).

## Warnings

### WR-01: `runFlush()`'s real-timer invocation has no error handling

**File:** `services/rate-limit.ts:131-133`
**Issue:** `.subscribe(() => { void runFlush(); })` discards the returned promise with `void`, but never attaches a `.catch`. If the injected/default `send` (`sendNotification`) throws — no ntfy server/topic configured, or a network error (both realistic: `services/ntfy.ts:138-141` throws `NtfyServiceError` for exactly these cases) — the rejection is unhandled, and it recurs on every window tick for as long as the condition persists, unlike a one-off unhandled rejection from a single notification event.
**Fix:**
```ts
.subscribe(() => {
  runFlush().catch((error) =>
    log("Failed to deliver grouped overflow summary", {
      error: error instanceof Error ? error.message : String(error),
    }),
  );
});
```

### WR-02: No upper bound on `rateLimit.window` — large values can overflow the 32-bit timer delay

**File:** `pages/notifications.tsx:456-461`, `pages/notifications.tsx:529-532`; `services/rate-limit.ts:130`
**Issue:** Neither the `<input type="number">` (no `max`) nor the PATCH handler's validation impose an upper bound on `window`. `setTimeout`/`setInterval` (which rxjs's `asyncScheduler` uses under the hood) silently overflows a 32-bit signed delay (~24.8 days, 2147483647ms) — values above that are historically coerced/fire near-immediately in Node/Bun, which would recreate the same class of busy loop as CR-02 via a differently-shaped but equally UI-reachable input (e.g. a fat-fingered extra zero).
**Fix:** Clamp `window` to a sane range, e.g. `[1, 86400]` (1 second to 1 day), in the PATCH handler.

### WR-03: `migrateConfig`'s rateLimit backfill doesn't validate finiteness or non-negativity, unlike every other rateLimit input surface

**File:** `services/config.ts:280-303`
**Issue:** The backfill for a hand-edited/legacy `config.json` only checks `typeof parsed.rateLimit.window !== "number"` (and the equivalent for `global`/`perType[key]`) before falling back to the default. This misses two cases that `typeof` accepts as `"number"`:
- `NaN` (`typeof NaN === "number"`) passes through untouched — `NaN * 1000` reaches `interval()` as `NaN`, which is not clamped by rxjs's `if (period < 0) period = 0` guard, again risking the CR-02 busy-loop class of bug.
- Negative numbers pass through untouched — a negative `window` degrades to the same `interval()`-clamped-to-0 busy loop as CR-02 (rxjs's `interval` treats negative periods as `0`), and a negative `global`/`perType[key]` makes `rolled.globalCount < config.global` (services/rate-limit-accounting.ts:120) permanently false for any non-negative count, silently sealing that gate shut forever (the opposite failure mode from "unlimited").

This is inconsistent with the two other rateLimit input surfaces in this same phase, both of which explicitly guard finiteness and sign: `helpers/preferences.ts`'s `asNonNegativeInt` (`typeof value !== "number" || !Number.isFinite(value) || value < 0`) and the PATCH route's `Number.isFinite(...) && ... >= 0` check.
**Fix:** Reuse the same guard shape used elsewhere, e.g.:
```ts
const isValidNonNegativeNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

if (!isValidNonNegativeNumber(parsed.rateLimit.window))
  parsed.rateLimit.window = DEFAULT_RATE_LIMIT_CONFIG.window;
if (!isValidNonNegativeNumber(parsed.rateLimit.global))
  parsed.rateLimit.global = DEFAULT_RATE_LIMIT_CONFIG.global;
// ...and the same for each parsed.rateLimit.perType[key]
```

### WR-04: No regression test coverage for `window = 0` / degenerate window values

**File:** `tests/services/rate-limit.test.ts`, `tests/services/rate-limit-accounting.test.ts`
**Issue:** Both test files exhaustively cover the `global`/`perType` "`0` = unlimited" semantics (`evaluate -- 0 = unlimited (D6-09)` in tests/services/rate-limit-accounting.test.ts:142-173) but there is no case anywhere for `window = 0` (or `NaN`/negative `window`) at either the pure-accounting layer or the impure timer layer. This is exactly the gap that let CR-01/CR-02 ship — a test asserting `interval(cfg.window * 1000)` is never constructed with `window <= 0`, or that `rollIfExpired` doesn't degenerate to "always roll" at `window = 0`, would have caught this before review.
**Fix:** Add a test that resets the window every ~1 call when `window = 0` is documented as invalid/rejected (once WR-03/CR-02 are fixed), or add an explicit accounting-layer test asserting the intended behavior for `window <= 0` if it's meant to be tolerated at that layer.

## Info

### IN-01: `resetRateLimitState` is an unguarded production export

**File:** `services/rate-limit.ts:57-59`
**Issue:** `resetRateLimitState` is exported unconditionally from `services/rate-limit.ts` — the same module production code imports (`notifications/*.ts` import `rateLimitedNotify` from it) — purely so `tests/services/rate-limit.test.ts` can reset the module-level singleton between cases. Nothing prevents any other production module from importing and calling it to silently wipe rate-limiting/overflow state (e.g. as a bypass, whether by accident via an unrelated future import or intentionally).
**Fix:** Not blocking given this is a single-user local app with no plugin/extension surface, but consider gating it (e.g. only exporting from a `*.test-utils.ts` sibling, or a `if (Bun.env.NODE_ENV === "test")` guard) to keep the test-only contract enforced by more than a comment.

---

_Reviewed: 2026-07-10T21:28:19Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
