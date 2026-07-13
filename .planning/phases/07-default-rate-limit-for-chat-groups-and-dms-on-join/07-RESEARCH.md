# Phase 7: Default rate limit for chat groups and DMs on join - Research

**Researched:** 2026-07-13
**Domain:** Extending Phase 6's in-process, hand-rolled tumbling-window rate limiter with a
per-context (per-NIP-29-group, per-DM-counterparty) accounting layer. No new external
dependency — this is purely additive internal-code research grounded in the ACTUALLY
implemented Phase 6 source (read directly this session, not from Phase 6's pre-execution
RESEARCH.md).
**Confidence:** HIGH (all claims traced to specific file:line reads of the current codebase this
session — no external library/API surface is introduced, so no WebSearch/Context7 lookup was
performed; see "Sources").

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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
  clock-injectable, network-safe testability from Phase 6 (`services/rate-limit-accounting.ts`).
- Lazy bucket creation + window-based pruning so the per-context map doesn't grow unbounded across a
  long-lived process with many groups/DMs.
- Exact `rateLimitedNotify` signature change (add an optional `context?: string` arg) that keeps the
  4 non-chat call sites (replies/zaps) unchanged and only the groups + messages sites passing a
  context.
- Exact default field names/shape in `AppConfig.rateLimit` (e.g. `perGroup`/`perDm` alongside
  `perType`) that migrates + syncs cleanly.

### Deferred Ideas (OUT OF SCOPE)

- Per-specific-group / per-specific-DM rate-limit OVERRIDES (a custom limit for one group/DM) + their
  UI — deferred; this phase ships only the shared defaults.
- Per-context rate limiting for replies/zaps — out of scope (not chat-type).
- Per-context detail in the grouped-overflow summary (naming busiest groups/DMs) — considered, dropped
  for simplicity (D7-07).
- Persisting per-context bucket state across restarts — in-memory per-process is acceptable (mirrors
  Phase 6 + the app's in-memory EventStore).
</user_constraints>

<phase_requirements>
## Phase Requirements

No formal REQ-IDs exist for this phase; `.planning/phases/07-.../07-CONTEXT.md`'s D7-01..D7-09
decisions are the contract and are treated as the requirement set for planning/verification.

| ID | Description | Research Support |
|----|-------------|------------------|
| D7-01 | Per-context buckets scoped to `groups`/`messages` types only | See "Architecture Patterns" §1-2; "Common Pitfalls" #4 |
| D7-02 | Runtime-only default application, no persisted per-context config, lazy create + window-pruned | See "Architecture Patterns" §1 (the "contexts resets wholesale on tumble" design), "Don't Hand-Roll" |
| D7-03 | Group key = `encodeGroupPointer(group)`; DM key = `sender`/`rumor.pubkey` | See "Code Examples" §1; confirmed at `notifications/groups.ts:143`, `notifications/messages.ts:224,268,318` |
| D7-04 | Most-restrictive-wins: context AND type AND global all gate delivery | See "Architecture Patterns" §2, "Code Examples" §2 (`evaluate` extension) |
| D7-05 | `AppConfig.rateLimit.perGroup`/`.perDm`, synced via kind-30078, migration adds defaults | See "Standard Stack"/"Config shape", "Code Examples" §3-4 |
| D7-06 | Defaults perGroup=3, perDm=5, shared window, 0=unlimited | See "Common Pitfalls" #5, Assumptions Log A1 |
| D7-07 | Context overflow rolls into existing per-type overflow, no per-context detail | See "Common Pitfalls" #6, "Anti-Patterns to Avoid" |
| D7-08 | Two new number-input UI fields (`/groups`, `/messages`), distinct signal names from existing `rateLimitPerType` | See "Common Pitfalls" #7; "Code Examples" §5 |
| D7-09 | Extend, don't rebuild; don't regress Phase 6's window-clamp/distinctUntilChanged/flush-timer fixes | See "Common Pitfalls" #1-3; "Architectural Responsibility Map" |
</phase_requirements>

## Summary

Phase 6 is fully implemented (not just researched) — `services/rate-limit-accounting.ts` and
`services/rate-limit.ts` exist on disk today with the tumbling-window design, the config-driven
flush timer with `distinctUntilChanged`, `clampWindowSeconds` enforced at every input surface
(config load, migration, NIP-78 sync, PATCH), and the `now`/`send` dependency-injection seam used
by `tests/services/rate-limit.test.ts`. This phase is a small, additive extension to that exact,
already-verified code — every citation below is to the real current file, not a proposed design.

The single most important design call this research makes: **per-context buckets should be pruned
by piggy-backing on the SAME tumbling-window rollover Phase 6 already performs**, not by adding an
independent per-context TTL/LRU mechanism. `rollIfExpired`/`createRateLimitState` already discard
and recreate the ENTIRE `RateLimitState` (windowStart, globalCount, perTypeCount, overflow) every
time `now - windowStart >= config.window`. Adding one more field to that same reset — a flat
`contexts: Record<string, number>` map — means the per-context map is *structurally* bounded: it can
never hold more entries than "the number of distinct (type, context) pairs seen since the last
window boundary," regardless of how many total groups the user has ever joined or how long the
process has run. This satisfies D7-02's "pruned by the window like the per-type buckets" instruction
literally, and requires zero new scheduling/timer code — the existing flush timer (`services/
rate-limit.ts:163-175`, unmodified) already drives every rollover.

Composite key: `` `${type}:${contextKey}` `` (e.g. `"groups:example.com'abc123"`,
`"messages:3bf0c63f...pubkeyhex"`). Verified from source that `encodeGroupPointer` (`applesauce-common`)
always emits `` `${hostname}'${groupId}` `` — a literal apostrophe never present in a 64-char
lowercase-hex pubkey — so group and DM keys are structurally non-colliding even without the `type:`
prefix; the prefix is kept anyway for clarity/future-proofing (the type discriminator is free, since
`evaluate()` already receives `type` as a parameter).

`rateLimitedNotify`'s existing 3rd parameter is already an options bag (`{ now?, send? }` —
`services/rate-limit.ts:78-81`), used only by tests today. The cleanest, most backward-compatible
signature change is to add `context?: string` as a NEW key on that SAME bag —
`{ context?, now?, send? }` — rather than inserting a new positional parameter. Every existing call
site (the 4 non-chat listeners, and every existing test in `tests/services/rate-limit.test.ts` that
passes `{ now, send }`) continues to compile and behave identically with `context` simply absent;
only `notifications/groups.ts` and `notifications/messages.ts` (2 sites) need to add `{ context: ... }`.

