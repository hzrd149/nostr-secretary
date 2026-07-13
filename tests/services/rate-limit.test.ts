import { afterAll, describe, expect, test } from "bun:test";

// NOTE: unlike tests/services/rate-limit-accounting.test.ts (which imports
// ONLY the pure accounting module), this file DELIBERATELY imports
// services/rate-limit.ts -- the impure, stateful shell -- because it is
// exactly what's under test here (the D6-01 choke point + the D6-06 bypass
// flush). It drives the module-level singleton through the injected
// now/send seam (never real timers/real sendNotification) and resets state
// via resetRateLimitState() at the start of every case, so no mutated state
// leaks between cases (RESEARCH Pitfall 2).
import {
  clampWindowSeconds,
  MAX_WINDOW_SECONDS,
  MIN_WINDOW_SECONDS,
  rateLimitedNotify,
  resetRateLimitState,
  runFlush,
} from "../../services/rate-limit";
import config$, {
  DEFAULT_RATE_LIMIT_CONFIG,
  getConfig,
} from "../../services/config";
import type {
  NtfyNotificationOptions,
  NtfyResponse,
} from "../../services/ntfy";

/** Builds a fake `sendNotification`-shaped function that records every call
 * instead of performing real network I/O, mirroring the injectable `send`
 * seam rateLimitedNotify/runFlush expose. */
function fakeSend() {
  const calls: NtfyNotificationOptions[] = [];
  const send = async (
    options: NtfyNotificationOptions,
  ): Promise<NtfyResponse> => {
    calls.push(options);
    return {
      id: "fake",
      time: 0,
      expires: 0,
      event: "message",
      topic: "fake",
      message: options.message,
    };
  };
  return { send, calls };
}

/** Sets the live config.rateLimit for the duration of a test. The module
 * singleton is shared across the whole `bun test` process, so
 * afterAll below restores the default once this file is done, keeping other
 * test files' assumptions about a "fresh" config.rateLimit intact. */
function setRateLimit(rateLimit: typeof DEFAULT_RATE_LIMIT_CONFIG) {
  config$.next({ ...getConfig(), rateLimit });
}

afterAll(() => {
  setRateLimit(DEFAULT_RATE_LIMIT_CONFIG);
});

// WR-04: degenerate `window` coverage. `clampWindowSeconds` is the pure
// function the flush timer's switchMap keys on (CR-01) and the only place
// the floor/ceiling from CR-02/WR-02 are enforced -- tested directly here
// (deterministic, no real timers/no 930-tick/sec busy loop) rather than by
// asserting on real `interval()` timing.
describe("clampWindowSeconds -- CR-02/WR-02 floor/ceiling on the effective window", () => {
  test("0 is clamped up to MIN_WINDOW_SECONDS -- unlike global/perType, 0 is NEVER 'unlimited' for window", () => {
    expect(clampWindowSeconds(0)).toBe(MIN_WINDOW_SECONDS);
  });

  test("a negative window is clamped up to MIN_WINDOW_SECONDS", () => {
    expect(clampWindowSeconds(-60)).toBe(MIN_WINDOW_SECONDS);
  });

  test("NaN is clamped to MIN_WINDOW_SECONDS", () => {
    expect(clampWindowSeconds(NaN)).toBe(MIN_WINDOW_SECONDS);
  });

  test("Infinity is not finite, so it is treated as invalid and clamped to MIN_WINDOW_SECONDS (same as NaN)", () => {
    expect(clampWindowSeconds(Infinity)).toBe(MIN_WINDOW_SECONDS);
  });

  test("an excessively large window (e.g. a fat-fingered extra zero) is clamped down to MAX_WINDOW_SECONDS", () => {
    expect(clampWindowSeconds(999_999_999)).toBe(MAX_WINDOW_SECONDS);
  });

  test("an ordinary in-range window passes through unchanged", () => {
    expect(clampWindowSeconds(60)).toBe(60);
  });

  test("exactly MIN_WINDOW_SECONDS and MAX_WINDOW_SECONDS pass through unchanged (inclusive bounds)", () => {
    expect(clampWindowSeconds(MIN_WINDOW_SECONDS)).toBe(MIN_WINDOW_SECONDS);
    expect(clampWindowSeconds(MAX_WINDOW_SECONDS)).toBe(MAX_WINDOW_SECONDS);
  });
});

