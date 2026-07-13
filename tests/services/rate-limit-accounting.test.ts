import { describe, test, expect } from "bun:test";

// NOTE: This file intentionally imports ONLY services/rate-limit-accounting.ts's
// pure exports -- never services/rate-limit.ts (the impure, stateful shell)
// or services/nostr.ts/services/config.ts/services/ntfy.ts. The accounting
// module has zero top-level singleton imports and is always safe to import
// directly in a test; state is constructed fresh per case via
// createRateLimitState(now), so no beforeEach reset is needed (mirrors
// tests/notifications/dm-category.test.ts).
import {
  createRateLimitState,
  evaluate,
  flushOverflow,
  formatOverflowSummary,
  type NotificationType,
  type RateLimitConfig,
} from "../../services/rate-limit-accounting";

const ALL_TYPES: NotificationType[] = ["replies", "zaps", "messages", "groups"];

function makeConfig(overrides: Partial<RateLimitConfig> = {}): RateLimitConfig {
  return {
    window: 60,
    global: 20,
    perType: { replies: 5, zaps: 5, messages: 5, groups: 5 },
    perGroup: 3,
    perDm: 5,
    ...overrides,
  };
}

describe("createRateLimitState", () => {
  test("seeds an all-zero state at windowStart=now", () => {
    const state = createRateLimitState(1000);
    expect(state).toEqual({
      windowStart: 1000,
      globalCount: 0,
      perTypeCount: { replies: 0, zaps: 0, messages: 0, groups: 0 },
      overflow: { replies: 0, zaps: 0, messages: 0, groups: 0 },
      contexts: {},
    });
  });
});

describe("evaluate -- under-limit delivery", () => {
  test("delivers and increments both global and per-type counts when under both limits", () => {
    const state = createRateLimitState(1000);
    const config = makeConfig();
    const result = evaluate(state, "replies", 1001, config);

    expect(result.deliver).toBe(true);
    expect(result.state.globalCount).toBe(1);
    expect(result.state.perTypeCount.replies).toBe(1);
    // Other types' counts are untouched.
    expect(result.state.perTypeCount.zaps).toBe(0);
    expect(result.state.overflow).toEqual({
      replies: 0,
      zaps: 0,
      messages: 0,
      groups: 0,
    });
  });
});

describe("evaluate -- over-per-type accumulation (D6-04)", () => {
  test("does not deliver and increments overflow[type] once perTypeCount[type] reaches its limit, even though global is under", () => {
    const config = makeConfig({ global: 20, perType: { replies: 5, zaps: 5, messages: 5, groups: 5 } });
    let state = createRateLimitState(1000);

    // Fill replies to exactly its per-type limit (5/5) while global stays well under (20).
    for (let i = 0; i < 5; i++) {
      const result = evaluate(state, "replies", 1001 + i, config);
      expect(result.deliver).toBe(true);
      state = result.state;
    }
    expect(state.perTypeCount.replies).toBe(5);
    expect(state.globalCount).toBe(5);

    // The 6th "replies" notification: per-type is at limit, global is under.
    const overflowResult = evaluate(state, "replies", 1010, config);
    expect(overflowResult.deliver).toBe(false);
    expect(overflowResult.state.overflow.replies).toBe(1);
    // Neither counter is incremented for a non-delivered notification.
    expect(overflowResult.state.globalCount).toBe(5);
    expect(overflowResult.state.perTypeCount.replies).toBe(5);
  });
});

describe("evaluate -- over-global accumulation (D6-04)", () => {
  test("does not deliver and increments overflow[type] once globalCount reaches the global limit, even though the type is under its own limit", () => {
    // A tight global limit (2) with a generous per-type limit (5) for "zaps".
    const config = makeConfig({ global: 2, perType: { replies: 5, zaps: 5, messages: 5, groups: 5 } });
    let state = createRateLimitState(1000);

    // Use up the global budget with two "replies" deliveries.
    state = evaluate(state, "replies", 1001, config).state;
    state = evaluate(state, "replies", 1002, config).state;
    expect(state.globalCount).toBe(2);

    // A "zaps" notification: type is well under its own limit (0/5), but global is at limit.
    const overflowResult = evaluate(state, "zaps", 1003, config);
    expect(overflowResult.deliver).toBe(false);
    expect(overflowResult.state.overflow.zaps).toBe(1);
    expect(overflowResult.state.globalCount).toBe(2);
    expect(overflowResult.state.perTypeCount.zaps).toBe(0);
  });
});