**Primary recommendation:** Extend `RateLimitState` with `contexts: Record<string, number>` (flat
map, reset by the existing `createRateLimitState`/`rollIfExpired` cycle — no new pruning code);
extend `RateLimitConfig`/`AppConfig.rateLimit` with top-level `perGroup`/`perDm` siblings of
`perType` (NOT nested inside `perType` — that field is a structurally different, existing gate: "max
across ALL groups," not "max for ONE group"); extend `evaluate(state, type, now, config, context?)`
with a 5th optional parameter that adds a third `underContext` check to the existing `underType &&
underGlobal` guard, using the SAME atomic increment-only-in-the-deliver-branch discipline already in
place; thread `context` through `rateLimitedNotify`'s existing options-bag 3rd parameter from the 2
chat-listener call sites only; mirror the exact `migrateConfig`/`asRateLimit`/PATCH-clamp patterns
already used for `global`/`perType.*` for the two new scalar fields (no new clamp-bounds constant
needed — unlike `window`, `0` is a safe, already-handled "unlimited" value for `perGroup`/`perDm`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-context bucket accounting (`evaluate`'s new `underContext` gate, `contexts` map) | Service Layer (`services/rate-limit-accounting.ts`) | — | Same pure, clock-injected module Phase 6 already put this logic in; D7's Discretion note explicitly frames this as an accounting-module extension |
| Context-map pruning (wholesale reset on window tumble) | Service Layer (`services/rate-limit-accounting.ts`) | — | Free reuse of `rollIfExpired`/`createRateLimitState` — no new scheduling component |
| Context key derivation (`encodeGroupPointer(group)` / `sender` / `rumor.pubkey`) | Notification Listener Layer (`notifications/groups.ts`, `notifications/messages.ts`) | — | D7-03 explicit; these values are already in scope at the existing `rateLimitedNotify` call sites, no new lookup needed |
| `rateLimitedNotify` context threading (options-bag extension) | Service Layer (`services/rate-limit.ts`) | — | Same choke point Phase 6 built; the change is additive to its existing `InjectedDeps`-shaped 3rd parameter |
| `perGroup`/`perDm` config schema + migration + defaults | Service Layer (`services/config.ts`) | — | Same tier/pattern as the existing `rateLimit.global`/`rateLimit.perType` backfill block |
| `perGroup`/`perDm` sync (`SyncedPrefs.rateLimit`) | Service Layer (`helpers/preferences.ts`) | — | D7-05; same tier as the existing D6-07 rateLimit sync subset |
| Two new default-limit number inputs | HTTP/Page Layer (`pages/groups.tsx`, `pages/messages.tsx`) | — | Same tier/pattern as the existing `rateLimitPerType` field already on both pages |

## Standard Stack

### Core

No new packages. This phase extends the existing Phase 6 dependency set (`rxjs@^7.8.2`, `bun:test`)
with zero additions.

| Library | Version | Purpose | Why Standard (for this phase) |
|---------|---------|---------|-------------------------------|
| `rxjs` | `^7.8.2` `[VERIFIED: package.json]` | Unchanged — the existing `configValue("rateLimit").pipe(map(...), distinctUntilChanged(), switchMap(...))` flush-timer pipeline in `services/rate-limit.ts:163-175` needs NO modification for this phase; `perGroup`/`perDm` changes emit a new `rateLimit` object from `config$`, but the pipeline's `map` already projects only `cfg.window`, so `distinctUntilChanged()` continues to suppress unrelated field changes exactly as it does today | Already installed; this phase's extension does not touch the timer at all |
| `bun:test` | bundled with Bun | Unit tests for the pure accounting extension, config migration, and sync round-trip | Existing test runner; extends `tests/services/rate-limit-accounting.test.ts`, `tests/services/rate-limit.test.ts`, `tests/services/config.test.ts`, `tests/helpers/preferences.test.ts` |

### Supporting

None required.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| A flat `contexts: Record<string, number>` map reset by the existing tumbling-window rollover | An independent LRU/TTL cache keyed per context, decoupled from the shared window | An independent cache needs its OWN eviction policy (size cap? per-entry TTL?) and its own test surface — CONTEXT.md's own D7-02 wording ("pruned by the window like the per-type buckets") already specifies the simpler, existing mechanism. An LRU adds a size-cap magic number with no natural value, and a per-entry TTL duplicates the window concept AppConfig already has. No behavioral benefit for this phase's stated requirements. |
| Extending `evaluate()`'s existing signature with a 5th optional parameter | A separate `evaluateContext()` function called independently before/after `evaluate()` | Two separate pure calls would each roll/read `state` independently, risking a subtle bug where the context gate uses a `rolled` state from a DIFFERENT roll-check than the type/global gate (e.g. one call rolls the window, the other doesn't, if invoked at slightly different `now` values). A single `evaluate()` call that computes `underContext && underType && underGlobal` from ONE `rollIfExpired` result, then increments all three counters atomically in one return value, is the same all-or-nothing correctness Phase 6 already relies on for `underType && underGlobal`. |
| A NEW clamp-bounds constant for `perGroup`/`perDm` (mirroring `MIN_WINDOW_SECONDS`/`MAX_WINDOW_SECONDS`) | Reusing the plain `asNonNegativeInt`/`isValidNonNegativeNumber` coercion already used for `global`/`perType.*` | `window=0` is uniquely dangerous because `rollIfExpired`'s `now - windowStart < windowSeconds` becomes false on nearly every call, causing every evaluate() to silently roll to a fresh state before its limit check runs (Phase 6's CR-01 finding) — that failure mode does NOT apply to `perGroup`/`perDm`, where `0` is BY DESIGN "unlimited" (the `underContext` gate is `contextLimit === 0 \|\| count < contextLimit`, same pattern as `global`/`perType`). No new clamp constant needed — this simplifies the plan relative to `window`'s handling. |

**Installation:** None — no new packages to install.

**Version verification:** No new package; `rxjs@^7.8.2` and `bun:test` already verified/pinned by
Phase 6. Not independently re-verified this session since nothing changed in `package.json`.

## Package Legitimacy Audit

No external packages are installed by this phase — table intentionally empty (mirrors Phase 6's
own audit, which also found no packages proposed).

**Packages removed due to [SLOP] verdict:** none (no packages proposed).
**Packages flagged as suspicious [SUS]:** none (no packages proposed).

## Architecture Patterns

### System Architecture Diagram

```text
┌──────────────────────────────────────────────────────────────────────────┐
│  notifications/groups.ts (:143)                                          │
│    subscribe(({ group, metadata, message }) => {                         │
│      await rateLimitedNotify("groups", {...}, {                          │
│        context: encodeGroupPointer(group)   ◄── D7-03, NEW               │
│      })                                                                   │
│    })                                                                     │
│                                                                            │
│  notifications/messages.ts (:224 NIP-04, :318 NIP-17)                     │
│    await rateLimitedNotify("messages", {...}, {                          │
│      context: sender  /  rumor.pubkey        ◄── D7-03, NEW              │
│    })                                                                     │
│                                                                            │
│  notifications/replies.ts, notifications/zaps.ts  — UNCHANGED            │
│    await rateLimitedNotify("replies"|"zaps", {...})   (no 3rd arg)       │
└──────────────────────────────┬─────────────────────────────────────────────┘
                                │ rateLimitedNotify(type, opts, { context?, now?, send? })
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  services/rate-limit.ts  (UNCHANGED shell logic — only threads `context`) │
│    const result = evaluate(state, type, now, rateLimit, context);        │
│         ▲ NEW 5th arg, optional — undefined for replies/zaps             │
│    state = result.state; if (result.deliver) send(options); else log();  │
│    // flush timer (distinctUntilChanged/switchMap/interval) — UNTOUCHED  │
└──────────────────────────────┬─────────────────────────────────────────────┘
                                │ (pure calls only)
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  services/rate-limit-accounting.ts                                        │
│                                                                            │
│  RateLimitState {                                                         │
│    windowStart, globalCount, perTypeCount, overflow,                      │
│    contexts: Record<string, number>   ◄── NEW, flat, reset by            │
│  }                                          createRateLimitState/rollIfExpired│
│                                                                            │
│  RateLimitConfig {                                                        │
│    window, global, perType,                                              │
│    perGroup: number,   ◄── NEW (D7-05/06)                                │
│    perDm: number,      ◄── NEW (D7-05/06)                                │
│  }                                                                        │
│                                                                            │
│  evaluate(state, type, now, config, context?) {                          │
│    rolled = rollIfExpired(state, now, config.window)  // UNCHANGED        │
│    underType = ...      // UNCHANGED                                     │
│    underGlobal = ...    // UNCHANGED                                     │
│    key = context ? `${type}:${context}` : undefined   ◄── NEW            │
│    limit = contextLimitFor(type, config)  // perGroup|perDm|0  ◄── NEW   │
│    underContext = !key \|\| limit === 0 \|\| (rolled.contexts[key]??0) < limit│
│    if (underType && underGlobal && underContext) {                       │
│      // increment globalCount, perTypeCount[type], AND contexts[key]     │
│      deliver: true                                                       │
│    } else {                                                              │
│      // overflow[type]++ ONLY — contexts NOT touched on rejection,       │
│      // no per-context overflow substructure (D7-07)                    │
│      deliver: false                                                      │
│    }                                                                      │
│  }                                                                        │
│                                                                            │
│  flushOverflow/formatOverflowSummary — UNCHANGED (D7-07: still            │
│  aggregates by type only; contexts map is simply discarded/reset         │
│  alongside everything else on flush, same as globalCount/perTypeCount)   │
└──────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
services/
├── rate-limit-accounting.ts   # MODIFIED — +contexts field, +perGroup/perDm config, +evaluate() 5th arg
├── rate-limit.ts              # MODIFIED — thread context through rateLimitedNotify's options bag
├── config.ts                  # MODIFIED — AppConfig.rateLimit.perGroup/.perDm + migrateConfig + defaults
notifications/
├── groups.ts                  # MODIFIED — 1 call-site: add { context: encodeGroupPointer(group) }
├── messages.ts                 # MODIFIED — 2 call-sites: add { context: sender } / { context: rumor.pubkey }
├── replies.ts, zaps.ts        # UNCHANGED
helpers/
├── preferences.ts             # MODIFIED — SyncedPrefs.rateLimit.perGroup/.perDm + serialize/sanitize, PREFS_VERSION → 4
pages/
├── groups.tsx                 # MODIFIED — +1 number input (rateLimitPerGroup), distinct signal from existing rateLimitPerType
├── messages.tsx                # MODIFIED — +1 number input (rateLimitPerDm), distinct signal from existing rateLimitPerType
tests/
├── services/rate-limit-accounting.test.ts  # MODIFIED — +per-context isolation/lazy-create/prune/layering/overflow-rollup/0=unlimited cases
├── services/rate-limit.test.ts             # MODIFIED — +rateLimitedNotify context-threading cases
├── services/config.test.ts                 # MODIFIED — +migrateConfig perGroup/perDm cases
├── helpers/preferences.test.ts             # MODIFIED — +perGroup/perDm serialize/sanitize/merge + old-peer fallback cases
```

### Pattern 1: Context key derivation at the 2 chat call sites (D7-03)

**What:** `encodeGroupPointer(group)` for groups; `sender` (NIP-04) / `rumor.pubkey` (NIP-17) for
DMs. Both values are ALREADY in scope at the existing `rateLimitedNotify` call sites — no new
lookup, subscription, or async call is needed to obtain them.
**When to use:** Only at the 2 files/3 call sites that pass a chat-type `NotificationType`
(`"groups"` or `"messages"`).
**Example:**
```typescript
// Source: notifications/groups.ts:119-148 (existing structure; only the
// rateLimitedNotify call's 3rd argument is new)
.subscribe(async ({ group, metadata, message }) => {
  // group: GroupPointer -- already destructured, already imported
  // encodeGroupPointer (line 8) -- no new import needed
  ...
  await rateLimitedNotify(
    "groups",
    {
      title: `${getDisplayName(profile)} posted to ${getTagValue(metadata, "name")}`,
      message: message.content,
      icon: getTagValue(metadata, "picture") ?? getProfilePicture(profile),
      click: buildGroupLink(group, message),
    },
    { context: encodeGroupPointer(group) }, // NEW (D7-03)
  );
});
```
```typescript
// Source: notifications/messages.ts:172-229 (NIP-04 site) -- `sender` is
// already computed at line 127 (getLegacyMessageReceiver) and destructured
// into the subscribe callback at line 172.
.subscribe(async ({ sender, profile, content, event }) => {
  ...
  await rateLimitedNotify(
    "messages",
    { title: ..., message: messages.sendContent ? content : "[content omitted]", ... },
    { context: sender }, // NEW (D7-03)
  );
});

// Source: notifications/messages.ts:264-326 (NIP-17 site) -- `sender` is
// `rumor.pubkey`, already computed at line 268.
.subscribe(async (rumor) => {
  const sender = rumor.pubkey;
  ...
  await rateLimitedNotify(
    "messages",
    { title: ..., message: messages.sendContent ? content : "[content omitted]", ... },
    { context: sender }, // NEW (D7-03) -- SAME "messages" type + counterparty key as the
                          // NIP-04 site, so one NIP-17 conversation and its NIP-04
                          // equivalent (same pubkey) correctly share ONE per-context bucket.
  );
});
```

### Pattern 2: `evaluate()` extension — most-restrictive-wins (D7-04)

**What:** A 5th, optional `context?: string` parameter. When present, a third gate (`underContext`)
is computed alongside the existing `underType`/`underGlobal` gates, from the SAME `rolled` state
(one `rollIfExpired` call, not two). Delivery requires ALL THREE to be true; the increment (or
overflow) happens exactly once, in the same all-or-nothing branch Phase 6 already uses.
**When to use:** `services/rate-limit-accounting.ts`'s `evaluate` function — the ONLY place this
layering logic should live (mirrors Phase 6's own "keep decision logic in the pure module" pattern).
**Example:**
```typescript
// Source: services/rate-limit-accounting.ts:31-38 (existing RateLimitConfig, to extend)
export type RateLimitConfig = {
  window: number;
  global: number;
  perType: Record<NotificationType, number>;
  /** Default limit for any single NIP-29 group's own bucket per window;
   *  0 = unlimited (D7-05/06). Only consulted when evaluate() is called with
   *  type="groups" AND a context key -- has no effect on replies/zaps. */
  perGroup: number;
  /** Default limit for any single DM counterparty's own bucket per window;
   *  0 = unlimited (D7-05/06). Only consulted when evaluate() is called with
   *  type="messages" AND a context key. */
  perDm: number;
};

// Source: services/rate-limit-accounting.ts:83-92 (existing RateLimitState, to extend)
export type RateLimitState = {
  windowStart: number;
  globalCount: number;
  perTypeCount: Record<NotificationType, number>;
  overflow: Record<NotificationType, number>;
  /** Per-context counts for the CURRENT window only, keyed by
   *  `${type}:${contextKey}`. Lazily populated on first evaluate() call for
   *  a given key (absent key reads as 0 -- no separate "register" step,
   *  D7-02). The WHOLE map is discarded and replaced with {} every time
   *  rollIfExpired()/createRateLimitState() tumbles to a fresh window --
   *  this is the ENTIRE pruning mechanism (D7-02): it can never hold more
   *  entries than the number of distinct (type, context) pairs active
   *  since the last window boundary, regardless of how many groups/DMs the
   *  user has ever joined over the process lifetime. */
  contexts: Record<string, number>;
};

// createRateLimitState must also seed `contexts: {}` (one-line addition).

/** Maps a NotificationType to its per-context limit field. Returns 0 (no
 *  context gate) for "replies"/"zaps" -- defensive only, since D7-01 means
 *  those types never receive a context argument in practice. */
function contextLimitFor(type: NotificationType, config: RateLimitConfig): number {
  if (type === "groups") return config.perGroup;
  if (type === "messages") return config.perDm;
  return 0;
}

export function evaluate(
  state: RateLimitState,
  type: NotificationType,
  now: number,
  config: RateLimitConfig,
  context?: string, // NEW, optional (D7-01/03) -- absent for replies/zaps
): { deliver: boolean; state: RateLimitState } {
  const rolled = rollIfExpired(state, now, config.window); // UNCHANGED

  const typeLimit = config.perType[type];
  const underType = typeLimit === 0 || rolled.perTypeCount[type] < typeLimit; // UNCHANGED
  const underGlobal = config.global === 0 || rolled.globalCount < config.global; // UNCHANGED

  // NEW: most-restrictive-wins third gate (D7-04). A falsy `context` (never
  // expected in practice, but defensively includes an empty string) skips
  // this gate entirely -- `underContext` is vacuously true.
  const contextKey = context ? `${type}:${context}` : undefined;
  const contextLimit = contextKey ? contextLimitFor(type, config) : 0;
  const contextCount = contextKey ? (rolled.contexts[contextKey] ?? 0) : 0;
  const underContext =
    !contextKey || contextLimit === 0 || contextCount < contextLimit;

  if (underType && underGlobal && underContext) {
    const next: RateLimitState = {
      ...rolled,
      globalCount: rolled.globalCount + 1,
      perTypeCount: { ...rolled.perTypeCount, [type]: rolled.perTypeCount[type] + 1 },
      contexts: contextKey
        ? { ...rolled.contexts, [contextKey]: contextCount + 1 }
        : rolled.contexts,
    };
    return { deliver: true, state: next };
  }

  // D7-07: rejection ALWAYS increments overflow[type] only -- contexts is
  // NEVER touched on a non-delivered notification, regardless of WHICH gate
  // (context, type, or global) caused the rejection. There is no
  // per-context overflow substructure.
  const next: RateLimitState = {
    ...rolled,
    overflow: { ...rolled.overflow, [type]: rolled.overflow[type] + 1 },
  };
  return { deliver: false, state: next };
}
```

### Pattern 3: `rateLimitedNotify` — fold `context` into the existing options bag (Discretion)

**What:** Add `context?: string` as a new optional key on the SAME 3rd-parameter object that already
carries the test-only `{ now?, send? }` seam (`services/rate-limit.ts:78-81`), rather than inserting
a new positional parameter. This is fully backward-compatible: every existing call to
`rateLimitedNotify(type, options, { now, send })` in `tests/services/rate-limit.test.ts` keeps
compiling and behaving identically (context defaults to `undefined`), and the 4 non-chat call sites
(`replies.ts`, `zaps.ts`) require ZERO code changes (they never pass a 3rd argument at all).
**When to use:** `services/rate-limit.ts`'s `rateLimitedNotify` signature.
**Example:**
```typescript
// Source: services/rate-limit.ts:78-81 (existing InjectedDeps, to extend)
type InjectedDeps = {
  /** D7-03: the per-context key (encodeGroupPointer(group) or DM counterparty
   *  pubkey). Absent for replies/zaps and any other non-chat type -- passing
   *  it there would be silently harmless (contextLimitFor returns 0 for
   *  those types) but is deliberately never done, per D7-01. */
  context?: string;
  now?: number;
  send?: typeof sendNotification;
};

// Source: services/rate-limit.ts:101-122 (existing rateLimitedNotify, to modify)
export async function rateLimitedNotify(
  type: NotificationType,
  options: Parameters<typeof sendNotification>[0],
  { context, now, send }: InjectedDeps = {}, // `context` NEW; `now`/`send` unchanged
): Promise<void> {
  const effectiveNow = now ?? Date.now() / 1000;
  const effectiveSend = send ?? sendNotification;
  const { rateLimit } = getConfig();

  const result = evaluate(
    state,
    type,
    effectiveNow,
    { ...rateLimit, window: clampWindowSeconds(rateLimit.window) },
    context, // NEW 5th arg threaded straight through
  );
  state = result.state;

  if (result.deliver) {
    await effectiveSend(options);
    return;
  }
  log("Notification accumulated for grouped overflow summary", { type });
  // Deliberately does NOT log `context` -- logging a raw group identifier or
  // DM counterparty pubkey here would be a mild privacy regression relative
  // to Phase 6's existing log line, which only ever logged `{ type }`.
}
```

### Pattern 4: Config + migration extension (D7-05/06) — top-level siblings of `perType`

**What:** `perGroup`/`perDm` are added as NEW top-level scalar fields on `AppConfig["rateLimit"]`,
siblings of the EXISTING `perType` object — NOT nested inside it, and NOT the same field as
`perType.groups`/`perType.messages`. This distinction matters: `perType.groups` already means "max
group notifications across ALL groups combined per window" (Phase 6); `perGroup` means "max
notifications from any ONE group per window" (this phase) — two different axes that must not be
conflated.
**When to use:** `services/config.ts`'s `AppConfig`, `DEFAULT_RATE_LIMIT_CONFIG`, and `migrateConfig`.
**Example:**
```typescript
// Source: services/config.ts:68-84 (existing AppConfig["rateLimit"], to extend)
rateLimit: {
  window: number;
  global: number;
  perType: { replies: number; zaps: number; messages: number; groups: number };
  /** Default per-NIP-29-group limit (D7-05/06); 0 = unlimited. */
  perGroup: number;
  /** Default per-DM-counterparty limit (D7-05/06); 0 = unlimited. */
  perDm: number;
};

// Source: services/config.ts:104-120 (existing DEFAULT_RATE_LIMIT_CONFIG, to extend)
export const DEFAULT_RATE_LIMIT_CONFIG: AppConfig["rateLimit"] = {
  window: 60,
  global: 20,
  perType: { replies: 5, zaps: 5, messages: 5, groups: 5 },
  perGroup: 3, // D7-06
  perDm: 5,    // D7-06
};

// Source: services/config.ts:277-334 (existing rateLimit migration block, to
// extend). This mirrors the EXISTING `global` backfill line-for-line -- no
// new clamp constant needed (unlike `window`, 0 is a valid, already-handled
// "unlimited" value for both new fields, exactly like `global`/`perType.*`).
if (!isValidNonNegativeNumber(parsed.rateLimit.perGroup))
  parsed.rateLimit.perGroup = DEFAULT_RATE_LIMIT_CONFIG.perGroup;
if (!isValidNonNegativeNumber(parsed.rateLimit.perDm))
  parsed.rateLimit.perDm = DEFAULT_RATE_LIMIT_CONFIG.perDm;
```

### Pattern 5: Sync extension (D7-05) — same "absent → local defaults, never 0" fallback as Pitfall #6

**What:** `SyncedPrefs.rateLimit` gains `perGroup`/`perDm`; `serializePrefs` includes them;
`asRateLimit` coerces them via the SAME `asNonNegativeInt` helper already used for `global`/
`perType.*`, falling back to `DEFAULT_RATE_LIMIT_CONFIG.perGroup`/`.perDm` when absent (a pre-Phase-7
peer's synced payload has no `rateLimit.perGroup`/`.perDm` keys at all) — never to `0`. This is the
EXACT SAME reasoning Phase 6's own RESEARCH.md Pitfall #6 already documented for `global`/`perType`,
now extended to the 2 new fields.
**When to use:** `helpers/preferences.ts`.
**Example:**
```typescript
// Source: helpers/preferences.ts:219-251 (existing asRateLimit, to extend)
return {
  window: clampWindowSeconds(asNonNegativeInt(source.window, DEFAULT_RATE_LIMIT_CONFIG.window)),
  global: asNonNegativeInt(source.global, DEFAULT_RATE_LIMIT_CONFIG.global),
  perType: { /* unchanged */ },
  perGroup: asNonNegativeInt(source.perGroup, DEFAULT_RATE_LIMIT_CONFIG.perGroup), // NEW
  perDm: asNonNegativeInt(source.perDm, DEFAULT_RATE_LIMIT_CONFIG.perDm),         // NEW
};
// PREFS_VERSION (helpers/preferences.ts:38) bumps 3 -> 4, following the SAME
// "forward-compat marker, not the fallback's actual detection mechanism"
// convention already documented for the 2 -> 3 bump.
```

### Pattern 6: UI — a second, distinctly-named number input per page (D7-08)

**What:** `pages/groups.tsx` and `pages/messages.tsx` each ALREADY have one rate-limit number input
bound to the Datastar signal `rateLimitPerType` (mapping to `rateLimit.perType.groups` /
`.perType.messages` respectively, `pages/groups.tsx:238-255`, `pages/messages.tsx:111-128`). The new
field needs a DIFFERENT signal name — reusing `rateLimitPerType` for the new field would silently
overwrite/confuse the existing per-type field's PATCH handling. Recommend `rateLimitPerGroup` /
`rateLimitPerDm` (matches the config field names exactly, avoiding any name-mapping ambiguity).
**When to use:** Both pages' view function (new `<input>` block) and PATCH handler (new signal read
+ clamp, mirroring the EXISTING `rawRateLimitPerType` clamp block verbatim).
**Example:**
```tsx
// Source: pages/groups.tsx:238-255 (existing block, pattern to copy for the NEW field)
<div class="form-group">
  <label for="rateLimitPerGroup" style="font-weight: bold; margin-bottom: 8px; display: block;">
    Default Per-Group Rate Limit
  </label>
  <input
    type="number"
    id="rateLimitPerGroup"
    data-bind="rateLimitPerGroup"
    min="0"
    value={String(currentConfig.rateLimit.perGroup)}
  />
  <div class="help-text">
    Max notifications from any single group per window (applied automatically
    to newly-joined groups). 0 = unlimited.
  </div>
</div>
```
```typescript
// Source: pages/groups.tsx:301,341-347,359-365 (existing rateLimitPerType
// PATCH handling, pattern to copy for rateLimitPerGroup)
const rawRateLimitPerGroup = Number(signals.rateLimitPerGroup);
// ... inside the try block, alongside the existing rawRateLimitPerType clamp:
const rateLimitPerGroup =
  Number.isFinite(rawRateLimitPerGroup) && rawRateLimitPerGroup >= 0
    ? Math.floor(rawRateLimitPerGroup)
    : currentConfig.rateLimit.perGroup;
// ... merged into newConfig.rateLimit as a TOP-LEVEL sibling of perType (not nested inside it):
rateLimit: {
  ...currentConfig.rateLimit,
  perGroup: rateLimitPerGroup, // NEW, top-level
  perType: { ...currentConfig.rateLimit.perType, groups: rateLimitPerType }, // EXISTING, unchanged
},
```
`pages/messages.tsx` mirrors this exactly with `rateLimitPerDm` / `currentConfig.rateLimit.perDm`.

### Anti-Patterns to Avoid

- **Storing a per-context OVERFLOW count (e.g. `overflowByContext: Record<string, number>`):**
  D7-07 explicitly requires per-context overflow to roll into the EXISTING per-type `overflow`
  record only. Adding a parallel per-context overflow structure — even if never surfaced in the
  summary text today — creates a data structure that COULD leak group/DM-identifying detail in a
  future refactor, contradicting the "structurally incapable of holding identifying detail" design
  principle Phase 6 already established for `overflow`.
- **Computing `underContext` from a DIFFERENT `rollIfExpired` call than `underType`/`underGlobal`:**
  All three gates must read from the SAME `rolled` state produced by ONE `rollIfExpired` call at the
  top of `evaluate()` — never call `rollIfExpired` twice, which could produce inconsistent
  windowStart values if `now` is somehow evaluated twice.
- **Reusing the `rateLimitPerType` Datastar signal name for the new per-context field:** The existing
  signal already exists on both pages bound to a DIFFERENT config field (`perType.groups`/
  `perType.messages`). A same-named new input would silently break the existing PATCH handler's
  `Number(signals.rateLimitPerType)` read (only one wins) — always use a distinctly-named signal
  (`rateLimitPerGroup`/`rateLimitPerDm`).
- **Nesting `perGroup`/`perDm` inside `perType`:** `perType` is keyed by `NotificationType`
  (`replies|zaps|messages|groups`) and represents a DIFFERENT axis ("total across all instances of
  this type"). `perGroup`/`perDm` are top-level siblings representing "per single instance of a
  chat-type context." Nesting them inside `perType` would require inventing non-existent
  `NotificationType` members or awkward dual-purpose keys — keep them as separate top-level fields.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-context state eviction over a long-lived process with many groups/DMs | An LRU cache, a per-entry TTL/expiry timestamp, or a periodic cleanup sweep for the `contexts` map | The EXISTING tumbling-window reset (`rollIfExpired`/`createRateLimitState`, already in `services/rate-limit-accounting.ts`) — add `contexts: {}` to the SAME reset | D7-02 explicitly asks for exactly this ("pruned by the window like the per-type buckets"); the window already resets everything else atomically, so piggy-backing `contexts` onto it is zero new code, zero new magic numbers, and zero new test surface for eviction correctness |
| Generic keyed rate-limiting (a "rate limit per arbitrary key" library) | An npm per-key rate-limiter package `[ASSUMED]` | The existing hand-rolled `evaluate()` extended with one more `Record<string, number>` field | Same reasoning as Phase 6's own audit: the domain-specific composition (context AND type AND global, with overflow rolling UP into per-type only, never per-context) is the actual complexity, not the counting arithmetic — no generic package expresses "3-tier most-restrictive-wins with asymmetric overflow granularity" out of the box |

**Key insight:** This phase adds almost no NEW complexity — it is the SAME reset mechanism, the SAME
increment-only-in-the-deliver-branch discipline, and the SAME "0 = unlimited" pattern Phase 6 already
built, applied to one more dimension. The only genuinely new idea is the composite `${type}:${context}`
key and the observation that its lifecycle can piggy-back on the existing window tumble for free.

## Common Pitfalls

### Pitfall 1: Do not touch the flush-timer's `distinctUntilChanged`/`clampWindowSeconds` pipeline

**What goes wrong:** A change to `AppConfig.rateLimit` (adding `perGroup`/`perDm`) is implemented by
also touching `services/rate-limit.ts:163-175`'s `configValue("rateLimit").pipe(map(...),
distinctUntilChanged(), switchMap(...))` block, e.g. "to make sure the timer picks up the new
fields."
**Why it happens:** Any change to the `rateLimit` config shape can look like it warrants touching the
flush-timer subscription that reads `configValue("rateLimit")`.
**How to avoid:** This pipeline projects ONLY `clampWindowSeconds(cfg.window)` before
`distinctUntilChanged()` — it was DELIBERATELY built this way (per the code's own comment, "any
unrelated write would restart the flush countdown from zero") specifically so that unrelated
`rateLimit` sub-field changes (whitelist edits, or now `perGroup`/`perDm` edits) do NOT restart the
flush timer. This is a FIX Phase 6 already shipped (CR-01) — this phase's `perGroup`/`perDm` fields
are exactly the kind of "unrelated write" this code already correctly ignores. Leave lines 163-175
completely untouched.
**Warning signs:** Any diff touching `services/rate-limit.ts`'s bottom `configValue("rateLimit")...`
block.

### Pitfall 2: Do not add a `MIN_PER_GROUP`/`MAX_PER_GROUP`-style clamp constant

**What goes wrong:** Copying the `MIN_WINDOW_SECONDS`/`MAX_WINDOW_SECONDS`/`clampWindowSeconds`
pattern (`services/rate-limit-accounting.ts:60-71`) for `perGroup`/`perDm`, reasoning "window needed
a clamp, so these numeric fields probably do too."
**Why it happens:** Superficial pattern-matching to the most recently-read code in the same file.
**How to avoid:** `window`'s clamp exists SPECIFICALLY because `window=0` breaks the modulo/roll
arithmetic in `rollIfExpired` (every call rolls to a fresh state, permanently defeating rate
limiting). `perGroup`/`perDm` have NO equivalent arithmetic hazard at `0` — `0` is a normal,
already-correctly-handled "unlimited" sentinel via the SAME `contextLimit === 0` check `global`/
`perType.*` already use. Reuse `isValidNonNegativeNumber`/`asNonNegativeInt` verbatim; do not invent
a new clamp function or bounds constants.
**Warning signs:** A new exported `MIN_PER_GROUP`/`MAX_PER_DM` constant, or a call to
`clampWindowSeconds`-style logic applied to `perGroup`/`perDm`.

### Pitfall 3: Module-level state reset discipline (Phase 6's Pitfall 2, unchanged, still applies)

**What goes wrong:** A new test file (or an added test in `tests/services/rate-limit.test.ts`) that
exercises `rateLimitedNotify` with a `context` argument forgets to call `resetRateLimitState(now)`
at the start of the case, and leaks a populated `contexts` map into the next test in the same `bun
test` process (Bun shares one module cache across the whole run).
**Why it happens:** Same root cause Phase 6 already documented — `services/rate-limit.ts`'s module-
level `state` variable persists for the process lifetime.
**How to avoid:** Every new test that imports `services/rate-limit.ts` (not the pure accounting
module) MUST call `resetRateLimitState(now)` first, exactly like the existing tests in
`tests/services/rate-limit.test.ts` already do. Tests exercising ONLY the new `contexts`/`evaluate()`
logic should prefer importing `services/rate-limit-accounting.ts` directly and constructing state
via `createRateLimitState(now)`, per-case, with zero shared state risk at all (the stronger, existing
`tests/services/rate-limit-accounting.test.ts` pattern).
**Warning signs:** A new test file importing `services/rate-limit.ts` without a `resetRateLimitState`
call at the top of each `test(...)`.

### Pitfall 4: Both DM transports must share ONE per-context bucket per counterparty

**What goes wrong:** Treating the NIP-04 send site (`messages.ts:224`) and the NIP-17 send site
(`messages.ts:318`) as needing separately-keyed context buckets, e.g. by accidentally prefixing one
of them with a transport tag.
**Why it happens:** They are two different code paths in the same file (mirrors Phase 6's own
Pitfall #4 about the coarse `"messages"` type — the SAME reasoning extends one level deeper here).
**How to avoid:** Both sites already pass `type: "messages"` (Phase 6, unchanged); the NEW `context`
must be the RAW counterparty pubkey with NO transport-specific decoration, so a user who receives
both a NIP-04 and a NIP-17 message from the SAME pubkey within one window correctly shares ONE
`"messages:<pubkey>"` bucket — this is the intended behavior (D7-01: "Both DM transports... key by
the DM counterparty"), not a bug to guard against.
**Warning signs:** A context key like `"messages:nip04:<pubkey>"` or `"messages:nip17:<pubkey>"`.

### Pitfall 5: Additive migration — do not let the new per-context defaults surprise-suppress

**What goes wrong:** An existing (post-Phase-6) user upgrades and a very active group/DM they were
previously receiving every notification from suddenly gets throttled harder than before, because the
new `perGroup=3`/`perDm=5` defaults are the FIRST per-context limit ever applied to that
group/conversation.
**Why it happens:** D7-06 explicitly sets these defaults for EVERY existing group/DM the moment this
phase ships (no opt-in period) — this is intentional (D7-02's whole point is "automatic on join,"
which for EXISTING groups/DMs effectively means "automatic on next notification after upgrade").
**How to avoid:** This is the accepted, explicit D7-06 decision (mirrors Phase 6's own Pitfall #5) —
ship the defaults as specified, but the plan MUST add a CHANGELOG entry describing this specific
behavior change (a user with a very chatty single group may now see MORE throttling/grouping than
before, even if their per-type/global totals haven't changed), and MUST make the `0` = unlimited
escape hatch visible in both new UI fields' help text.
**Warning signs:** No CHANGELOG entry mentioning per-context/per-group/per-DM defaults; no "0 =
unlimited" help text on the two new inputs.

### Pitfall 6: Sync fallback for `perGroup`/`perDm` — absent means local defaults, NEVER 0

**What goes wrong:** Copying `asRateLimit`'s existing `global`/`perType` fallback verbatim is
actually CORRECT here (unlike Phase 6's Pitfall #6, which warned against copying
`asMessagesCategories`' pattern) — but the risk is the OPPOSITE mistake: someone "simplifies" by
spreading `raw.rateLimit` wholesale (`{ ...DEFAULT_RATE_LIMIT_CONFIG, ...raw.rateLimit }`) instead of
coercing each field independently via `asNonNegativeInt`, which would let a malformed/negative
`perGroup`/`perDm` value from an untrusted decrypted payload pass through unvalidated.
**Why it happens:** A raw object-spread "looks like" it achieves the same "unspecified fields fall
back to defaults" result, but skips the ASVS V5 coercion Phase 6's `asRateLimit` deliberately performs
per-field.
**How to avoid:** Extend `asRateLimit`'s existing per-field `asNonNegativeInt(source.X,
DEFAULT_RATE_LIMIT_CONFIG.X)` calls with two more lines for `perGroup`/`perDm` — never spread
`source`/`raw.rateLimit` wholesale into the return value.
**Warning signs:** A `...(raw.rateLimit as object)` spread anywhere in `asRateLimit`.

### Pitfall 7: The 2 UI pages already have a rate-limit input — do not collide with it

**What goes wrong:** Assuming "add a rate-limit field to `pages/groups.tsx`" means adding the FIRST
rate-limit input to that page — it does not; both `pages/groups.tsx` (`:238-255`) and
`pages/messages.tsx` (`:111-128`) already have ONE rate-limit number input from Phase 6
(`rateLimitPerType`, mapped to `perType.groups`/`perType.messages`). This phase adds a SECOND,
distinctly-named field to each page.
**Why it happens:** Phase 6's RESEARCH.md's own Pitfall #7 was about `pages/notifications.tsx`
having NO PATCH route at all — a superficial read of "add a rate-limit UI field" could incorrectly
assume the SAME "first field on this page" situation applies to `groups.tsx`/`messages.tsx`, when in
fact they already have Phase 6's per-type field.
**How to avoid:** Read `pages/groups.tsx:238-255` and `pages/messages.tsx:111-128` before writing the
plan — the existing `rateLimitPerType` field/PATCH-clamp/merge code is the reuse pattern; the new
field is ADDITIONAL markup + an additional PATCH clamp + an additional top-level (not
`perType`-nested) merge, with a NEW signal name.
**Warning signs:** A plan step that says "add the rate-limit section to `pages/groups.tsx`" (singular,
implying it doesn't exist yet) rather than "add a SECOND rate-limit field."

## Code Examples

Verified patterns read directly from the current repository this session (not third-party docs — no
Context7/official-docs lookup was needed, since no new library/external API surface is introduced):

### Existing `evaluate` (Phase 6, unmodified logic being extended)
```typescript
// Source: services/rate-limit-accounting.ts:143-172
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
  if (underType && underGlobal) { /* deliver: true, increment both counters */ }
  /* else: overflow[type]++, deliver: false */
}
```

### Existing context-source values at the 3 chat call sites
```typescript
// Source: notifications/groups.ts:8,71,119,143 -- GroupPointer + encodeGroupPointer
// already imported/in scope; group.id/group.relay available via `group`.
// Source: notifications/messages.ts:127,172 (NIP-04) -- `sender` from
// getLegacyMessageReceiver(event, pubkey), destructured into subscribe().
// Source: notifications/messages.ts:264,268 (NIP-17) -- `const sender = rumor.pubkey;`
```

### Existing config migration block being mirrored (D7-05/06)
```typescript
// Source: services/config.ts:297-333 -- the isValidNonNegativeNumber guard
// and the existing `global`/`perType.*` backfill loop this phase's
// `perGroup`/`perDm` backfill lines slot directly alongside.
const isValidNonNegativeNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
if (!isValidNonNegativeNumber(parsed.rateLimit.global))
  parsed.rateLimit.global = DEFAULT_RATE_LIMIT_CONFIG.global;
```

### Existing sync coercion helper being reused (D7-05)
```typescript
// Source: helpers/preferences.ts:146-150
function asNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return fallback;
  return Math.floor(value);
}
```

## State of the Art

Not applicable in the "framework version drift" sense — this phase is a small extension of entirely
internal, hand-rolled application logic with no external API surface. No deprecated-API risk (no new
RxJS operators are introduced beyond what Phase 6 already uses).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Literal reading of D7-06: `perGroup: 3`, `perDm: 5`, sharing the EXISTING `window` (default 60s) — no new window field | Standard Stack, "Config shape" | This is D7-06's own stated target ("planning may tune exact numbers"), not independently verified against real per-group/per-DM traffic volume for this app. Mitigated by the `0`=unlimited escape hatch on both new fields and the required CHANGELOG entry (Pitfall #5). |
| A2 | `${type}:${context}` composite key naming — not strictly required for collision-avoidance (verified `encodeGroupPointer` output always contains a literal `'` never present in a hex pubkey) but recommended for clarity/future-proofing | Architecture Patterns §2, Summary | Low risk either way — even a bare `context` key (no `type:` prefix) would not collide in practice given the two source formats' structurally disjoint character sets; the prefix is a defensive/readability choice, not a correctness requirement. |
| A3 | No npm package exists that better fits this phase's "context AND type AND global, asymmetric overflow granularity" composition than hand-rolling the extension | Don't Hand-Roll | Same class of assumption as Phase 6's own A2 — based on the narrowness of the exact composition needed, not a fresh package-registry search this session (no new package is being considered either way, so this is low-stakes). |