describe("rateLimitedNotify -- under-limit delivery", () => {
  test("calls the injected send exactly once with the same options when under both limits", async () => {
    resetRateLimitState(1000);
    setRateLimit({
      window: 60,
      global: 20,
      perType: { replies: 5, zaps: 5, messages: 5, groups: 5 },
      perGroup: DEFAULT_RATE_LIMIT_CONFIG.perGroup,
      perDm: DEFAULT_RATE_LIMIT_CONFIG.perDm,
    });
    const { send, calls } = fakeSend();

    await rateLimitedNotify(
      "replies",
      { title: "Reply", message: "hello" },
      { now: 1001, send },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ title: "Reply", message: "hello" });
  });
});

describe("rateLimitedNotify -- over-limit accumulation (D6-04)", () => {
  test("does NOT call send once the per-type limit is reached, while the pending overflow for that type increases", async () => {
    resetRateLimitState(2000);
    setRateLimit({
      window: 60,
      global: 20,
      perType: { replies: 1, zaps: 5, messages: 5, groups: 5 },
      perGroup: DEFAULT_RATE_LIMIT_CONFIG.perGroup,
      perDm: DEFAULT_RATE_LIMIT_CONFIG.perDm,
    });
    const { send, calls } = fakeSend();

    // 1st "replies" call: under limit, delivers.
    await rateLimitedNotify(
      "replies",
      { title: "r1", message: "m1" },
      { now: 2001, send },
    );
    expect(calls).toHaveLength(1);

    // 2nd and 3rd "replies" calls: per-type limit (1) reached -- accumulate,
    // send is NOT called again.
    await rateLimitedNotify(
      "replies",
      { title: "r2", message: "m2" },
      { now: 2002, send },
    );
    await rateLimitedNotify(
      "replies",
      { title: "r3", message: "m3" },
      { now: 2003, send },
    );
    expect(calls).toHaveLength(1);
  });
});

describe("runFlush -- one combined counts-only summary (D6-05)", () => {
  test("calls the injected send exactly once with a message equal to the counts-only summary, and resets state", async () => {
    resetRateLimitState(3000);
    setRateLimit({
      window: 60,
      global: 1,
      perType: { replies: 1, zaps: 5, messages: 5, groups: 5 },
      perGroup: DEFAULT_RATE_LIMIT_CONFIG.perGroup,
      perDm: DEFAULT_RATE_LIMIT_CONFIG.perDm,
    });
    const gated = fakeSend();

    // Deliver the first "replies" (fills both global=1/1 and replies=1/1),
    // then accumulate two more into overflow.
    await rateLimitedNotify(
      "replies",
      { title: "r1", message: "m1" },
      { now: 3001, send: gated.send },
    );
    await rateLimitedNotify(
      "replies",
      { title: "r2", message: "m2" },
      { now: 3002, send: gated.send },
    );
    await rateLimitedNotify(
      "replies",
      { title: "r3", message: "m3" },
      { now: 3003, send: gated.send },
    );
    expect(gated.calls).toHaveLength(1); // only the 1st delivered

    const flush = fakeSend();
    await runFlush({ now: 3010, send: flush.send });

    expect(flush.calls).toHaveLength(1);
    // Counts-only: "2 new replies" (the two accumulated overflow calls) --
    // never the DM/event content passed as `message` above.
    const summaryCall = flush.calls[0]!;
    expect(summaryCall.message).toBe("2 new replies");
    expect(summaryCall.message).not.toContain("m2");
    expect(summaryCall.message).not.toContain("m3");

    // State was reset -- a subsequent flush with nothing new to report emits
    // no summary.
    const secondFlush = fakeSend();
    await runFlush({ now: 3020, send: secondFlush.send });
    expect(secondFlush.calls).toHaveLength(0);
  });

  test("is skipped entirely when nothing overflowed (summary === null)", async () => {
    resetRateLimitState(4000);
    setRateLimit(DEFAULT_RATE_LIMIT_CONFIG);
    const { send, calls } = fakeSend();

    await runFlush({ now: 4001, send });

    expect(calls).toHaveLength(0);
  });
});

