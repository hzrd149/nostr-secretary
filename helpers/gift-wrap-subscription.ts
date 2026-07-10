import type { NostrEvent } from "nostr-tools";
import {
  concat,
  filter,
  ignoreElements,
  Observable,
  retry,
  tap,
  timer,
} from "rxjs";

/** Default cap on the `seen` id set (WR-01). Bounds memory growth for a
 *  long-running process while comfortably exceeding any realistic
 *  seed+live burst size; eviction is oldest-inserted-first (FIFO), so the
 *  only risk is re-notifying an id that both (a) was seen far enough in
 *  the past to be evicted and (b) is resent by a relay much later -- an
 *  extremely unlikely combination in practice, and strictly better than
 *  unbounded growth. */
const DEFAULT_MAX_SEEN = 5_000;

/** Adds `id` to `seen`, evicting the oldest entry (insertion order, per
 *  the `Set` spec) once `maxSeen` is exceeded -- see WR-01. */
function remember(seen: Set<string>, id: string, maxSeen: number): void {
  seen.add(id);
  if (seen.size > maxSeen) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
}

/**
 * Combines a one-shot "seed" observable (expected to complete -- the
 * historical backlog) with a persistent "live" observable so that only
 * events NOT already seen during the seed phase (or a prior live emission)
 * are emitted downstream. This is the D4-02 fix: notify only on genuinely
 * new gift wraps, never on the historical backlog fetched at (re)subscribe
 * time -- and never rely on `created_at`, which NIP-59 randomizes.
 *
 * `seed$` events are consumed for their side effect only (recording seen
 * ids) via `ignoreElements()` -- they are never emitted downstream.
 * `live$` events are checked against `seen` on EVERY emission, not just
 * during the seed phase, because a relay resends its whole backlog on any
 * fresh REQ (Pitfall 1) -- including the one `live$` itself opens.
 *
 * `seen` is bounded to `maxSeen` entries (default `DEFAULT_MAX_SEEN`),
 * evicting oldest-first, so long process uptime does not leak memory
 * (WR-01).
 *
 * IMPORTANT: this function does not catch `seed$` errors -- an erroring
 * `seed$` still errors the returned observable, which would otherwise
 * leave `live$`'s initial backlog burst completely un-deduped if a caller
 * swallowed the error upstream without adding an equivalent guard. Callers
 * that need a "fail closed on seed failure" guarantee (the CR-01 fix)
 * should use `seededGiftWraps` below instead of composing this directly
 * with a bare `catchError(() => EMPTY)`.
 */
export function notifyNewGiftWraps(
  seed$: Observable<NostrEvent>,
  live$: Observable<NostrEvent>,
  seen: Set<string> = new Set(),
  maxSeen: number = DEFAULT_MAX_SEEN,
): Observable<NostrEvent> {
  return concat(
    seed$.pipe(
      tap((event) => remember(seen, event.id, maxSeen)),
      ignoreElements(),
    ),
    live$.pipe(
      filter((event) => {
        if (seen.has(event.id)) return false;
        remember(seen, event.id, maxSeen);
        return true;
      }),
    ),
  );
}

export interface SeededGiftWrapsOptions {
  /** Base delay before the first seed retry, in ms. Each subsequent
   *  failed attempt doubles this (real exponential backoff, capped by
   *  `maxRetryDelay`) -- see IN-01. Default 2_000. */
  retryDelay?: number;
  /** Upper bound on the exponential backoff delay between seed retries,
   *  in ms. Default 60_000. */
  maxRetryDelay?: number;
  /** Called on EVERY failed seed attempt, with the underlying error and
   *  the 1-based attempt number. Retries are UNBOUNDED -- the seed keeps
   *  retrying forever with capped exponential backoff until it succeeds
   *  (CR-01, iteration 2), so this can fire repeatedly for as long as a
   *  DM relay stays down. Callers that log here should throttle by
   *  `attempt` to avoid log spam. */
  onSeedFailure?: (error: unknown, attempt: number) => void;
  /** Forwarded to `notifyNewGiftWraps`'s `seen` cap (WR-01). */
  maxSeen?: number;
}

