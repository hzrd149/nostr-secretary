/**
 * The impure, module-level-state choke point for outbound-notification rate
 * limiting (D6-01). `rateLimitedNotify(type, options)` is a 1:1 drop-in
 * replacement for the 5 existing `sendNotification(...)` call sites in
 * notifications/{replies,zaps,messages,groups}.ts: it consults the pure
 * `evaluate()` (services/rate-limit-accounting.ts, Plan 01) against the
 * live `config.rateLimit` (services/config.ts, Plan 02) and this module's
 * own `state`, delivering via `sendNotification` only when under both the
 * per-type and global limits -- otherwise the notification is accumulated
 * into per-type overflow and NOT sent (D6-04).
 *
 * A config-driven RxJS flush timer (`configValue("rateLimit").pipe(
 * switchMap(cfg => interval(cfg.window * 1000)))`) fires at most once per
 * window and, when overflow accumulated, emits ONE combined grouped summary
 * via `sendNotification` DIRECTLY -- bypassing `rateLimitedNotify` entirely,
 * so the summary can never itself be rate-limited/suppressed (D6-05/D6-06).
 * The summary body is derived only from `formatOverflowSummary`'s
 * counts-only output -- it never carries DM plaintext, regardless of
 * `messages.sendContent` (D6-10).
 *
 * `state` is module-level and reassigned immutably on every evaluate()/
 * flushOverflow() call (never mutated in place) -- mirrors services/logs.ts's
 * module-level `let` precedent. `rateLimitedNotify` and `runFlush` accept an
 * optional trailing `{ now, send }` dependency-injection seam (defaulting to
 * the real clock and the real sendNotification) purely for test determinism,
 * mirroring this phase's inject-the-clock discipline (RESEARCH Pattern 2/3);
 * production callers never pass these. `resetRateLimitState` is a test-only
 * hook so tests/services/rate-limit.test.ts can reset state between cases
 * without relying on a mutated singleton persisting across the shared
 * `bun test` module cache (RESEARCH Pitfall 2).
 */
import { interval, switchMap } from "rxjs";
import { configValue, getConfig } from "./config";
import { log } from "./logs";
import { sendNotification } from "./ntfy";
import {
  createRateLimitState,
  evaluate,
  flushOverflow,
  type NotificationType,
  type RateLimitState,
} from "./rate-limit-accounting";

/** Module-level rate-limit state for the current tumbling window. Reassigned
 * immutably on every call to evaluate()/flushOverflow() -- never mutated in
 * place. Never imported directly by any test other than
 * tests/services/rate-limit.test.ts, which resets it via
 * resetRateLimitState() at the start of every case (RESEARCH Pitfall 2). */
let state: RateLimitState = createRateLimitState(Date.now() / 1000);

/**
 * Test-only hook: reassigns the module-level rate-limit state to a fresh,
 * all-zero state keyed at `now`. Exists so tests can reset state between
 * cases without relying on a mutated singleton persisting across the shared
 * `bun test` module cache.
 */
export function resetRateLimitState(now: number): void {
  state = createRateLimitState(now);
}

/** Optional injected dependencies for rateLimitedNotify/runFlush, purely for
 * test determinism -- defaults to the real clock and the real
 * sendNotification. Production callers never pass these. */
type InjectedDeps = {
  now?: number;
  send?: typeof sendNotification;
};

/**
 * The single choke point for all outbound notifications (D6-01): reads the
 * live `config.rateLimit`, calls the pure `evaluate()` against the current
 * module-level `state`, and delivers via `send` (defaults to the real
 * `sendNotification`) ONLY when `evaluate()` returns `deliver: true`.
 * Otherwise the notification is accumulated into per-type overflow for the
 * grouped summary and NOT sent -- accumulation is logged via `log()` (never
 * `console.log`), and the log never includes `options.message` (D6-10).
 */
export async function rateLimitedNotify(
  type: NotificationType,
  options: Parameters<typeof sendNotification>[0],
  { now, send }: InjectedDeps = {},
): Promise<void> {
  const effectiveNow = now ?? Date.now() / 1000;
  const effectiveSend = send ?? sendNotification;
  const { rateLimit } = getConfig();

  const result = evaluate(state, type, effectiveNow, rateLimit);
  state = result.state;

  if (result.deliver) {
    await effectiveSend(options);
    return;
  }

  log("Notification accumulated for grouped overflow summary", { type });
}

/**
 * Window-end flush (D6-05): formats any accumulated overflow into one
 * combined, counts-only summary via `flushOverflow` and resets `state` for
 * the next window, regardless of whether anything overflowed. When a
 * non-null summary results, delivers it via `send` (defaults to the real
 * `sendNotification`) DIRECTLY -- deliberately never through
 * `rateLimitedNotify` -- so the grouped summary bypasses the limiter and is
 * emitted even while the limiter would otherwise be saturated (D6-06). The
 * flush is skipped entirely when nothing overflowed (`summary === null`), so
 * `sendNotification` is never called with an empty message. Called by the
 * RxJS config-driven timer below; exported (with the same injectable
 * `now`/`send` seam) so tests can drive the flush deterministically without
 * waiting on the real RxJS interval.
 */
export async function runFlush({ now, send }: InjectedDeps = {}): Promise<void> {
  const effectiveNow = now ?? Date.now() / 1000;
  const effectiveSend = send ?? sendNotification;

  const { summary, nextState } = flushOverflow(state, effectiveNow);
  state = nextState;

  if (summary !== null) {
    // D6-06: direct sendNotification call, bypasses rateLimitedNotify entirely.
    await effectiveSend({ title: "Notification summary", message: summary });
  }
}

// Config-driven flush timer (D6-05): configValue("rateLimit") + switchMap
// automatically cancels the old interval and starts a new one whenever
// config.rateLimit.window changes, consistent with every other config-driven
// observable in this codebase (e.g. services/nostr.ts's shareAndHold).
configValue("rateLimit")
  .pipe(switchMap((cfg) => interval(cfg.window * 1000)))
  .subscribe(() => {
    void runFlush();
  });