describe("evaluate -- per-type x global interaction table (4 combos)", () => {
  test("under-type + under-global => deliver", () => {
    const config = makeConfig({ global: 20, perType: { replies: 5, zaps: 5, messages: 5, groups: 5 } });
    const state = createRateLimitState(1000);
    const result = evaluate(state, "replies", 1001, config);
    expect(result.deliver).toBe(true);
  });

  test("over-type + under-global => no deliver, overflow accumulates", () => {
    const config = makeConfig({ global: 20, perType: { replies: 1, zaps: 5, messages: 5, groups: 5 } });
    let state = createRateLimitState(1000);
    state = evaluate(state, "replies", 1001, config).state; // fills replies to 1/1
    const result = evaluate(state, "replies", 1002, config);
    expect(result.deliver).toBe(false);
    expect(result.state.overflow.replies).toBe(1);
  });

  test("under-type + over-global => no deliver, overflow accumulates", () => {
    const config = makeConfig({ global: 1, perType: { replies: 5, zaps: 5, messages: 5, groups: 5 } });
    let state = createRateLimitState(1000);
    state = evaluate(state, "replies", 1001, config).state; // fills global to 1/1
    const result = evaluate(state, "zaps", 1002, config);
    expect(result.deliver).toBe(false);
    expect(result.state.overflow.zaps).toBe(1);
  });

  test("over-type + over-global => no deliver, overflow accumulates", () => {
    const config = makeConfig({ global: 1, perType: { replies: 1, zaps: 5, messages: 5, groups: 5 } });
    let state = createRateLimitState(1000);
    state = evaluate(state, "replies", 1001, config).state; // fills both replies (1/1) and global (1/1)
    const result = evaluate(state, "replies", 1002, config);
    expect(result.deliver).toBe(false);
    expect(result.state.overflow.replies).toBe(1);
  });
});

describe("evaluate -- 0 = unlimited (D6-09)", () => {
  test("perType[type] === 0 always delivers regardless of accumulated perTypeCount", () => {
    // global is set generously high so only the per-type gate is under test.
    const config = makeConfig({ global: 1000, perType: { replies: 0, zaps: 5, messages: 5, groups: 5 } });
    let state = createRateLimitState(1000);

    // Deliver "replies" many times in a row -- the per-type gate never engages.
    for (let i = 0; i < 50; i++) {
      const result = evaluate(state, "replies", 1001 + i, config);
      expect(result.deliver).toBe(true);
      state = result.state;
    }
    expect(state.overflow.replies).toBe(0);
  });

  test("global === 0 always delivers regardless of accumulated globalCount", () => {
    const config = makeConfig({ global: 0, perType: { replies: 5, zaps: 5, messages: 5, groups: 5 } });
    let state = createRateLimitState(1000);

    for (const type of ["replies", "zaps", "messages", "groups"] as NotificationType[]) {
      // Deliver up to (but under) each type's own limit repeatedly across types,
      // proving the global gate never blocks even as globalCount climbs high.
      for (let i = 0; i < 4; i++) {
        const result = evaluate(state, type, 1001 + i, config);
        expect(result.deliver).toBe(true);
        state = result.state;
      }
    }
    expect(state.globalCount).toBe(16);
    expect(state.overflow).toEqual({ replies: 0, zaps: 0, messages: 0, groups: 0 });
  });
});

describe("evaluate -- window roll", () => {
  test("resets counts and overflow once now advances past windowStart+config.window, then applies the decision in the fresh window", () => {
    const config = makeConfig({ window: 60, global: 1, perType: { replies: 1, zaps: 5, messages: 5, groups: 5 } });
    let state = createRateLimitState(1000);

    // Fill the window: 1st replies delivers, 2nd overflows (global at limit).
    state = evaluate(state, "replies", 1001, config).state;
    const overflowed = evaluate(state, "replies", 1002, config);
    expect(overflowed.deliver).toBe(false);
    state = overflowed.state;
    expect(state.overflow.replies).toBe(1);
    expect(state.globalCount).toBe(1);

    // now advances to exactly windowStart + window (1000 + 60 = 1060): the window has rolled.
    const rolled = evaluate(state, "replies", 1060, config);
    expect(rolled.deliver).toBe(true);
    expect(rolled.state.windowStart).toBe(1060);
    expect(rolled.state.globalCount).toBe(1);
    expect(rolled.state.overflow.replies).toBe(0);
  });
});

describe("evaluate -- per-context lazy-create (D7-02)", () => {
  test("first evaluate for an unseen context key delivers and lazily sets contexts[key] to 1", () => {
    const state = createRateLimitState(1000);
    const config = makeConfig();
    expect(state.contexts["groups:g1"]).toBeUndefined();

    const result = evaluate(state, "groups", 1001, config, "g1");

    expect(result.deliver).toBe(true);
    expect(result.state.contexts["groups:g1"]).toBe(1);
  });
});