/**
 * Wraps a raw, unguarded seed request observable (e.g. `pool.request(...)`,
 * which throws/errors on relay timeout) with UNBOUNDED retry and capped
 * exponential backoff, then composes it with `live$` via
 * `notifyNewGiftWraps` -- but with a critical difference from a bare
 * `seedRequest$.pipe(catchError(() => EMPTY))`: nothing from `live$`
 * (including its un-deduped historical backlog burst, Pitfall 1) reaches
 * downstream subscribers until a seed attempt has actually SUCCEEDED.
 *
 * This is iteration 2 of the CR-01 fix. Iteration 1 retried a bounded
 * number of times and, on final failure, permanently latched a
 * `seedFailed` flag for the life of the subscription. That flag was only
 * ever reset by the caller's upstream `switchMap` re-subscribing (e.g. on
 * `messageInboxes$` changing) -- a condition with no relation to "the
 * relay/network issue that caused the seed failure resolved." A single
 * transient seed failure could therefore permanently blackout NIP-17 DM
 * notifications for the rest of the session, even after every DM relay
 * recovered. Iteration 2 fixes this by:
 *
 * 1. Retrying the seed forever (no `catchError`/give-up path) with capped
 *    exponential backoff, instead of giving up after a fixed count.
 * 2. Gating emission on "has a seed EVER succeeded" (`seeded`, latched
 *    `false -> true` exactly once) rather than "has a seed NOT yet
 *    failed" -- so the pipeline self-heals the instant a retry succeeds,
 *    with no dependence on the outer `switchMap` re-firing.
 *
 * Properties preserved:
 * - No mass re-notification: everything from `live$` stays suppressed
 *   for as long as every seed attempt keeps failing, since `seen` is
 *   only ever populated by a *successful* seed.
 * - Conservative degradation: if every configured DM relay is down, no
 *   NIP-17 notifications fire at all (acceptable -- the relays can't be
 *   read anyway), and notifications resume automatically the moment
 *   relays recover and a retry succeeds.
 */
export function seededGiftWraps(
  seedRequest$: Observable<NostrEvent>,
  live$: Observable<NostrEvent>,
  options: SeededGiftWrapsOptions = {},
): Observable<NostrEvent> {
  const {
    retryDelay = 2_000,
    maxRetryDelay = 60_000,
    onSeedFailure,
    maxSeen,
  } = options;

  // Flips to `true` exactly once, only when a seed attempt actually
  // completes successfully (the `tap({ complete })` below only fires on
  // normal completion, never on error -- a failed attempt errors, it
  // never completes). There is deliberately no `catchError` in this
  // pipe: a failing attempt falls straight into `retry`'s unbounded
  // resubscription instead of ever terminating the seed.
  let seeded = false;
  const seed$ = seedRequest$.pipe(
    tap({
      complete: () => {
        seeded = true;
      },
    }),
    retry({
      delay: (error, retryAttempt) => {
        onSeedFailure?.(error, retryAttempt);
        const backoff = Math.min(
          retryDelay * 2 ** (retryAttempt - 1),
          maxRetryDelay,
        );
        return timer(backoff);
      },
    }),
  );

  return notifyNewGiftWraps(seed$, live$, undefined, maxSeen).pipe(
    // Fail closed until the seed succeeds: suppress everything from
    // live$ (including its un-deduped backlog burst, Pitfall 1) until
    // `seeded` flips true. `notifyNewGiftWraps`'s `concat` never
    // resubscribes to `seed$` after it completes, so `seeded` goes
    // false -> true at most once per subscription and then stays true --
    // self-healing the moment a seed attempt succeeds, and requiring no
    // signal from the caller's upstream switchMap.
    filter(() => seeded),
  );
}
