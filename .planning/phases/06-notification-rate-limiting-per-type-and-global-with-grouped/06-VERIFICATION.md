---
phase: 06-notification-rate-limiting-per-type-and-global-with-grouped
verified: 2026-07-10T22:30:00Z
status: human_needed
score: 8/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Visit /replies, /zaps, /messages, /groups in a running instance: each shows a rate-limit number input with '0 = unlimited' help text. Set /replies to 3, Save (saved indicator appears), reload -> value persists as 3. Change one page's value and confirm the other three pages/fields are unchanged. Set a per-type limit to 0 and confirm it saves (unlimited escape hatch)."
    expected: "Inputs render, save via PATCH, persist across reload, and sibling limits (global/window/other three per-type values) are preserved on each save."
    why_human: "Requires the running Bun/Datastar web UI and a browser to observe render + PATCH round-trip + reload persistence; no route-level HTTP test harness exists in this repo (per 06-04-SUMMARY.md D1/D2, human_judgment: true)."
  - test: "Visit /notifications: the global-limit input and the window input render with help text ('0 = unlimited' / seconds bounds); Save shows the saved indicator; reload -> both values persist. Confirm the existing /notifications dashboard/overview content still renders (the new first-ever PATCH route did not break the GET view)."
    expected: "Global + window inputs save and persist; pre-existing GET view content is unaffected by the newly added PATCH handler."
    why_human: "pages/notifications.tsx gained its first-ever PATCH route in this phase; confirming it doesn't regress the GET view and that the Datastar save/reload round-trip works requires a browser session (06-04-SUMMARY.md D2, human_judgment: true)."
  - test: "Generate a burst of qualifying real events (e.g. many mentions/replies and group messages within one 60s window) over live relays with a live signer connected, exceeding the configured per-type/global limits. Confirm per-item notifications stop once each limit is hit, and exactly one combined grouped summary (e.g. 'N new replies, M group messages') arrives at ntfy at window end, with counters then reset for the next window."
    expected: "Individual over-limit notifications are suppressed (not delivered) while accumulating; exactly one grouped, counts-only summary notification is delivered at the window boundary; subsequent windows behave the same way (reset)."
    why_human: "Requires a live signer + real relay traffic to produce a genuine burst; the window/flush/accumulate/reset logic itself is already unit-tested end-to-end with an injected clock (tests/services/rate-limit.test.ts, tests/services/rate-limit-accounting.test.ts) — this item is the live, real-time confirmation per 06-VALIDATION.md's Manual-Only classification."
---

# Phase 6: Notification rate limiting per type and global with grouped overflow Verification Report