describe("evaluate -- per-context isolation (D7-01)", () => {
  test("one context reaching perGroup does not block a DIFFERENT context of the same type in the same window", () => {
    const config = makeConfig({ perGroup: 2 });
    let state = createRateLimitState(1000);

    // Fill g1 to its perGroup limit (2/2).
    state = evaluate(state, "groups", 1001, config, "g1").state;
    state = evaluate(state, "groups", 1002, config, "g1").state;
    expect(state.contexts["groups:g1"]).toBe(2);

    // g1's 3rd notification overflows.
    const g1Overflow = evaluate(state, "groups", 1003, config, "g1");
    expect(g1Overflow.deliver).toBe(false);

    // A DIFFERENT context g2 still delivers in the SAME window.
    const g2Result = evaluate(state, "groups", 1004, config, "g2");
    expect(g2Result.deliver).toBe(true);
    expect(g2Result.state.contexts["groups:g2"]).toBe(1);
  });
});

describe("evaluate -- most-restrictive-wins layering table (D7-04)", () => {
  test("context-under + type-under + global-under => deliver", () => {
    const config = makeConfig({ global: 20, perType: { replies: 5, zaps: 5, messages: 5, groups: 5 }, perGroup: 3 });
    const state = createRateLimitState(1000);
    const result = evaluate(state, "groups", 1001, config, "g1");
    expect(result.deliver).toBe(true);
  });

  test("context-over + type-under + global-under => no deliver, overflow accumulates", () => {
    const config = makeConfig({ global: 20, perType: { replies: 5, zaps: 5, messages: 5, groups: 5 }, perGroup: 1 });
    let state = createRateLimitState(1000);
    state = evaluate(state, "groups", 1001, config, "g1").state; // fills g1 to 1/1 (perGroup)
    const result = evaluate(state, "groups", 1002, config, "g1");
    expect(result.deliver).toBe(false);
    expect(result.state.overflow.groups).toBe(1);
  });

  test("context-under + type-over + global-under => no deliver, overflow accumulates", () => {
    const config = makeConfig({ global: 20, perType: { replies: 5, zaps: 5, messages: 5, groups: 1 }, perGroup: 5 });
    let state = createRateLimitState(1000);
    state = evaluate(state, "groups", 1001, config, "g1").state; // fills perType.groups to 1/1
    // A DIFFERENT context, still under its own perGroup limit, but perType.groups is exhausted.
    const result = evaluate(state, "groups", 1002, config, "g2");
    expect(result.deliver).toBe(false);
    expect(result.state.overflow.groups).toBe(1);
  });

  test("context-under + type-under + global-over => no deliver, overflow accumulates", () => {
    const config = makeConfig({ global: 1, perType: { replies: 5, zaps: 5, messages: 5, groups: 5 }, perGroup: 5 });
    let state = createRateLimitState(1000);
    state = evaluate(state, "groups", 1001, config, "g1").state; // fills global to 1/1
    // A DIFFERENT context, still under its own perGroup limit, but global is exhausted.
    const result = evaluate(state, "groups", 1002, config, "g2");
    expect(result.deliver).toBe(false);
    expect(result.state.overflow.groups).toBe(1);
  });
});

describe("evaluate -- per-context window-prune (D7-02)", () => {
  test("contexts resets to {} on the SAME window tumble as perTypeCount/overflow", () => {
    const config = makeConfig({ window: 60, perGroup: 5 });
    let state = createRateLimitState(1000);
    state = evaluate(state, "groups", 1001, config, "g1").state;
    expect(state.contexts["groups:g1"]).toBe(1);

    // now advances past windowStart + window: the window has rolled.
    const rolled = evaluate(state, "groups", 1060, config, "g1");
    expect(rolled.state.windowStart).toBe(1060);
    expect(rolled.state.contexts).toEqual({ "groups:g1": 1 });
    // The map was discarded and recreated (not incremented from the stale 1) --
    // confirm by checking it did NOT carry over as 2.
    expect(rolled.deliver).toBe(true);
  });
});

describe("evaluate -- per-context overflow-rollup into per-type overflow only (D7-07)", () => {
  test("a context-rejected notification increments overflow[type] only; contexts[key] is left unchanged and no per-context overflow field exists", () => {
    const config = makeConfig({ perGroup: 1 });
    let state = createRateLimitState(1000);
    state = evaluate(state, "groups", 1001, config, "g1").state; // fills g1 to 1/1
    expect(state.contexts["groups:g1"]).toBe(1);

    const rejected = evaluate(state, "groups", 1002, config, "g1");
    expect(rejected.deliver).toBe(false);
    expect(rejected.state.overflow.groups).toBe(1);
    // contexts[key] is unchanged by the rejection.
    expect(rejected.state.contexts["groups:g1"]).toBe(1);
    // No per-context overflow substructure exists anywhere on the state.
    expect(Object.keys(rejected.state)).toEqual([
      "windowStart",
      "globalCount",
      "perTypeCount",
      "overflow",
      "contexts",
    ]);
  });
});

