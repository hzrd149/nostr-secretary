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

describe("rateLimitedNotify -- under-limit delivery", () => {
  test("calls the injected send exactly once with the same options when under both limits", async () => {
    resetRateLimitState(1000);
    setRateLimit({
      window: 60,
      global: 20,
      perType: { replies: 5, zaps: 5, messages: 5, groups: 5 },
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

describe("runFlush -- bypasses rateLimitedNotify entirely (D6-06)", () => {
  test("the flush's own injected send still fires while the per-type bucket remains saturated, proving it never routes back through rateLimitedNotify", async () => {
    resetRateLimitState(5000);
    setRateLimit({
      window: 60,
      global: 1,
      perType: { replies: 1, zaps: 5, messages: 5, groups: 5 },
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
