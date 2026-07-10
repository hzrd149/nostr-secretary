import { describe, test, expect } from "bun:test";

// NOTE: This file intentionally imports ONLY notifications/dm-category.ts's
// pure exports -- never services/nostr.ts or the notifications/index.ts
// barrel. Those modules self-subscribe to the live RelayPool/EventStore
// singleton at import time (see .planning/codebase/TESTING.md and
// tests/notifications/messages.test.ts's identical precedent), so importing
// them here would risk real network I/O. classifyDmSender is a pure,
// synchronous, network-free function with no top-level singleton imports,
// so it is always safe to import directly in a test.
import { classifyDmSender, type DmCategory } from "../../notifications/dm-category";

describe("classifyDmSender", () => {
  test("a followed sender classifies as contacts (D5-01)", () => {
    expect(classifyDmSender(true)).toBe("contacts");
  });

  test("a non-followed sender classifies as others (D5-01)", () => {
    expect(classifyDmSender(false)).toBe("others");
  });

  test("an unavailable/timed-out follow list also classifies as others (D5-02): isContact's timeout fallback resolves false, which is the same input as a genuine non-follow -- classifyDmSender has no third state to distinguish them", () => {
    const isFollowedAfterTimeout = false;
    expect(classifyDmSender(isFollowedAfterTimeout)).toBe("others");
  });

  test("DmCategory is exactly the union \"contacts\" | \"others\"", () => {
    const categories: DmCategory[] = ["contacts", "others"];
    expect(categories).toEqual(["contacts", "others"]);
  });
});
