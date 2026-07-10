import { describe, test, expect } from "bun:test";
import { defer, of, Subject, tap, throwError } from "rxjs";
import type { NostrEvent } from "nostr-tools";
import {
  notifyNewGiftWraps,
  seededGiftWraps,
} from "../../helpers/gift-wrap-subscription";

// helpers/gift-wrap-subscription.ts has no top-level singleton imports or
// side effects (unlike the self-subscribing notification-listener/service
// modules, which subscribe to the live RelayPool/EventStore at import
// time), so it is safe to import directly here -- these tests exercise the
// D4-02 dedup contract with plain rxjs `of`/`Subject` fixtures, without any
// network I/O.

function fakeEvent(id: string): NostrEvent {
  return {
    id,
    pubkey: "sender",
    created_at: 0,
    kind: 1059,
    tags: [],
    content: "",
    sig: "sig",
  };
}

describe("notifyNewGiftWraps (D4-02 contract)", () => {
  test("a historical wrap present during seeding is NOT emitted, even if the relay resends it live", () => {
    const historical = fakeEvent("historical-id");
    const seed$ = of(historical); // completes immediately -- simulates EOSE
    const live$ = new Subject<NostrEvent>();

    const emitted: NostrEvent[] = [];
    notifyNewGiftWraps(seed$, live$).subscribe((e) => emitted.push(e));

    // Simulate the relay resending the same historical event on the fresh
    // live REQ (NIP-01 semantics -- Pitfall 1).
    live$.next(historical);

    expect(emitted).toEqual([]);
  });

  test("a new wrap arriving after seeding completes IS emitted", () => {
    const historical = fakeEvent("historical-id");
    const brandNew = fakeEvent("new-id");
    const seed$ = of(historical);
    const live$ = new Subject<NostrEvent>();

    const emitted: NostrEvent[] = [];
    notifyNewGiftWraps(seed$, live$).subscribe((e) => emitted.push(e));

    live$.next(brandNew);

    expect(emitted).toEqual([brandNew]);
  });

  test("an empty seed (zero historical events) still notifies for the first live event", () => {
    const seed$ = of<NostrEvent>(); // completes with nothing -- the exact
    // "relay returned 0 historical events" case that broke skip(1)
    const live$ = new Subject<NostrEvent>();

    const emitted: NostrEvent[] = [];
    notifyNewGiftWraps(seed$, live$).subscribe((e) => emitted.push(e));

    const brandNew = fakeEvent("new-id");
    live$.next(brandNew);

    expect(emitted).toEqual([brandNew]);
  });

  test("the same live id is never emitted twice", () => {
    const seed$ = of<NostrEvent>();
    const live$ = new Subject<NostrEvent>();

    const emitted: NostrEvent[] = [];
    notifyNewGiftWraps(seed$, live$).subscribe((e) => emitted.push(e));

    const brandNew = fakeEvent("new-id");
    live$.next(brandNew);
    live$.next(brandNew); // reconnect resend, or duplicate relay delivery

    expect(emitted).toEqual([brandNew]);
  });

  test("WR-01: the seen set is bounded -- oldest ids are evicted once maxSeen is exceeded", () => {
    // Small cap so the test doesn't need thousands of events.
    const maxSeen = 3;
    const seed$ = of(
      fakeEvent("id-1"),
      fakeEvent("id-2"),
      fakeEvent("id-3"),
      fakeEvent("id-4"), // pushes the cap past 3 -- "id-1" should be evicted
    );
    const live$ = new Subject<NostrEvent>();

    const emitted: NostrEvent[] = [];
    notifyNewGiftWraps(seed$, live$, undefined, maxSeen).subscribe((e) =>
      emitted.push(e),
    );

    // "id-1" was evicted from `seen` to respect the cap, so a resend is
    // (knowingly) treated as new -- this is the documented WR-01 trade-off.
    live$.next(fakeEvent("id-1"));
    // "id-4" is still within the cap, so it must stay deduped.
    live$.next(fakeEvent("id-4"));

    expect(emitted.map((e) => e.id)).toEqual(["id-1"]);
  });
});

describe("seededGiftWraps (CR-01 fail-closed seed contract, iteration 2: self-healing)", () => {
  test("while the seed keeps failing, live$'s backlog burst is NOT emitted -- no mass re-notification", () => {
    const historical = fakeEvent("historical-id");
    // Never succeeds within this test -- retries are unbounded, so we
    // just assert the suppression holds for as long as it keeps failing.
    const seedRequest$ = throwError(() => new Error("seed timeout"));
    const live$ = new Subject<NostrEvent>();

    const failures: unknown[] = [];
    const emitted: NostrEvent[] = [];
    seededGiftWraps(seedRequest$, live$, {
      retryDelay: 0,
      maxRetryDelay: 0,
      onSeedFailure: (error) => failures.push(error),
    }).subscribe((e) => emitted.push(e));

    // Simulate the relay resending the entire historical backlog on the
    // fresh live$ REQ (Pitfall 1) -- this must NOT reach subscribers,
    // since the seed has never succeeded (concat hasn't even subscribed
    // to live$ yet -- it's still waiting on seed$ to complete).
    live$.next(historical);

    expect(emitted).toEqual([]);
    expect(failures.length).toBeGreaterThanOrEqual(1);
    expect((failures[0] as Error).message).toBe("seed timeout");
  });

  test("after repeated seed failures, a later success does NOT mass-notify the backlog AND live notifications resume -- self-healing", async () => {
    const historical = fakeEvent("historical-id");
    const FAILURES_BEFORE_SUCCESS = 4;
    let attempts = 0;

    // Resolves the instant the seed actually succeeds, instead of
    // guessing a wall-clock delay long enough for N retries to settle
    // (see IN-02) -- this makes the test deterministic regardless of CI
    // load or scheduler timing.
    let resolveSeeded!: () => void;
    const seeded = new Promise<void>((resolve) => {
      resolveSeeded = resolve;
    });
    const seedRequest$ = defer(() => {
      attempts++;
      if (attempts <= FAILURES_BEFORE_SUCCESS) {
        return throwError(() => new Error(`transient #${attempts}`));
      }
      return of(historical).pipe(tap({ complete: () => resolveSeeded() }));
    });
    const live$ = new Subject<NostrEvent>();

    const failedAttempts: number[] = [];
    const emitted: NostrEvent[] = [];
    seededGiftWraps(seedRequest$, live$, {
      // delay: 0 keeps this test fast; it exercises the retry/backoff
      // wiring (attempt count, onSeedFailure), not the actual delay math.
      retryDelay: 0,
      maxRetryDelay: 0,
      onSeedFailure: (_error, attempt) => failedAttempts.push(attempt),
    }).subscribe((e) => emitted.push(e));

    // While the seed is still retrying, live$'s resent backlog burst
    // must not reach subscribers (no mass re-notification).
    live$.next(historical);
    expect(emitted).toEqual([]);

    await seeded;

    // The seed has now succeeded and `seen` has been populated from it;
    // a resend of the same historical wrap must stay deduped, but a
    // genuinely new wrap must be notified -- proving live notifications
    // resumed automatically (self-healing), with no dependence on the
    // outer switchMap re-firing.
    const brandNew = fakeEvent("new-id");
    live$.next(historical);
    live$.next(brandNew);

    expect(emitted).toEqual([brandNew]);
    expect(failedAttempts).toEqual([1, 2, 3, 4]);
    expect(attempts).toBe(FAILURES_BEFORE_SUCCESS + 1);
  });
});
