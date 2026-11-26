import { afterEach, describe, expect, it, vi } from "vitest";
import type { Clock } from "../src/core/batch";
import { createHttp } from "../src/net/http";
import {
  NamedFailure,
  SourceTally,
  withNullAsReject,
  withTimeout,
} from "../src/net/tally";
import { createThrottle } from "../src/net/throttle";

afterEach(() => vi.useRealTimers());

// Timers come from the injected clock, so the tests give it real timers.
const timerClock: Pick<Clock, "after"> = {
  after: (ms, fn) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

describe("withTimeout", () => {
  it("rejects after the delay", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 50, timerClock);
    const assertion = expect(pending).rejects.toThrow("timed out after 50ms");
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it("clears its timer when the promise resolves first", async () => {
    vi.useFakeTimers();
    await withTimeout(Promise.resolve("done"), 10_000, timerClock);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its timer when the promise rejects", async () => {
    vi.useFakeTimers();
    await expect(
      withTimeout(Promise.reject(new Error("x")), 10_000, timerClock),
    ).rejects.toThrow("x");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("SourceTally", () => {
  const log = vi.fn();

  it("counts a null verdict as an answer", async () => {
    const tally = new SourceTally(log);
    expect(await tally.run("A", async () => null)).toBeNull();
    expect(tally.answered).toBe(1);
    expect(tally.unchecked).toBe(false);
  });

  it("records a throw as a failure and returns null", async () => {
    const tally = new SourceTally(log);
    const value = await tally.run("A", async () => {
      throw new Error("down");
    });
    expect(value).toBeNull();
    expect(tally.failed).toEqual(["A"]);
    expect(tally.unchecked).toBe(true);
  });

  it("is checked once any source answers, even when others fail", async () => {
    const tally = new SourceTally(log);
    await tally.run("A", async () => {
      throw new Error("down");
    });
    await tally.run("B", async () => null);
    expect(tally.unchecked).toBe(false);
  });

  it("counts a raced null as an answer when track is wrapped by withNullAsReject", async () => {
    const tally = new SourceTally(log);
    const raced = withNullAsReject(tally.track("A", Promise.resolve(null)));
    await expect(raced).rejects.toThrow("not found");
    expect(tally.answered).toBe(1);
    expect(tally.failed).toEqual([]);
  });

  it("records the label of a named failure in place of the source", async () => {
    const tally = new SourceTally(log);
    await tally.run("A", async () => {
      throw new NamedFailure("A key", "not accepted");
    });
    expect(tally.failed).toEqual(["A key"]);
  });

  it("rethrows a raced failure so Promise.any keeps waiting", async () => {
    const tally = new SourceTally(log);
    const winner = Promise.any([
      withNullAsReject(tally.track("A", Promise.reject(new Error("down")))),
      withNullAsReject(tally.track("B", Promise.resolve("hit"))),
    ]);
    await expect(winner).resolves.toBe("hit");
    expect(tally.failed).toEqual(["A"]);
  });
});

describe("createHttp", () => {
  const userAgent = "Test/1 (+https://example.org)";

  it("sends the user agent and switches off Zotero's retry", async () => {
    const request = vi.fn(async () => ({
      status: 200,
      responseText: '{"a":1}',
    }));
    const http = createHttp({ request, userAgent, clock: timerClock });
    expect(await http.getJson("https://x")).toEqual({ a: 1 });
    expect(request).toHaveBeenCalledWith("GET", "https://x", {
      headers: { "User-Agent": userAgent },
      errorDelayMax: 0,
    });
  });

  it("adds the headers of a request to the user agent", async () => {
    const request = vi.fn(
      async (_m: string, _u: string, _o: Record<string, unknown>) => ({
        status: 200,
        responseText: "{}",
      }),
    );
    const http = createHttp({ request, userAgent, clock: timerClock });
    await http.getOptionalJson("https://x", { headers: { "x-api-key": "k" } });
    expect(request.mock.calls[0][2].headers).toEqual({
      "User-Agent": userAgent,
      "x-api-key": "k",
    });
  });

  it("resolves a 404 to null for optional lookups and allows the code", async () => {
    const request = vi.fn(
      async (_m: string, _u: string, _o: Record<string, unknown>) => ({
        status: 404,
        responseText: "{}",
      }),
    );
    const http = createHttp({ request, userAgent, clock: timerClock });
    expect(await http.getOptionalJson("https://x")).toBeNull();
    expect(request.mock.calls[0][2]).toMatchObject({
      successCodes: [200, 404],
    });
  });

  it("propagates request errors on a plain get", async () => {
    const request = vi.fn(async () => {
      throw new Error("429");
    });
    const http = createHttp({ request, userAgent, clock: timerClock });
    await expect(http.get("https://x")).rejects.toThrow("429");
  });
});

describe("createThrottle", () => {
  it("starts tasks at least the interval apart, in arrival order", async () => {
    const delays: number[] = [];
    const clock = {
      now: () => 0,
      delay: async (ms: number) => void delays.push(ms),
    };
    const throttle = createThrottle(clock, 1_000);
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) => throttle(async () => void order.push(n))),
    );
    expect(delays).toEqual([1_000, 2_000]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("does not wait when the interval has already passed", async () => {
    let time = 0;
    const delay = vi.fn(async () => {});
    const throttle = createThrottle({ now: () => time, delay }, 1_000);
    await throttle(async () => {});
    time = 5_000;
    await throttle(async () => {});
    expect(delay).not.toHaveBeenCalled();
  });
});
