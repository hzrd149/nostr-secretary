---
phase: 07-default-rate-limit-for-chat-groups-and-dms-on-join
verified: 2026-07-13T22:04:33Z
status: human_needed
score: 9/9 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 7: Default rate limit for chat groups and DMs on join Verification Report

**Phase Goal:** Set a sensible default notification rate limit for NIP-29 groups, DMs, and other
chat-type contexts where messages arrive in quick succession. When a user joins a new group or a
new DM conversation is created, the default rate limit should be applied automatically so the user
is not spammed during initial activity bursts.

**Verified:** 2026-07-13T22:04:33Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (by D7 requirement ID — 07-CONTEXT.md is the source of truth; no formal REQUIREMENTS.md)

| # | Truth (D7-ID) | Status | Evidence |
|---|------|--------|----------|
| 1 | D7-01: Per-context bucket exists for NIP-29 groups AND DM conversations only; replies/zaps stay per-type+global only; both DM transports (NIP-04/NIP-17) key by the same counterparty | ✓ VERIFIED | `notifications/groups.ts:153` passes `{ context: encodeGroupPointer(group) }`; `notifications/messages.ts` passes `{ context: sender }` at both the NIP-04 site (`:235`) and NIP-17 site (`:339`, `sender = rumor.pubkey`); `grep -L 'context:' notifications/replies.ts notifications/zaps.ts` confirms zero matches (unchanged). Unit test `DM counterparty sharing (D7-01, Pitfall 4)` in `tests/services/rate-limit-accounting.test.ts:338` proves one shared `messages:<pubkey>` bucket. |
| 2 | D7-02: "Default on join" applied at RUNTIME — no persisted per-context config, no literal join-event hook; a context's bucket is lazily created the first time a notification for it is evaluated | ✓ VERIFIED | `services/rate-limit-accounting.ts:159-163` (`RateLimitState.contexts` seeded `{}` by `createRateLimitState`, populated lazily inside `evaluate()`); `RateLimitConfig` gained no per-context persistence field — only two scalar defaults (`perGroup`/`perDm`) on `AppConfig.rateLimit`. Test `per-context lazy-create (D7-02)` (`rate-limit-accounting.test.ts:200`) confirms a brand-new key reads 0 pre-evaluate and is set to 1 on first delivery. Whole `contexts` map resets to `{}` on the same window tumble as the rest of state (test `per-context window-prune (D7-02)`, `:272`) — no independent TTL/LRU/timer code added (grep for eviction/setTimeout-style pruning in the file finds none). |
| 3 | D7-03: Group context key = `encodeGroupPointer(group)`; DM context key = counterparty pubkey (NIP-04 `sender` / NIP-17 `rumor.pubkey`); threaded as an optional `context` argument through `rateLimitedNotify` into accounting | ✓ VERIFIED | `services/rate-limit.ts:83-87` (`InjectedDeps.context?: string`), `:116-125` (`evaluate(..., context)` — 5th arg); `services/rate-limit-accounting.ts:184-189` (`evaluate`'s 5th optional param). Call sites verified in truth #1. |
| 4 | D7-04: Delivery requires under per-context AND per-type AND global (most-restrictive-wins); a rejection at any gate routes to grouped-overflow | ✓ VERIFIED | `services/rate-limit-accounting.ts:202` (`if (underType && underGlobal && underContext)`), all three gates read from ONE `rollIfExpired` call (`:191`, only one call site, confirmed by `grep -c 'rollIfExpired'` = 2, i.e. 1 definition + 1 call). 4-case layering table test (`most-restrictive-wins layering table (D7-04)`, `:234`) covers context-over/type-over/global-over combinations. |
| 5 | D7-05: Default per-group and default per-DM limits added to `AppConfig.rateLimit` and synced via kind-30078 (`SyncedPrefs`, serialize/sanitize, local-default fallback), `PREFS_VERSION` bumped | ✓ VERIFIED | `services/config.ts:85,88,131-132` (`AppConfig.rateLimit.perGroup/.perDm`, `DEFAULT_RATE_LIMIT_CONFIG.perGroup=3/.perDm=5`), `:353-356` (migration backfill, reuses `isValidNonNegativeNumber`, preserves explicit 0). `helpers/preferences.ts:43` (`PREFS_VERSION = 4`), `:81,83` (`SyncedPrefs.rateLimit.perGroup/.perDm`), `:132-133` (`serializePrefs` field-by-field), `:269-273` (`asRateLimit` per-field `asNonNegativeInt` coercion — no wholesale spread, confirmed by `grep -c '\.\.\.source\|\.\.\.raw.rateLimit'` = 0 inside `asRateLimit`). Old-peer-falls-back-to-local-defaults-not-0 test passes (`preferences.test.ts:459`). |
| 6 | D7-06: Sensible chat defaults — per-group ≈ 3/window, per-DM ≈ 5/window, shared Phase-6 window; 0 = unlimited | ✓ VERIFIED | `services/config.ts:131-132` (`perGroup: 3, perDm: 5`); `contextLimitFor`+`underContext` (`rate-limit-accounting.ts:159-163,200`) treat 0 as always-under (unlimited), covered by `0 = unlimited for perGroup/perDm (D7-06)` test (`:312`). No new clamp constant introduced (`grep -c 'clampWindowSeconds\|MIN_PER\|MAX_PER' services/config.ts` shows no new per-context clamp). |
| 7 | D7-07: Per-context overflow rolls into the existing per-type overflow only — no per-context detail in the grouped summary | ✓ VERIFIED | `services/rate-limit-accounting.ts:217-221` (rejection increments `overflow[type]` only; `contexts` untouched); `RateLimitState` has no per-context overflow substructure (only `overflow: Record<NotificationType, number>` and `contexts: Record<string, number>` for delivered counts). `formatOverflowSummary`/`flushOverflow` are byte-unchanged (no diff in git log beyond Plan 01's docstring-only touch — confirmed via `git log` showing no unrelated commits to those functions this phase). Test `per-context overflow-rollup into per-type overflow only (D7-07)` (`:289`) passes. |
| 8 | D7-08: A default-per-group field on `/groups` and a default-per-DM field on `/messages`, extending each existing PATCH form + Datastar signal, clamped non-negative int, sibling-preserving | ✓ VERIFIED | `pages/groups.tsx:266-269` (`id/data-bind="rateLimitPerGroup"`, bound to `currentConfig.rateLimit.perGroup`), `:322,370-373` (clamp), `:385-392` (top-level merge, `perType.groups` preserved). `pages/messages.tsx:139-142,196,225-228,239-246` — identical pattern for `rateLimitPerDm`/`perDm`. `grep -c 'rateLimitPerType'` unchanged at 6 on both pages (existing field untouched, new field is distinctly named — no signal collision). |
| 9 | D7-09: Tight scope — reuses `services/rate-limit.ts` + `services/rate-limit-accounting.ts`, grouped-overflow, config/sync; does not change Phase-6 per-type/global behavior for existing (context-less) callers; flush-timer pipeline untouched | ✓ VERIFIED | `evaluate()` with no context argument is byte-identical to pre-Phase-7 (test `no-context regression parity (D7-01/09)`, `rate-limit-accounting.test.ts:358`). Flush-timer subscription block (`services/rate-limit.ts:175-187`) has zero diff this phase (`distinctUntilChanged` still gates only on `clampWindowSeconds(cfg.window)`); test `flush-timer no-restart on perGroup/perDm-only write (D7-09)` (`rate-limit.test.ts:318`) passes. No replies.ts/zaps.ts changes. |

**Score:** 9/9 D7 requirement truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `services/rate-limit-accounting.ts` | `contexts` map, `perGroup`/`perDm` config, `underContext` gate, `contextLimitFor` helper | ✓ VERIFIED | All present, wired, single-roll discipline preserved (line 191), pure/clock-injected (no `Date.now()`/imports of impure modules). |
| `tests/services/rate-limit-accounting.test.ts` | 7-scenario per-context test matrix | ✓ VERIFIED | 8 new `describe` blocks (lazy-create, isolation, layering×4, prune, overflow-rollup, 0=unlimited×2, DM-sharing, no-context-parity) — 30/30 cases in this file pass. |
| `services/config.ts` | `AppConfig.rateLimit.perGroup/.perDm`, defaults, migration | ✓ VERIFIED | Lines 85,88,131-132,353-356. |
| `helpers/preferences.ts` | `SyncedPrefs.rateLimit.perGroup/.perDm`, serialize/sanitize, `PREFS_VERSION=4` | ✓ VERIFIED | Lines 43,81,83,132-133,269-273; no wholesale spread. |
| `tests/services/config.test.ts` | Fresh-config defaults, backfill, coercion, explicit-0-preserved, idempotency | ✓ VERIFIED | Cases present at lines 221-330 (grep confirms `perGroup: 0`/`perDm: 0` preservation test). |
| `tests/helpers/preferences.test.ts` | Serialize/round-trip/old-peer-fallback/malformed-coercion/PREFS_VERSION | ✓ VERIFIED | Cases at 70-478, including the old-peer-falls-back-to-local-not-0 case. |
| `CHANGELOG.md` | Documents per-group(3)/per-DM(5) defaults, additive behavior change, 0=unlimited | ✓ VERIFIED | Lines 8-10 (Unreleased section, Behavior-change note present). |
| `services/rate-limit.ts` | `InjectedDeps.context?`, threaded into `evaluate()`'s 5th arg, flush-timer untouched | ✓ VERIFIED | Lines 83-87,116-125,175-187; no context in the accumulated-notification log line (`log("Notification accumulated...", { type })`, line 133 — parity preserved). |
| `notifications/groups.ts` | Group site passes `encodeGroupPointer(group)` as context | ✓ VERIFIED | Line 153. |
| `notifications/messages.ts` | Both DM sites pass raw counterparty pubkey as context | ✓ VERIFIED | Lines 235, 339 — both `{ context: sender }`, no transport prefix. |
| `tests/services/rate-limit.test.ts` | Context-threading isolation, no-context regression, flush-timer-no-restart | ✓ VERIFIED | `describe` blocks at 251, 289, 318 all present and passing. |
| `pages/groups.tsx` | Second `rateLimitPerGroup` field, clamp, top-level merge, "0 = unlimited" help text | ✓ VERIFIED | Lines 253-273 (input+help), 322,370-373 (clamp), 385-392 (merge). |
| `pages/messages.tsx` | Second `rateLimitPerDm` field, clamp, top-level merge, "0 = unlimited" help text | ✓ VERIFIED | Lines 126-146 (input+help), 196,225-228 (clamp), 239-246 (merge). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `evaluate()`'s 3 gates | ONE `rollIfExpired` result | single-call discipline | ✓ WIRED | `rate-limit-accounting.ts:191` — one call, all three gates (`underType`/`underGlobal`/`underContext`) read from `rolled`. |
| `notifications/groups.ts` | `services/rate-limit.ts`'s `rateLimitedNotify` | `context: encodeGroupPointer(group)` 3rd arg | ✓ WIRED | Line 153; `rateLimitedNotify` destructures and forwards to `evaluate()`. |
| `notifications/messages.ts` (×2 sites) | `services/rate-limit.ts` | `context: sender` 3rd arg | ✓ WIRED | Lines 235, 339. |
| `DEFAULT_RATE_LIMIT_CONFIG.perGroup/.perDm` | config seed, `migrateConfig`, `asRateLimit` fallback | single source of truth | ✓ WIRED | `services/config.ts:131-132` referenced by migration (`:354,356`); `helpers/preferences.ts:271,273` references the same constant for the sync fallback. |
| `mergePrefs`'s `{ ...current, ...incoming }` | applied config | propagation once `SyncedPrefs`+`asRateLimit` carry the fields | ✓ WIRED | No change needed to `mergePrefs` — confirmed by summary and by preferences round-trip test (`preferences.test.ts:429`) passing without a `mergePrefs` diff. |
| `pages/groups.tsx`/`pages/messages.tsx` PATCH handlers | `newConfig.rateLimit` | top-level `perGroup`/`perDm` merge (sibling of `perType`) | ✓ WIRED | Lines 385-392 (groups), 239-246 (messages) — confirmed NOT nested inside `perType`. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite passes (174 tests, 12 files, incl. all Phase 7 additions) | `bun test` | `174 pass, 0 fail, 538 expect() calls` | ✓ PASS |
| Type-check clean (`tsc --noEmit`) | `bun run lint` | No output, exit 0 | ✓ PASS |
| Named test: per-context isolation via `rateLimitedNotify` (state-transition proof — one group's overflow doesn't block a different group) | grep-confirmed test exists at `tests/services/rate-limit.test.ts:252`, included in the full `bun test` pass above | pass | ✓ PASS |
| Named test: flush-timer no-restart on perGroup/perDm-only write (cancellation/ordering invariant — proves this phase's config write doesn't restart Phase 6's flush interval) | grep-confirmed test at `tests/services/rate-limit.test.ts:318`, included in full suite pass | pass | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description (07-CONTEXT.md) | Status | Evidence |
|---|---|---|---|---|
| D7-01 | 07-01, 07-03 | Chat contexts only (groups/DMs); replies/zaps untouched; DM transports share one bucket | ✓ SATISFIED | Truth #1 |
| D7-02 | 07-01 | Runtime default, no persisted per-context config, lazy create + window-prune | ✓ SATISFIED | Truth #2 |
| D7-03 | 07-01, 07-03 | Key derivation: `encodeGroupPointer(group)` / counterparty pubkey | ✓ SATISFIED | Truth #3 |
| D7-04 | 07-01, 07-03 | Most-restrictive-wins layering | ✓ SATISFIED | Truth #4 |
| D7-05 | 07-02 | Default config, synced via kind-30078 | ✓ SATISFIED | Truth #5 |
| D7-06 | 07-01, 07-02, 07-04 | Defaults: perGroup=3, perDm=5, 0=unlimited | ✓ SATISFIED | Truth #6 |
| D7-07 | 07-01 | Reuse Phase-6 grouped summary, counts-only, no per-context detail | ✓ SATISFIED | Truth #7 |
| D7-08 | 07-04 | Minimal UI — 2 new fields, no per-context override UI | ✓ SATISFIED | Truth #8 |
| D7-09 | 07-01, 07-02, 07-03 | Tight scope, reuse Phase-6 limiter, no regression to per-type/global for existing callers | ✓ SATISFIED | Truth #9 |

No orphaned requirement IDs — all 9 IDs declared in 07-CONTEXT.md are claimed across the 4 plans' `requirements:` frontmatter and independently verified against source.

### Anti-Patterns Found

None. `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` scan across all 8 modified/created source files returned zero matches (the one `placeholder=` hit in `pages/groups.tsx:140` is a pre-existing, unrelated HTML input placeholder attribute for the group-link field — not a stub marker).

### Human Verification Required

Per this project's established pattern (Phases 1–6) and explicit instruction for this verification pass, live-UI/live-signer UAT is deferred to `/gsd-verify-work` rather than blocking phase completion. Both are documented as deferred in `07-04-SUMMARY.md`'s "Next Phase Readiness" section and `07-04-PLAN.md`'s UAT section.

### 1. New rate-limit fields render, save, and persist on /groups and /messages

**Test:** Open `/groups`, confirm the new "Default Per-Group Rate Limit" field renders with the current `perGroup` value (3 by default) below the existing per-type field; change it and save via the PATCH form; reload the page and confirm the new value persisted; repeat for `/messages`' "Default Per-DM Rate Limit" field (`perDm`, default 5).
**Expected:** Both fields render, save, and survive a reload without disturbing the existing per-type field's value.
**Why human:** Requires a running UI (Datastar PATCH round trip) — cannot be observed via static source/grep analysis alone.

### 2. Kind-30078 encrypted sync round trip for perGroup/perDm across devices

**Test:** With a real Nostr signer configured, change `perGroup`/`perDm` on one device/session and confirm the encrypted kind-30078 preference event carries the new values and a second session picks them up (or that a pre-Phase-7 peer's payload without these keys falls back to local defaults, not 0, in a live sync).
**Expected:** Values sync correctly; old-format payloads never silently disable per-context throttling (never coerce to 0).
**Why human:** Requires a live signer session and multi-device sync — the unit tests (`preferences.test.ts`) already prove the pure serialize/sanitize/merge logic in isolation, but the end-to-end encrypted-event round trip needs a real signer.

### Gaps Summary

None. All 9 D7 requirement IDs (D7-01 through D7-09) declared in `07-CONTEXT.md` are implemented, wired end-to-end, and covered by passing automated tests (174/174 `bun test`, clean `bun run lint`/`tsc --noEmit`). No stubs, no orphaned artifacts, no anti-patterns. The only outstanding items are the two live-UI/live-signer UAT checks that this project consistently defers to `/gsd-verify-work` (Phases 1–6 precedent), which do not block phase completion per this run's explicit scope.

---

_Verified: 2026-07-13T22:04:33Z_
_Verifier: Claude (gsd-verifier)_