describe("rateLimitedNotify -- CR-01 (iteration 2): defensive window:0 clamp at the choke point", () => {
  test("even if config$.rateLimit.window somehow holds a degenerate 0 (bypassing the config.ts/preferences.ts source clamps), rateLimitedNotify still rate-limits -- 1 of 10 delivered, not 10 of 10", async () => {
    resetRateLimitState(6000);
    // Deliberately writes window:0 directly to config$ -- config$.next()
    // performs no validation itself, so this simulates ANY future input
    // surface that forgot to clamp before reaching config$, exercising
    // rateLimitedNotify's own belt-and-suspenders clampWindowSeconds call
    // rather than the source-level fixes in migrateConfig/asRateLimit.
    setRateLimit({
      window: 0,
      global: 1,
      perType: { replies: 1, zaps: 5, messages: 5, groups: 5 },
      perGroup: DEFAULT_RATE_LIMIT_CONFIG.perGroup,
      perDm: DEFAULT_RATE_LIMIT_CONFIG.perDm,
    });
    const { send, calls } = fakeSend();

    // Steps of 0.1s so all 10 calls land within the same clamped 1s
    // (MIN_WINDOW_SECONDS) window -- proving real accumulation, not just
    // "didn't crash". (Stepping by a full 1s per call would itself hit the
    // `now - windowStart < windowSeconds` equality boundary every time at
    // windowSeconds===1, rolling on every call for an unrelated reason.)
    for (let i = 0; i < 10; i++) {
      await rateLimitedNotify(
        "replies",
        { title: `r${i}`, message: `m${i}` },
        { now: 6000 + i * 0.1, send },
      );
    }

    expect(calls).toHaveLength(1);
    expect(calls).not.toHaveLength(10);
  });
});

describe("runFlush -- bypasses rateLimitedNotify entirely (D6-06)", () => {
  test("the flush's own injected send still fires while the per-type bucket remains saturated, proving it never routes back through rateLimitedNotify", async () => {
    resetRateLimitState(5000);
    setRateLimit({
      window: 60,
      global: 1,
      perType: { replies: 1, zaps: 5, messages: 5, groups: 5 },
      perGroup: DEFAULT_RATE_LIMIT_CONFIG.perGroup,
      perDm: DEFAULT_RATE_LIMIT_CONFIG.perDm,
    });
    const gated = fakeSend();

    // Saturate the bucket: 1st delivers, 2nd accumulates (bucket now full).
    await rateLimitedNotify(
      "replies",
      { title: "x", message: "x" },
      { now: 5001, send: gated.send },
    );
    await rateLimitedNotify(
      "replies",
      { title: "y", message: "y" },
      { now: 5002, send: gated.send },
    );
    expect(gated.calls).toHaveLength(1);

    // The window has NOT rolled (5003 - 5000 < 60) -- the bucket is still
    // saturated. If the flush routed back through rateLimitedNotify, this
    // summary would itself be suppressed. It must not be: the flush's
    // injected send fires directly.
    const flush = fakeSend();
    await runFlush({ now: 5003, send: flush.send });

    expect(flush.calls).toHaveLength(1);
    expect(flush.calls[0]!.message).toBe("1 new replies");
  });
});
