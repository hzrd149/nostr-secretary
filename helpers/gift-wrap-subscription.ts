import type { NostrEvent } from "nostr-tools";
import { concat, filter, ignoreElements, Observable, tap } from "rxjs";

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
 */
export function notifyNewGiftWraps(
  seed$: Observable<NostrEvent>,
  live$: Observable<NostrEvent>,
  seen: Set<string> = new Set(),
): Observable<NostrEvent> {
  return concat(
    seed$.pipe(
      tap((event) => seen.add(event.id)),
      ignoreElements(),
    ),
    live$.pipe(
      filter((event) => {
        if (seen.has(event.id)) return false;
        seen.add(event.id);
        return true;
      }),
    ),
  );
}