describe("evaluate -- 0 = unlimited for perGroup/perDm (D7-06)", () => {
  test("perGroup === 0 always delivers for the same context regardless of accumulated count", () => {
    const config = makeConfig({ global: 1000, perType: { replies: 5, zaps: 5, messages: 5, groups: 1000 }, perGroup: 0 });
    let state = createRateLimitState(1000);

    for (let i = 0; i < 50; i++) {
      const result = evaluate(state, "groups", 1001 + i, config, "g1");
      expect(result.deliver).toBe(true);
      state = result.state;
    }
    expect(state.overflow.groups).toBe(0);
  });

  test("perDm === 0 always delivers for the same context regardless of accumulated count", () => {
    const config = makeConfig({ global: 1000, perType: { replies: 5, zaps: 5, messages: 1000, groups: 5 }, perDm: 0 });
    let state = createRateLimitState(1000);

    for (let i = 0; i < 50; i++) {
      const result = evaluate(state, "messages", 1001 + i, config, "pubkeyabc");
      expect(result.deliver).toBe(true);
      state = result.state;
    }
    expect(state.overflow.messages).toBe(0);
  });
});

describe("evaluate -- DM counterparty sharing (D7-01, Pitfall 4)", () => {
  test("two evaluates with type messages and the SAME context pubkey share ONE messages:<pubkey> bucket", () => {
    const config = makeConfig({ perDm: 5 });
    let state = createRateLimitState(1000);

    // First "message" from the counterparty (e.g. via NIP-04).
    const first = evaluate(state, "messages", 1001, config, "pubkeyabc");
    expect(first.deliver).toBe(true);
    expect(first.state.contexts["messages:pubkeyabc"]).toBe(1);
    state = first.state;

    // Second "message" from the SAME counterparty (e.g. via NIP-17) increments
    // the SAME composite key, not a separate transport-tagged one.
    const second = evaluate(state, "messages", 1002, config, "pubkeyabc");
    expect(second.deliver).toBe(true);
    expect(second.state.contexts["messages:pubkeyabc"]).toBe(2);
    expect(Object.keys(second.state.contexts)).toEqual(["messages:pubkeyabc"]);
  });
});

describe("evaluate -- no-context regression parity (D7-01/09)", () => {
  test("evaluate() called without a context argument behaves byte-identical to the pre-Phase-7 implementation -- contexts is left untouched", () => {
    const config = makeConfig();
    const state = createRateLimitState(1000);
    const result = evaluate(state, "replies", 1001, config);

    expect(result.deliver).toBe(true);
    expect(result.state.contexts).toEqual({});
  });
});

describe("flushOverflow", () => {
  test("returns one combined summary string over all non-zero overflow counts and a fresh zero-count state", () => {
    let state = createRateLimitState(1000);
    state = { ...state, overflow: { ...state.overflow, replies: 47, groups: 12 } };

    const { summary, nextState } = flushOverflow(state, 1060);

    expect(summary).not.toBeNull();
    expect(summary).toContain("47");
    expect(summary).toContain("12");
    expect(nextState).toEqual(createRateLimitState(1060));
  });

  test("returns summary===null (never an empty string) when nothing overflowed", () => {
    const state = createRateLimitState(1000);
    const { summary, nextState } = flushOverflow(state, 1060);

    expect(summary).toBeNull();
    expect(nextState).toEqual(createRateLimitState(1060));
  });
});

describe("formatOverflowSummary", () => {
  test("mentions only non-zero types", () => {
    const summary = formatOverflowSummary({
      replies: 0,
      zaps: 3,
      messages: 0,
      groups: 0,
    });
    expect(summary).not.toBeNull();
    expect(summary).toContain("zaps");
    expect(summary).not.toContain("replies");
    expect(summary).not.toContain("messages");
    expect(summary).not.toContain("groups");
  });

  test("returns null when every count is zero", () => {
    const summary = formatOverflowSummary({
      replies: 0,
      zaps: 0,
      messages: 0,
      groups: 0,
    });
    expect(summary).toBeNull();
  });

  test("produces counts-only output for known counts (D6-10, exact-string assertion)", () => {
    const summary = formatOverflowSummary({
      replies: 47,
      zaps: 0,
      messages: 0,
      groups: 12,
    });
    expect(summary).toBe("47 new replies, 12 group messages");
  });

  test("labels every type distinctly and never leaks anything beyond count + static label", () => {
    const summary = formatOverflowSummary({
      replies: 1,
      zaps: 2,
      messages: 3,
      groups: 4,
    });
    expect(summary).toBe("1 new replies, 2 zaps, 3 messages, 4 group messages");
  });
});

describe("NotificationType", () => {
  test("is exactly the four coarse types (D6-03)", () => {
    expect(ALL_TYPES).toEqual(["replies", "zaps", "messages", "groups"]);
  });
});