**If this table is empty:** N/A — see above.

## Open Questions

1. **Exact default integers (perGroup=3, perDm=5) — final tuning**
   - What we know: D7-06 states these as targets, explicitly leaving exact numbers to planning
     ("planning may tune").
   - What's unclear: Whether these specific integers are calibrated against any real usage pattern
     for this app, or are simply "sensible chat defaults" chosen for symmetry with Phase 6's own
     per-type defaults (5/min).
   - Recommendation: Use the literal D7-06 values (`perGroup: 3, perDm: 5`, shared `window: 60`) —
     this is the simplest, most direct reading of the already-accepted decision, and both fields ship
     with a visible `0` = unlimited override if a user finds them too strict.

2. **Whether `rateLimitedNotify`'s log line on rejection should mention that a context gate (vs.
   type/global) caused the rejection, for operator debugging**
   - What we know: The existing log line (`services/rate-limit.ts:121`) logs only `{ type }`, never
     the reason (type-limited vs. global-limited) even today.
   - What's unclear: Whether adding a `reason: "context" | "type" | "global"` field to this log call
     (still never logging the raw `context` value itself, to avoid a privacy regression) would help
     debugging without violating D7-07's counts-only guarantee (this is a LOG line, not the
     user-facing summary, so D7-07 doesn't technically constrain it — but the existing code already
     chose NOT to log this level of detail for type/global).
   - Recommendation: Leave the log line as-is (mirrors existing behavior exactly, avoids scope creep)
     unless the planner decides operator-debuggability is worth the small additional log verbosity;
     this is a nice-to-have, not a D7-xx requirement.

