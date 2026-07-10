# Phase 7: Default rate limit for chat groups and DMs on join - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey areas proposed in batch, user accepted all three areas as recommended.

<domain>
## Phase Boundary

Extend Phase 6's rate limiter with **per-context** buckets for chat-type contexts — one bucket
**per NIP-29 group** and **per DM conversation** — so that when a user joins a new group or a new
DM conversation begins, that context is automatically throttled from its first activity burst,
without the user being spammed. Builds directly on Phase 6 (reuses the limiter, the counts-only
grouped-overflow summary, and the config/sync patterns).

The key model: **per-context COUNTERS sharing a configurable DEFAULT limit.** Each group / DM
counterparty gets its own sliding/tumbling-window counter (so one busy group's traffic doesn't
count against another's), but they all use the same **default per-group** / **default per-DM**
limit. A newly-joined group or new DM therefore automatically gets its own bucket at the default —
that IS "the default rate limit applied on join," achieved purely at runtime with **no per-context
config persisted** (no unbounded config growth).

**Not in this phase:** per-specific-context OVERRIDES (a custom limit for one particular group or
DM — deferred UI); rate-limiting replies/zaps per-context (they stay type/global only); rebuilding
Phase 6's per-type/global limiter or its grouped-overflow mechanism; changing decrypt/gate logic.

</domain>

<decisions>
## Implementation Decisions

### Per-context model & keying
- **D7-01 (chat contexts only):** Add a per-context bucket per **NIP-29 group** and per **DM
  conversation**. Replies and zaps stay per-type + global only (not chat-type). Both DM transports
  (NIP-04 + NIP-17) key by the DM counterparty.
- **D7-02 (runtime default, no persisted per-context config):** The "default on join" is applied at
  RUNTIME: any group/DM context uses the configured default limit for its own counter. Do NOT
  persist a config entry per context; do NOT hook a literal "join" event. A new group appearing in
  the user's kind-10009 list, or a first DM from a new counterparty, automatically gets its own
  default-limited bucket the first time a notification for it is evaluated. This structurally avoids
  unbounded config/state growth (state is per-process in-memory, like Phase 6; buckets are created
  lazily and pruned by the window like the per-type buckets).
- **D7-03 (key derivation):** Group context key = `encodeGroupPointer(group)` (available at the
  `groups.ts` notification site). DM context key = the counterparty pubkey (NIP-04 `sender` /
  NIP-17 `rumor.pubkey`, available at the `messages.ts` sites). These become an optional `context`
  argument threaded through `rateLimitedNotify` into the accounting.

### Layering & config
- **D7-04 (all buckets apply — most restrictive wins):** A notification is delivered only if it is
  under ALL applicable limits: its **per-context** bucket (group/DM) AND the Phase-6 **per-type**
  bucket AND the **global** bucket. Any bucket over its limit routes the notification to the
  grouped-overflow accounting. This lets one busy group/DM throttle itself without starving other
  groups/DMs or other types. The per-context check is ADDITIVE to Phase 6 — it does not replace the
  per-type check.
- **D7-05 (default config, synced):** Add a **default per-group limit** and a **default per-DM
  limit** to `AppConfig.rateLimit` (reusing the existing Phase-6 `window`). These are rules → sync
  via the kind-30078 event (extend `SyncedPrefs` + serialize/sanitize + the local-default fallback,
  mirroring Phase 6's `asRateLimit`; bump `PREFS_VERSION`). Migration adds them with defaults.
- **D7-06 (defaults):** Sensible chat defaults — **per-group ≈ 3 per window**, **per-DM ≈ 5 per
  window** (planning may tune), window = the shared Phase-6 window (default 60s). `0 = unlimited`
  (per-context disabled), consistent with Phase 6's count-limit semantics. New installs get these;
  migration adds them. Additive — document in CHANGELOG.

### Overflow, UI & scope
- **D7-07 (reuse Phase-6 grouped summary):** Reuse Phase 6's counts-only combined grouped-overflow
  summary. Per-context overflow rolls into the existing per-type overflow counts (e.g. a throttled
  group message still increments the `groups` overflow count) — NO per-context detail in the summary
  message. The summary stays counts-only (D6-10) — never group names/DM content beyond aggregate
  per-type counts.
- **D7-08 (minimal UI):** Add a **default-per-group limit** field to `pages/groups.tsx` and a
  **default-per-DM limit** field to `pages/messages.tsx` (extend each existing PATCH form + flat
  Datastar signal, clamp non-negative int, sibling-preserving — mirror Phase 6's UI). NO
  per-specific-group/DM override UI (deferred).
- **D7-09 (tight scope — build on Phase 6):** Reuse the Phase-6 limiter (`services/rate-limit.ts` +
  `services/rate-limit-accounting.ts`), grouped-overflow, and config/sync — extend, do not rebuild.
  Groups + DMs only. Do NOT add per-context OVERRIDES, do NOT rate-limit replies/zaps per-context,
  do NOT change the Phase-6 per-type/global behavior for existing users (the per-context layer is
  additive; ensure per-group/per-DM defaults are permissive enough not to surprise-suppress — the
  window shared with per-type means per-context is a tighter sub-limit).

### Claude's Discretion
- Exact accounting extension: whether per-context buckets are a second keyed map inside the existing
  `RateLimitState` (keyed by `type + contextKey`) or a parallel structure — keep the pure,
  clock-injectable, network-safe testability from Phase 6 (services/rate-limit-accounting.ts).
- Lazy bucket creation + window-based pruning so the per-context map doesn't grow unbounded across a
  long-lived process with many groups/DMs.
- Exact `rateLimitedNotify` signature change (add an optional `context?: string` arg) that keeps the
  4 non-chat call sites (replies/zaps) unchanged and only the groups + messages sites passing a
  context.
- Exact default field names/shape in `AppConfig.rateLimit` (e.g. `perGroup`/`perDm` alongside
  `perType`) that migrates + syncs cleanly.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/ROADMAP.md` §"Phase 7" — phase goal.
- `.planning/phases/06-.../06-CONTEXT.md` + `06-RESEARCH.md` — the Phase-6 rate limiter this phase
  extends: `rateLimitedNotify`, the tumbling-window accounting, grouped-overflow (counts-only,
  bypass), the `rateLimit` config + `asRateLimit` sync fallback + `clampWindowSeconds`. **Do not
  regress the Phase-6 window-clamp / distinctUntilChanged fixes.**
- `.planning/phases/01-.../01-CONTEXT.md` — NIP-29 group model (`GroupPointer`, `encodeGroupPointer`,
  kind-10009 group list) for the group context key.
- `.planning/phases/02-.../02-CONTEXT.md` — D2-04 rules sync + `SyncedPrefs` shape (D7-05).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/rate-limit.ts` — `rateLimitedNotify(type, options)` (`:101`) — extend with an optional
  `context?` arg. `services/rate-limit-accounting.ts` — the pure window accounting (`NotificationType`
  `:23`, `evaluate`/`flushOverflow`/`formatOverflowSummary`, `clampWindowSeconds`) — extend for
  per-context buckets, keeping it clock-injectable + network-safe.
- `notifications/groups.ts` — `rateLimitedNotify` site (`:143`-ish); `GroupPointer` + `group.id` +
  `encodeGroupPointer(group)` available (`:8-11,85`) → the group context key.
- `notifications/messages.ts` — the 2 `rateLimitedNotify` DM sites; `sender` (NIP-04, `:127`) and
  `rumor.pubkey` (NIP-17) → the DM context key.
- `services/config.ts` — `AppConfig.rateLimit` + `DEFAULT_RATE_LIMIT_CONFIG` + `migrateConfig` (add
  `perGroup`/`perDm` defaults + migration).
- `helpers/preferences.ts` — `asRateLimit` + `SyncedPrefs` + `PREFS_VERSION` (extend + bump).
- `pages/groups.tsx`, `pages/messages.tsx` — the per-form PATCH + flat Datastar signal pattern for
  the two default fields (D7-08).

### Established Patterns
- Phase-6 rate limiter: pure clock-injectable accounting unit + a thin `rateLimitedNotify` wrapper;
  counts-only grouped summary that bypasses the limiter; `clampWindowSeconds` at every config surface.
- Config migration + `asRateLimit` sync fallback to LOCAL defaults (never 0/unlimited window).
- Network-safe tests: extend `tests/services/rate-limit-accounting.test.ts` (injected clock) for
  per-context buckets + pruning; config/preferences regression + sync round-trip tests.

### Integration Points
- `services/rate-limit-accounting.ts` — per-context bucket accounting (+ lazy create + prune).
- `services/rate-limit.ts` — thread the optional `context` through.
- `notifications/groups.ts` + `notifications/messages.ts` — pass the context key.
- `services/config.ts` + `helpers/preferences.ts` — `perGroup`/`perDm` default config + sync.
- `pages/groups.tsx` + `pages/messages.tsx` — the two default UI fields.
- Tests: accounting per-context + pruning; config migration; sync round-trip.

</code_context>

<specifics>
## Specific Ideas
- Per-context COUNTERS, shared DEFAULT limit — a new group/DM auto-gets its own bucket at the default
  (that's "default on join," at runtime, no persisted per-context config).
- All buckets layer: delivered only if under per-context AND per-type AND global.
- Grouped summary stays counts-only, aggregated into per-type counts (no per-context detail).
- Reuse, don't rebuild, Phase 6 — and don't regress its window-clamp/starvation fixes.

</specifics>

<deferred>
## Deferred Ideas
- Per-specific-group / per-specific-DM rate-limit OVERRIDES (a custom limit for one group/DM) + their
  UI — deferred; this phase ships only the shared defaults.
- Per-context rate limiting for replies/zaps — out of scope (not chat-type).
- Per-context detail in the grouped-overflow summary (naming busiest groups/DMs) — considered, dropped
  for simplicity (D7-07).
- Persisting per-context bucket state across restarts — in-memory per-process is acceptable (mirrors
  Phase 6 + the app's in-memory EventStore).
</deferred>

---

*Phase: 07-default-rate-limit-for-chat-groups-and-dms-on-join*
*Context gathered: 2026-07-10 (smart discuss, autonomous mode)*