**Phase Goal:** Rate-limit outbound notifications — per-type AND global — with a single grouped-overflow summary ("47 new mentions, 12 group messages") when limits are hit, instead of delivering each individually.
**Verified:** 2026-07-10T22:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `rateLimitedNotify(type, options)` (D6-01) is the single choke point; all 5 `sendNotification` call sites swapped, both DM sites → `'messages'` (D6-03) | ✓ VERIFIED | `services/rate-limit.ts:101-122` exports `rateLimitedNotify`, delivers via injected/real `sendNotification` only when `evaluate().deliver===true`. `grep` confirms all 5 sites: `notifications/replies.ts:102 → rateLimitedNotify("replies", …)`, `zaps.ts:107 → "zaps"`, `messages.ts:224` (NIP-04) and `:318` (NIP-17) both → `"messages"`, `groups.ts:143 → "groups"`. No `sendNotification` import remains in the 4 listener files (replaced by `rateLimitedNotify` import). |
| 2 | Tumbling-window accounting (D6-02/D6-04/D6-05): under-limit delivers, over-limit accumulates, ONE combined grouped summary per window, reset; window clamped to a safe floor so `window:0` can't disable limiting or busy-loop | ✓ VERIFIED | `services/rate-limit-accounting.ts` `evaluate()` delivers iff both per-type and global gates are under limit, else increments `overflow[type]` (never drops); `rollIfExpired`/`createRateLimitState` implement the tumbling reset; `flushOverflow` returns one `formatOverflowSummary` string (or `null`) plus a fresh zero state. `clampWindowSeconds`/`MIN_WINDOW_SECONDS=1`/`MAX_WINDOW_SECONDS=86400` are exported from this zero-dependency module and applied at every input surface: `services/config.ts#migrateConfig` (line 314, on disk-config load), `helpers/preferences.ts#asRateLimit` (line 228, on kind-30078 sync), `services/rate-limit.ts#rateLimitedNotify` (line 112, defensive re-clamp) and the flush timer's `switchMap`/`distinctUntilChanged` key (lines 163-167), and `pages/notifications.tsx`'s PATCH handler (lines 536-543). 18 tests in `tests/services/rate-limit-accounting.test.ts` + dedicated CR-01-iteration-2 regression tests in `tests/services/rate-limit.test.ts`, `tests/services/config.test.ts`, and `tests/helpers/preferences.test.ts` each drive 10 sequential `evaluate()`/`rateLimitedNotify()` calls at `window:0` and assert `delivered===1` (not 10), proving the clamp holds end-to-end, not just at the function level. |
| 3 | Grouped summary flush bypasses the limiter (D6-06) — delivered via `sendNotification` directly | ✓ VERIFIED | `services/rate-limit.ts#runFlush` (lines 138-149) calls `effectiveSend` (defaults to real `sendNotification`) directly, never `rateLimitedNotify`; the flush RxJS subscription (lines 163-175) calls `runFlush` only. Test `runFlush -- bypasses rateLimitedNotify entirely (D6-06)` proves the summary still fires while the per-type bucket remains saturated. |
| 4 | Grouped summary is COUNTS ONLY, never DM plaintext (D6-10); rate limiter is the LAST gate — `shouldNotify` + Phase-5 category gate + `sendContent` field unchanged | ✓ VERIFIED | `RateLimitState.overflow`/`formatOverflowSummary` are structurally `Record<NotificationType, number>` + static `TYPE_LABELS` — no code path can inject message content. In `notifications/messages.ts`, the `shouldNotify`/category gate (`evaluateDmNotificationGates`) and the line `message: messages.sendContent ? content : "[content omitted]"` are unchanged; the rate-limit swap only replaced the final call target + leading type argument, confirmed by reading both NIP-04 (:224) and NIP-17 (:318) send sites and by `06-REVIEW.md`'s explicit re-verification of this invariant. |
| 5 | Configurable `rateLimit` (global + per-type + window), migration, kind-30078 sync with absent-key fallback to LOCAL defaults (never 0/unlimited), `PREFS_VERSION` bump (D6-07) | ✓ VERIFIED | `services/config.ts`: `AppConfig.rateLimit` field, `DEFAULT_RATE_LIMIT_CONFIG` exported and seeds `config$`; `migrateConfig` backfills absent/null/malformed/partial `rateLimit` defensively and idempotently, preserving explicit `0`. `helpers/preferences.ts`: `PREFS_VERSION = 3` (bumped from 2); `SyncedPrefs.rateLimit`; `serializePrefs` emits it field-by-field; `asNonNegativeInt` coerces untrusted numbers; `asRateLimit` falls back to `structuredClone(DEFAULT_RATE_LIMIT_CONFIG)` — confirmed NOT `{global:0,...}` — when the inbound payload has no `rateLimit` key. Regression tests in both test files assert this exact fallback direction. |
| 6 | Per-type limit fields on the 4 type pages + global/window on `/notifications` (first-ever PATCH route there) (D6-08) | ✓ VERIFIED (code-level) | `pages/replies.tsx`, `zaps.tsx`, `messages.tsx`, `groups.tsx` each have a `type="number"` input bound to a `rateLimitPerType` signal, "0 = unlimited" help text, and a PATCH-side clamp + sibling-preserving merge into `rateLimit.perType.<type>`. `pages/notifications.tsx` gained its first `PATCH:` route key (line 514) plus `rateLimitGlobal`/`rateLimitWindow` inputs (clamped into `[MIN_WINDOW_SECONDS, MAX_WINDOW_SECONDS]`) merging at the `rateLimit` top level while spreading `currentConfig.rateLimit`. Live render/save/reload behavior needs a browser session — see Human Verification below. |
| 7 | Anti-spam defaults present: per-type ≈5/min, global ≈20/min, window=60s; 0=unlimited for counts only (D6-09) | ✓ VERIFIED | `DEFAULT_RATE_LIMIT_CONFIG = { window: 60, global: 20, perType: { replies: 5, zaps: 5, messages: 5, groups: 5 } }` in `services/config.ts`; CHANGELOG.md documents the new default and the 0=unlimited escape hatch. |
| 8 | `bun test` and `bun run lint` green | ✓ VERIFIED | `bun test`: 154 pass / 0 fail across 12 files (run directly during this verification). `bun run lint` (`tsc --noEmit`): 0 errors (run directly during this verification). |