## Environment Availability

No new external dependency, service, or CLI tool is introduced by this phase — it extends the
existing in-process rate limiter (Phase 6) with zero new I/O surface.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (Bun's built-in test runner) `[VERIFIED: package.json, bunfig.toml]` |
| Config file | `bunfig.toml` (existing — unchanged) |
| Quick run command | `bun test tests/services/rate-limit-accounting.test.ts tests/services/rate-limit.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D7-01/03 | `evaluate()` called without a `context` arg behaves byte-identical to pre-Phase-7 (regression) | unit | `bun test tests/services/rate-limit-accounting.test.ts` (existing cases, must still pass unmodified) | ✅ existing |
| D7-02 | First `evaluate()` call for a brand-new `${type}:${context}` key treats it as count 0 (lazy create, no separate registration) | unit | `bun test tests/services/rate-limit-accounting.test.ts -t "lazy"` | ❌ Wave 0 |
| D7-02 | `contexts` map resets to `{}` on the SAME window rollover as `globalCount`/`perTypeCount`/`overflow` (pruning) | unit | `bun test tests/services/rate-limit-accounting.test.ts -t "prune"` | ❌ Wave 0 |
| D7-04 | Table test: context-under/type-over, context-over/type-under, all-under, any-one-over → correct `deliver` in each combination (most-restrictive-wins) | unit (table test) | `bun test tests/services/rate-limit-accounting.test.ts -t "layering"` | ❌ Wave 0 |
| D7-01 | One busy group hitting its `perGroup` limit does not block a DIFFERENT group's notifications in the same window (per-context isolation) | unit | `bun test tests/services/rate-limit-accounting.test.ts -t "isolation"` | ❌ Wave 0 |
| D7-04 | `perGroup`/`perDm` = 0 always passes the context gate regardless of count (0=unlimited) | unit (table test) | `bun test tests/services/rate-limit-accounting.test.ts -t "unlimited"` | ❌ Wave 0 |
| D7-07 | A context-rejected notification increments `overflow[type]` only — `contexts[key]` is unchanged on rejection, no per-context overflow structure exists | unit | `bun test tests/services/rate-limit-accounting.test.ts -t "overflow"` | ❌ Wave 0 |
| D7-03 | Both DM transports (NIP-04/NIP-17) pass the SAME `context` (raw counterparty pubkey, no transport tag) — grep/code-review check, not a runtime assertion | manual code check | grep-based check in code review | N/A |
| D7-05 | `migrateConfig` backfills `perGroup`/`perDm` (missing/null/malformed) with `DEFAULT_RATE_LIMIT_CONFIG` values, idempotent, preserves explicit `0` | unit | `bun test tests/services/config.test.ts -t "perGroup\|perDm"` | ❌ Wave 0 |
| D7-05 | `serializePrefs`/`sanitizeSyncedPrefs`/`mergePrefs` round-trip `perGroup`/`perDm`; old-peer payload (absent keys) falls back to LOCAL safe defaults, NOT 0 (Pitfall #6) | unit | `bun test tests/helpers/preferences.test.ts -t "perGroup\|perDm"` | ❌ Wave 0 |
| D7-09 | Flush-timer's `distinctUntilChanged`/`clampWindowSeconds` pipeline is UNCHANGED — a `perGroup`/`perDm`-only config write does NOT restart the flush interval (regression guard) | unit/integration | `bun test tests/services/rate-limit.test.ts -t "distinctUntilChanged\|timer"` (existing Phase 6 coverage; add one case asserting a perGroup/perDm-only write doesn't re-trigger `switchMap`) | ❌ Wave 0 (new case) |

### Sampling Rate

- **Per task commit:** `bun test tests/services/rate-limit-accounting.test.ts tests/services/rate-limit.test.ts tests/services/config.test.ts tests/helpers/preferences.test.ts`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green before `/gsd-verify-work`, plus `bun run lint` (`tsc --noEmit`).

### Wave 0 Gaps

- [ ] `tests/services/rate-limit-accounting.test.ts` — per-context isolation, lazy-create, prune,
  most-restrictive-wins layering table, overflow-rollup, 0=unlimited (D7-01/02/04/07)
- [ ] `tests/services/rate-limit.test.ts` — `rateLimitedNotify` threading `context` through to
  `evaluate`; a regression case confirming a `perGroup`/`perDm`-only config write does not restart the
  flush timer
- [ ] `tests/services/config.test.ts` — `migrateConfig` cases for `perGroup`/`perDm`
- [ ] `tests/helpers/preferences.test.ts` — `perGroup`/`perDm` sync round-trip + old-peer fallback
- Framework install: none — `bun:test` already configured.

**UAT-only (not automatable without a live signer/relay):**
- Live burst in a busy group right after joining it → confirm the group's own messages start being
  grouped into the counts-only overflow summary independently of other groups/types, once its
  `perGroup` default is hit.
- A new DM conversation from a stranger sending several rapid messages → confirm the `perDm` default
  throttles that conversation independently of other DM conversations and of the `perType.messages`
  total.
- The two new default-limit UI fields on `/groups` and `/messages` — visually confirm they render
  with correct current values, save via PATCH, persist across reload, and show "0 = unlimited" help
  text, without disturbing the existing `rateLimitPerType` field on either page.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Out of scope — no new route auth surface |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A |
| V5 Input Validation | yes | New `perGroup`/`perDm` fields at 3 input surfaces (config load/migration, kind-30078 sync, PATCH) must reuse the EXISTING `isValidNonNegativeNumber`/`asNonNegativeInt`/inline-clamp coercion pattern already applied to `global`/`perType.*` — never trust a raw decrypted-payload or client-submitted number verbatim |
| V6 Cryptography | no | No new crypto surface — `perGroup`/`perDm` ride inside the EXISTING NIP-44-encrypted kind-30078 sync event |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A malformed/malicious decrypted `SyncedPrefs.rateLimit.perGroup`/`.perDm` (e.g. negative, NaN, string) reaching `evaluate()`'s context-gate arithmetic | Tampering | `asRateLimit`'s per-field `asNonNegativeInt` coercion, extended to the 2 new fields (Pitfall #6) — never spread the raw payload wholesale |
| A PATCH request submitting a negative/non-numeric `rateLimitPerGroup`/`rateLimitPerDm` signal | Tampering | Same inline clamp pattern already used for `rateLimitPerType` on both pages (`pages/groups.tsx:341-347`, `pages/messages.tsx:196-202`), applied to the 2 new fields |
| An attacker-controlled peer (via a compromised signer/nsec) publishing `rateLimit.perGroup: 0`/`perDm: 0` to disable per-context throttling via sync | Tampering | No new mitigation needed beyond D2-08's existing high-water-mark (`isNewerPrefs`) + self-encryption — this is the SAME pre-existing class of risk Phase 6's own audit already flagged as "not a new attack surface introduced by this phase" (a signer compromise already lets an attacker rewrite whitelists/blacklists via the same sync mechanism) |

## Sources

### Primary (HIGH confidence — read directly from the repository this session)

- `services/rate-limit-accounting.ts` (full file, 209 lines) — `NotificationType`, `RateLimitConfig`,
  `RateLimitState`, `createRateLimitState`, `rollIfExpired`, `evaluate`, `formatOverflowSummary`,
  `flushOverflow`, `clampWindowSeconds`/`MIN_WINDOW_SECONDS`/`MAX_WINDOW_SECONDS` — the exact current
  implementation this phase extends
- `services/rate-limit.ts` (full file, 176 lines) — `rateLimitedNotify`, `runFlush`,
  `resetRateLimitState`, `InjectedDeps`, the `distinctUntilChanged`-guarded flush timer
- `notifications/groups.ts` (full file) — the group `rateLimitedNotify` call site (:143), `group`/
  `encodeGroupPointer` scope confirmed
- `notifications/messages.ts` (full file) — both DM `rateLimitedNotify` call sites (:224 NIP-04,
  :318 NIP-17), `sender`/`rumor.pubkey` scope confirmed
- `services/config.ts` (full file) — `AppConfig.rateLimit`, `DEFAULT_RATE_LIMIT_CONFIG`,
  `migrateConfig`'s existing `rateLimit` backfill block and `isValidNonNegativeNumber` guard
- `helpers/preferences.ts` (full file) — `SyncedPrefs.rateLimit`, `serializePrefs`, `asNonNegativeInt`,
  `asRateLimit`, `sanitizeSyncedPrefs`, `mergePrefs`, `PREFS_VERSION`
- `pages/groups.tsx`, `pages/messages.tsx` (full files) — the EXISTING `rateLimitPerType` field +
  PATCH clamp pattern on both pages (confirmed already present, not a first-time addition)
- `tests/services/rate-limit-accounting.test.ts`, `tests/services/rate-limit.test.ts` — existing test
  conventions (pure-module direct import vs. impure-module `resetRateLimitState` discipline)
- `node_modules/applesauce-common/dist/helpers/groups.js` / `.d.ts` — `GroupPointer` shape
  (`{ id, relay, name? }`), `encodeGroupPointer`'s exact output format
  (`` `${hostname}'${groupId}` ``) — verified for the context-key-collision reasoning in the Summary
- `.planning/phases/06-.../06-CONTEXT.md`, `.planning/phases/07-.../07-CONTEXT.md` — the locked D6/D7
  decisions this research is scoped by
- `.planning/STATE.md` — Phase 6 completion note (the 2 fixed bugs: flush-timer restart-starvation,
  `window:0` busy-loop — confirmed NOT touched by this phase's extension)

### Secondary (MEDIUM confidence)

- `.planning/phases/06-.../06-RESEARCH.md` — Phase 6's original (pre-execution) research; used only
  to confirm design intent/history, superseded by direct source reads above wherever they differ
- `.planning/phases/01-.../01-CONTEXT.md`, `.planning/phases/02-.../02-CONTEXT.md` — group-pointer and
  rules-sync context this phase's canonical_refs point to

### Tertiary (LOW confidence)

- None — no WebSearch/external documentation lookup was performed this session, since this phase
  introduces no new library or external API surface. All claims are either `[VERIFIED]` against a
  direct source read this session or explicitly logged in the Assumptions Log above.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new dependency; existing `rxjs`/`bun:test` versions unchanged since Phase 6
- Architecture: HIGH — every pattern cited traces to a specific file:line read this session, against
  the ACTUAL current (post-Phase-6-execution) source, not a prior research draft
- Pitfalls: HIGH — all 7 pitfalls derive from direct reads of the current implementation (the flush
  timer's `distinctUntilChanged` guard, the existing `rateLimitPerType` UI fields, the existing
  `asRateLimit`/`asNonNegativeInt` coercion pattern); MEDIUM for Pitfall #5's exact default-tuning
  concern (depends on real-world per-group/per-DM traffic not measurable this session, same caveat
  Phase 6's own research logged for its per-type/global defaults)

**Research date:** 2026-07-13
**Valid until:** 30 days (stable, hand-rolled internal logic with no external dependency to go stale)
— re-verify only if `services/rate-limit.ts`/`services/rate-limit-accounting.ts` are substantially
refactored, or if Phase 6's verification (currently deferred per `.planning/STATE.md`) surfaces new
bugs in the underlying limiter before this phase executes.
