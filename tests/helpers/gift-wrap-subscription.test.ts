import { describe, test, expect } from "bun:test";
import { of, Subject } from "rxjs";
import type { NostrEvent } from "nostr-tools";
import { notifyNewGiftWraps } from "../../helpers/gift-wrap-subscription";

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
});
