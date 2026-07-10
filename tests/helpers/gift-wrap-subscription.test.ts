import { describe, test, expect } from "bun:test";
import { defer, of, Subject, throwError } from "rxjs";
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

describe("seededGiftWraps (CR-01 fail-closed seed contract)", () => {
  test("if the seed request errors (even after retries), live$'s backlog burst is NOT emitted -- no mass re-notification", () => {
    const historical = fakeEvent("historical-id");
    const seedRequest$ = throwError(() => new Error("seed timeout"));
    const live$ = new Subject<NostrEvent>();

    let failureLogged: unknown;
    const emitted: NostrEvent[] = [];
    seededGiftWraps(seedRequest$, live$, {
      retryCount: 0,
      retryDelay: 0,
      onSeedFailure: (error) => (failureLogged = error),
    }).subscribe((e) => emitted.push(e));

    // Simulate the relay resending the entire historical backlog on the
    // fresh live$ REQ (Pitfall 1) -- this must NOT reach subscribers.
    live$.next(historical);

    expect(emitted).toEqual([]);
    expect(failureLogged).toBeInstanceOf(Error);
    expect((failureLogged as Error).message).toBe("seed timeout");
  });

  test("a seed that fails transiently but recovers within the retry budget still dedups the backlog normally", async () => {
    const historical = fakeEvent("historical-id");
    let attempts = 0;
    const seedRequest$ = defer(() => {
      attempts++;
      // Fail the first 2 attempts, succeed on the 3rd (within retryCount: 2).
      if (attempts < 3) return throwError(() => new Error("transient"));
      return of(historical);
    });
    const live$ = new Subject<NostrEvent>();

    let failureLogged = false;
    const emitted: NostrEvent[] = [];
    seededGiftWraps(seedRequest$, live$, {
      retryCount: 2,
      retryDelay: 0,
      onSeedFailure: () => (failureLogged = true),
    }).subscribe((e) => emitted.push(e));

    // retry({ delay }) schedules re-subscription via an async timer even
    // with delay: 0, so wait a tick for both retries (and concat's
    // subscription to live$) to settle before driving live$.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Historical wrap was seeded successfully via retry -- a live resend
    // must be deduped as usual, and a genuinely new wrap must still emit.
    const brandNew = fakeEvent("new-id");
    live$.next(historical);
    live$.next(brandNew);

    expect(emitted).toEqual([brandNew]);
    expect(failureLogged).toBe(false);
    expect(attempts).toBe(3);
  });
});
