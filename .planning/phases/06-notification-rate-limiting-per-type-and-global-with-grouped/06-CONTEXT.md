# Phase 6: Notification rate limiting per type and global with grouped overflow - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey areas proposed in batch, user accepted all three areas as recommended.

<domain>
## Phase Boundary

Introduce **rate limiting** for outbound ntfy notifications — a **per-notification-type** limit
AND a **global** limit across all types — to prevent spamming the user's phone during heavy
activity (busy group chats, repeated tags). When a limit is hit, do NOT drop notifications
silently: **accumulate** per-type counts and, at the end of the rate-limit window, send **one
combined grouped notification** (e.g. "47 new mentions, 12 group messages") summarizing what was
withheld.

Ships:
- A new central **`services/rate-limit.ts`** that all four notification listeners route through
  (wrapping `sendNotification` with a `type` label), enforcing a **sliding-window** counter per
  type plus a global bucket over a configurable window (default 60s).
- **Grouped overflow**: over-limit notifications increment per-type counters; at window end a
  single combined summary notification is emitted (bypassing the limiter so it is never itself
  suppressed).
- **Configurable limits** (global + per-type) in `AppConfig`, synced as rules via the Phase-2
  kind-30078 event, with sensible anti-spam defaults.
- A **minimal UI**: a per-type rate-limit field on each existing type config page and a global one
  on `/notifications`.

**Not in this phase:** per-context (per-group / per-DM-conversation) rate limits or auto-applied
defaults on join (Phase 7); changing what triggers a notification (the existing `shouldNotify` +
Phase-5 category gates stay as-is — the rate limiter is the LAST gate, after them, right before
`sendNotification`); changing DM/group decrypt logic.

</domain>

<decisions>
## Implementation Decisions

### Architecture & algorithm
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

### Overflow grouping & flush
- **D6-04 (accumulate, don't drop):** When a per-type or global limit is hit, do NOT drop the
  notification silently — increment a per-type **overflow counter** for the current window.
- **D6-05 (one combined summary at window end):** At the end of the window (a debounced/timer
  flush), if any overflow accumulated, send **one combined grouped notification** whose body
  summarizes the withheld per-type counts, e.g. "47 new mentions, 12 group messages, 3 zaps". Reset
  the counters after flushing. (One combined message, not per-type separate summaries.)
- **D6-06 (grouped summary bypasses the limiter):** The grouped summary notification is emitted via
  `sendNotification` **directly, bypassing** `rateLimitedNotify`, so it can never itself be
  rate-limited/suppressed.

### Config, defaults & UI
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

### Scope & layering
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/ROADMAP.md` §"Phase 6" — phase goal (and §"Phase 7" for the per-context follow-on, so
  this phase leaves room for it).
- `.planning/phases/02-.../02-CONTEXT.md` — D2-04 rules sync + `helpers/preferences.ts` `SyncedPrefs`
  shape (D6-07).
- `.planning/phases/05-.../05-CONTEXT.md` — the layered-gate pattern + `migrateConfig` extension +
  network-safe extracted-unit test pattern this phase mirrors.
- `.planning/codebase/CONCERNS.md` — "No rate limiting on outbound notifications" (the gap this
  phase closes) and the `sendNotification`/ntfy send path.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/ntfy.ts` — `sendNotification(options: NtfyNotificationOptions)` (`:129`), `NtfyPriority`
  enum (`:8`), `NtfyNotificationOptions` (`:43`) — the delivery primitive the rate limiter wraps.
- The 5 `sendNotification(...)` call sites: `notifications/replies.ts:102`, `zaps.ts:107`,
  `messages.ts:224` (NIP-04) + `:318` (NIP-17), `groups.ts:143`. Each routes through
  `rateLimitedNotify(type, options)` with its type.
- `services/config.ts` — `AppConfig` + `migrateConfig` (the Phase-3/5 extracted pure fn) for the new
  `rateLimit` config + migration/defaults.
- `helpers/preferences.ts` — `SyncedPrefs` + `serializePrefs`/`sanitizeSyncedPrefs` + `PREFS_VERSION`
  (extend + bump for the new synced rate-limit fields, D6-07; mirror the Phase-5 old-peer fallback).
- `services/logs.ts` — module-level buffer is the precedent for module-level per-process rate state.
- `pages/{replies,zaps,messages,groups}.tsx` + `pages/notifications.tsx` — the per-type + global UI
  (D6-08); Datastar signal + PATCH pattern.

### Established Patterns
- Module-scope singleton services with side effects; `log()` never `console.log`; localized
  try/catch. Config pages: `*View()` + `route={GET,PATCH}`; flat Datastar signals.
- Network-safe tests import specific pure units (inject a clock for time-based logic), never
  `services/nostr.ts` / the notifications barrel. `bunfig.toml`/`tests/setup.ts` isolate CONFIG.

### Integration Points
- New `services/rate-limit.ts` (+ pure accounting/formatting unit for tests).
- `notifications/{replies,zaps,messages,groups}.ts` — route sends through the limiter.
- `services/config.ts` — `rateLimit` config + migration + defaults.
- `helpers/preferences.ts` — sync the new fields.
- `pages/{replies,zaps,messages,groups,notifications}.tsx` — the minimal UI.
- Tests: pure accounting/summary unit (injected clock) + config-migration regression + sync round-trip.

</code_context>

<specifics>
## Specific Ideas
- Rate limiter is the LAST gate before `sendNotification`, after shouldNotify + category gates.
- Grouped summary is counts only (e.g. "47 new mentions, 12 group messages") — never DM content.
- `0` = unlimited (per type or global) so users can disable rate limiting.
- Extract time-window accounting into a pure, clock-injectable unit for deterministic tests.

</specifics>

<deferred>
## Deferred Ideas
- Per-context (per-group / per-DM-conversation) rate limits + auto-defaults on join — explicitly
  Phase 7.
- Priority-aware limiting (never rate-limit urgent/zap-over-threshold, etc.) — not requested; revisit
  if users ask.
- Persisting rate-limit state across restarts — in-memory per-process is acceptable (mirrors the app's
  in-memory EventStore/log buffer).
</deferred>

---

*Phase: 06-notification-rate-limiting-per-type-and-global-with-grouped*
*Context gathered: 2026-07-10 (smart discuss, autonomous mode)*