**Score:** 8/8 truths verified (0 present-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `services/rate-limit-accounting.ts` | Pure, clock-injected tumbling-window core: `NotificationType`, `RateLimitConfig`, `RateLimitState`, `createRateLimitState`, `evaluate`, `flushOverflow`, `formatOverflowSummary`, `clampWindowSeconds`/`MIN_WINDOW_SECONDS`/`MAX_WINDOW_SECONDS` | ✓ VERIFIED | Zero imports (confirmed by reading full file); all functions take `now`/`config` explicitly; overflow is `Record<NotificationType, number>`. |
| `services/rate-limit.ts` | Impure choke point (`rateLimitedNotify`) + config-driven flush timer that bypasses the limiter | ✓ VERIFIED | Imports `evaluate`/`flushOverflow`/`clampWindowSeconds` from the accounting module and `configValue`/`getConfig` from `services/config.ts`; module-level `state` reassigned immutably; flush timer keyed on `clampWindowSeconds(cfg.window)` with `distinctUntilChanged`. |
| `services/config.ts` | `AppConfig.rateLimit` + `DEFAULT_RATE_LIMIT_CONFIG` + `migrateConfig` backfill | ✓ VERIFIED | Confirmed field, constant, config$ seed, and migration backfill block (lines 277-332) including the CR-01 window clamp. |
| `helpers/preferences.ts` | `SyncedPrefs.rateLimit` + `PREFS_VERSION=3` + `asNonNegativeInt` + absent-key fallback | ✓ VERIFIED | All present; `asRateLimit` fallback confirmed to be `structuredClone(DEFAULT_RATE_LIMIT_CONFIG)`, never zeros. |
| `notifications/{replies,zaps,messages,groups}.ts` | 5 call sites swapped to `rateLimitedNotify` with coarse types | ✓ VERIFIED | grep-confirmed exact call sites and types; `shouldNotify`/category gates and `sendContent` line unchanged in `messages.ts`. |
| `pages/{replies,zaps,messages,groups,notifications}.tsx` | Per-type + global/window UI, notifications.tsx's first PATCH | ✓ VERIFIED (code-level) | grep-confirmed inputs, help text, PATCH clamp/merge logic on all 5 pages. Live UI behavior is a human-verification item. |
| `tests/services/rate-limit-accounting.test.ts` | Full clock-injected behavior matrix | ✓ VERIFIED | 18 tests; part of the 154-pass full suite. |
| `tests/services/rate-limit.test.ts` | Bypass/accumulate/flush test via injected send+clock | ✓ VERIFIED | 13 tests including the CR-01 window:0 defensive-clamp regression. |
| `tests/services/config.test.ts` / `tests/helpers/preferences.test.ts` | Migration + sync round-trip regression, incl. CR-01 window clamp | ✓ VERIFIED | 31 / 25 tests respectively; both include explicit window:0 clamp + 1-of-10-delivered proofs. |
| `CHANGELOG.md` | Unreleased entry documenting the new defaults + 0=unlimited | ✓ VERIFIED | Entry present under `## Unreleased` (lines 7-8). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `notifications/*.ts` | `services/rate-limit.ts` | `rateLimitedNotify(type, options)` | ✓ WIRED | 5 call sites confirmed; imports swapped, `sendNotification` import removed. |
| `services/rate-limit.ts` | `services/rate-limit-accounting.ts` | `evaluate`/`flushOverflow`/`clampWindowSeconds` | ✓ WIRED | Confirmed imports and call sites; `AppConfig.rateLimit` structurally matches `RateLimitConfig` (tsc-enforced, `bun run lint` clean). |
| `services/rate-limit.ts` flush timer | `services/ntfy.ts` (`sendNotification`) | direct call, bypassing `rateLimitedNotify` (D6-06) | ✓ WIRED | `runFlush` calls `effectiveSend` directly; proven by test. |
| kind-30078 sync payload | `services/config.ts`/`config$` | `helpers/preferences.ts#sanitizeSyncedPrefs → mergePrefs` | ✓ WIRED | Confirmed `asRateLimit` is invoked inside `sanitizeSyncedPrefs`, and `services/preferences.ts` calls `sanitizeSyncedPrefs` before `mergePrefs` (per 06-REVIEW.md's traced entry-point audit, re-confirmed by reading the coercion chain in `helpers/preferences.ts`). |
| `pages/{replies,zaps,messages,groups,notifications}.tsx` PATCH | `config$.next(...)` | sibling-preserving merge | ✓ WIRED | Confirmed spread of `currentConfig.rateLimit` (and `.perType`) on all 5 pages before `config$.next`. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite (includes window-clamp CR-01 regression, deliver/accumulate/flush matrix) | `bun test` | 154 pass / 0 fail, 380 expect() calls, 12 files | ✓ PASS |
| Whole-project typecheck (confirms `AppConfig.rateLimit` ≡ `RateLimitConfig` at the `evaluate()` call site, no unused imports) | `bun run lint` | 0 errors | ✓ PASS |
| Live burst → single grouped summary at window end | N/A (requires live signer + relays) | — | ? SKIP → human verification |
| 5-page UI render/save/reload | N/A (requires running web UI) | — | ? SKIP → human verification |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| D6-01 | 03 | Central choke-point service, single decision point | ✓ SATISFIED | `rateLimitedNotify` in `services/rate-limit.ts`. |
| D6-02 | 01, 03 | Sliding/tumbling window per-type + global | ✓ SATISFIED | `evaluate`/`rollIfExpired` tumbling reconciliation, reasoned in file JSDoc and RESEARCH. |
| D6-03 | 01, 03 | 4 coarse types, both DM sites share "messages" | ✓ SATISFIED | `NotificationType` union; grep-confirmed both DM sites. |
| D6-04 | 01, 03 | Accumulate, don't drop | ✓ SATISFIED | `overflow[type]++` on non-deliver path. |
| D6-05 | 01, 03 | One combined summary at window end, reset | ✓ SATISFIED | `flushOverflow`/`runFlush`. |
| D6-06 | 03 | Grouped summary bypasses the limiter | ✓ SATISFIED | `runFlush` calls `sendNotification` directly. |
| D6-07 | 02 | Configurable, synced via kind-30078 | ✓ SATISFIED | `AppConfig.rateLimit`, `SyncedPrefs.rateLimit`, `PREFS_VERSION=3`. |
| D6-08 | 04 | Minimal UI on 4 type pages + notifications.tsx | ✓ SATISFIED (code); human render/save/reload check pending | Code present on all 5 pages; live behavior is a human-verification item. |
| D6-09 | 02 | Sensible defaults, 0=unlimited | ✓ SATISFIED | `DEFAULT_RATE_LIMIT_CONFIG` literal + CHANGELOG note. |
| D6-10 | 01, 03 | Last gate, tight scope, counts-only | ✓ SATISFIED | Type-level guarantee + unchanged gates/sendContent, confirmed by direct code read. |

No orphaned requirements found — all D6-01 through D6-10 are claimed by a plan's `requirements:` frontmatter and covered above.

### Anti-Patterns Found

None. Scanned all files modified across the 4 plans (`services/rate-limit-accounting.ts`, `services/rate-limit.ts`, `services/config.ts`, `helpers/preferences.ts`, all 4 `notifications/*.ts` listener files, all 5 `pages/*.tsx`, and the 4 relevant test files) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/empty-implementation patterns — no matches.

### Human Verification Required

See frontmatter `human_verification` for full detail. Summary:

1. **Per-type UI render/save/reload/sibling-preservation** across `/replies`, `/zaps`, `/messages`, `/groups` — requires a running web UI + browser (planner-flagged `human_judgment: true` in 06-04-SUMMARY.md).
2. **`/notifications` global/window UI + first-ever PATCH route** — requires a running web UI + browser; also confirms the pre-existing GET/dashboard view is unaffected.
3. **Live burst → single grouped summary** — requires a live signer + real relay event burst to observe the deliver-then-suppress-then-summarize behavior in production conditions (the window/accounting/flush logic itself is already fully unit-tested with an injected clock, per 06-VALIDATION.md's Manual-Only classification).

### Gaps Summary

No gaps found. All automated must-haves (accounting core, choke point, call-site swaps, config/migration/sync, defaults, UI code, window-clamp hardening from the CR-01 code-review fix) are verified directly against the live codebase, and the full `bun test` (154/154) + `bun run lint` (0 errors) are green. The only outstanding items are the three human-verification checks above, which require a running signer/relay/browser environment that is out of scope for static/automated verification — these are UAT items, not defects.

---

_Verified: 2026-07-10T22:30:00Z_
_Verifier: Claude (gsd-verifier)_
