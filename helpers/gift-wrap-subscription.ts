import type { NostrEvent } from "nostr-tools";
import {
  catchError,
  concat,
  EMPTY,
  filter,
  ignoreElements,
  Observable,
  retry,
  tap,
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
  /** Max seed retry attempts before failing closed (CR-01). Default 2. */
  retryCount?: number;
  /** Delay between seed retries in ms. Default 2_000. */
  retryDelay?: number;
  /** Called with the error if the seed ultimately fails after retries --
   *  callers should log here (WR-03). */
  onSeedFailure?: (error: unknown) => void;
  /** Forwarded to `notifyNewGiftWraps`'s `seen` cap (WR-01). */
  maxSeen?: number;
}

/**
 * Wraps a raw, unguarded seed request observable (e.g. `pool.request(...)`,
 * which throws/errors on relay timeout) with retry-with-backoff, then
 * composes it with `live$` via `notifyNewGiftWraps` -- but with a critical
 * difference from a bare `seedRequest$.pipe(catchError(() => EMPTY))`:
 * if the seed *still* fails after retrying, this fails CLOSED rather than
 * falling through to `live$` with an empty `seen` set.
 *
 * Failing closed means: no gift wrap is emitted for the remainder of this
 * subscription (until the caller's upstream `switchMap` re-subscribes,
 * e.g. on `messageInboxes$` changing). This trades "occasionally misses
 * live notifications after a persistently failing seed" for "never mass
 * re-notifies the entire historical DM backlog" -- the exact regression
 * CR-01 flagged, since `live$` (a fresh REQ) resends the full matching
 * history on open (Pitfall 1) and NIP-59 randomizes `created_at` so there
 * is no `since` filter to fall back on.
 */
export function seededGiftWraps(
  seedRequest$: Observable<NostrEvent>,
  live$: Observable<NostrEvent>,
  options: SeededGiftWrapsOptions = {},
): Observable<NostrEvent> {
  const {
    retryCount = 2,
    retryDelay = 2_000,
    onSeedFailure,
    maxSeen,
  } = options;

  let seedFailed = false;
  const seed$ = seedRequest$.pipe(
    retry({ count: retryCount, delay: retryDelay }),
    catchError((error) => {
      seedFailed = true;
      onSeedFailure?.(error);
      return EMPTY;
    }),
  );

  return notifyNewGiftWraps(seed$, live$, undefined, maxSeen).pipe(
    // Fail closed (CR-01): once the seed has definitively failed, never
    // let anything from live$ (including its un-deduped backlog burst)
    // reach downstream subscribers for the rest of this subscription.
    filter(() => !seedFailed),
  );
}
