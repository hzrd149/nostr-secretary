/**
 * Pure, clock-injected accounting core for Phase 6's notification rate
 * limiter. Every function here takes `now: number` (unix seconds) as an
 * explicit parameter and never calls `Date.now()`/`unixNow()` internally --
 * this mirrors notifications/dm-notification-gate.ts's injected-dependency
 * discipline and keeps this module importable directly from tests with zero
 * network/timer risk. This file imports nothing from services/nostr.ts,
 * services/config.ts, or services/ntfy.ts (RESEARCH Pitfall 2); the impure
 * shell that owns module-level state, the RxJS flush timer, and the actual
 * sendNotification calls lives in services/rate-limit.ts (Plan 03).
 *
 * The window model is a tumbling (fixed-interval counter + reset) window,
 * not a sliding log of individual timestamps -- CONTEXT.md's D6-02 uses
 * "sliding-window" wording, but the actual required behavior (D6-04/05:
 * accumulate overflow, flush once at window end, reset) has no natural
 * "window end" moment on a true sliding log, so a tumbling counter is the
 * correct reconciliation (see RESEARCH Pitfall 1).
 */

/** The four coarse notification categories rate limiting is scoped to
 * (D6-03). Both the NIP-04 and NIP-17 DM send sites share the single
 * "messages" bucket -- there is no 5th/6th type for DM sub-protocols. */
export type NotificationType = "replies" | "zaps" | "messages" | "groups";

/**
 * The rate-limit configuration: a window duration and both a global limit
 * and a per-type limit for each NotificationType. A limit of `0` means
 * unlimited (disabled) for that gate (D6-09) -- this applies independently
 * to `global` and to each entry in `perType`.
 */
export type RateLimitConfig = {
  /** Window duration in seconds. */
  window: number;
  /** Global limit across all types per window; 0 = unlimited. */
  global: number;
  /** Per-type limit per window; 0 = unlimited for that type. */
  perType: Record<NotificationType, number>;
};

/**
 * In-memory state for the current tumbling window: when it started, how
 * many notifications have been delivered (globally and per type), and how
 * many were withheld (overflow) per type. `overflow` is strictly
 * `Record<NotificationType, number>` -- integer counts only. It is
 * structurally incapable of holding an NtfyNotificationOptions or any
 * message/plaintext string, which is the primary guarantee that the grouped
 * summary can never carry DM plaintext (D6-10; RESEARCH Pitfall 3). This
 * shape must never be widened.
 */
export type RateLimitState = {
  /** Unix seconds marking the start of the current window. */
  windowStart: number;
  /** Notifications delivered so far this window, across all types. */
  globalCount: number;
  /** Notifications delivered so far this window, per type. */
  perTypeCount: Record<NotificationType, number>;
  /** Notifications withheld (not delivered) so far this window, per type. */
  overflow: Record<NotificationType, number>;
};

/** Human-readable label for each type, used by formatOverflowSummary. Static
 * text only -- never derived from event content, preserving the
 * counts-only guarantee (D6-10). */
const TYPE_LABELS: Record<NotificationType, string> = {
  replies: "new replies",
  zaps: "zaps",
  messages: "messages",
  groups: "group messages",
};

/**
 * Builds a fresh, all-zero RateLimitState keyed at `now`. This is the single
 * reset primitive reused both by flushOverflow (the window-end flush) and by
 * evaluate's internal window roll, so the two reset paths never disagree.
 */
export function createRateLimitState(now: number): RateLimitState {
  return {
    windowStart: now,
    globalCount: 0,
    perTypeCount: { replies: 0, zaps: 0, messages: 0, groups: 0 },
    overflow: { replies: 0, zaps: 0, messages: 0, groups: 0 },
  };
}

/**
 * Rolls to a fresh window (via createRateLimitState) once `now` has advanced
 * at least `windowSeconds` past `state.windowStart`; otherwise returns
 * `state` unchanged. This is the tumbling-window reset check that evaluate()
 * runs before applying its deliver-vs-accumulate decision.
 */
function rollIfExpired(
  state: RateLimitState,
  now: number,
  windowSeconds: number,
): RateLimitState {
  if (now - state.windowStart < windowSeconds) return state;
  return createRateLimitState(now);
}

/**
 * Decides whether a notification of `type` should be delivered now or
 * accumulated into the overflow count, then returns the updated state.
 * Rolls the window first if it has expired. A notification is delivered iff
 * BOTH its per-type count and the global count are under their configured
 * limits (D6-02); a limit of 0 disables that gate (always under, D6-09).
 * When either gate is at/over its limit, the notification is NOT delivered
 * but overflow[type] is incremented -- it is always accounted for, never
 * silently dropped (D6-04).
 */
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

/**
 * Formats the accumulated overflow into a single combined, human-readable
 * summary string covering only the non-zero counts (e.g. "47 new replies,
 * 12 group messages"), comma-joined. Returns `null` (never an empty string)
 * when every count is zero, so callers can gate a sendNotification call on
 * `summary !== null` instead of relying on services/ntfy.ts's own
 * required-non-empty-message check. Output contains only integer counts and
 * static per-type labels -- never event content (D6-10).
 */
export function formatOverflowSummary(
  overflow: Record<NotificationType, number>,
): string | null {
  const parts = (Object.keys(overflow) as NotificationType[])
    .filter((type) => overflow[type] > 0)
    .map((type) => `${overflow[type]} ${TYPE_LABELS[type]}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * The window-end flush: formats the current overflow into one combined
 * summary (or null if nothing overflowed) and returns a fresh, all-zero
 * state keyed at `now` -- the single window-end reset moment (D6-05). The
 * caller (services/rate-limit.ts) is responsible for delivering the summary
 * via a direct sendNotification call that bypasses the rate limiter itself
 * (D6-06); this pure function performs no I/O.
 */
export function flushOverflow(
  state: RateLimitState,
  now: number,
): { summary: string | null; nextState: RateLimitState } {
  return {
    summary: formatOverflowSummary(state.overflow),
    nextState: createRateLimitState(now),
  };
}
