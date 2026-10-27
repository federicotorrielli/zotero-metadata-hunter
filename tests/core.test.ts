import { describe, expect, it, vi } from "vitest";
import { runBatches, type Clock } from "../src/core/batch";
import { CancelToken, RunController } from "../src/core/cancel";
import { createProgressReporter, formatEta } from "../src/core/progress";

function fakeClock(): Clock & { delays: number[]; advance(ms: number): void } {
  let time = 0;
  const delays: number[] = [];
  return {
    delays,
    advance: (ms) => void (time += ms),
    now: () => time,
    delay: async (ms) => {
      delays.push(ms);
      time += ms;
    },
    after: () => () => {},
  };
}

const options = (over: Record<string, unknown> = {}) => ({
  cancel: new CancelToken(),
  batchSize: 2,
  minIntervalMs: 300,
  clock: fakeClock(),
  onError: vi.fn(async () => {}),
  onItemDone: vi.fn(),
  ...over,
});

describe("runBatches", () => {
  it("runs every item and reports each one", async () => {
    const seen: number[] = [];
    const opts = options();
    const cut = await runBatches(
      [1, 2, 3, 4, 5],
      async (n) => void seen.push(n),
      opts,
    );
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(opts.onItemDone).toHaveBeenCalledTimes(5);
    expect(cut).toBe(false);
  });

  it("starts items of one batch together", async () => {
    let running = 0;
    let peak = 0;
    await runBatches(
      [1, 2, 3, 4],
      async () => {
        peak = Math.max(peak, ++running);
        await Promise.resolve();
        running--;
      },
      options(),
    );
    expect(peak).toBe(2);
  });

  it("pads fast batches to the minimum interval but not after the last", async () => {
    const clock = fakeClock();
    await runBatches([1, 2, 3, 4, 5], async () => {}, options({ clock }));
    expect(clock.delays).toEqual([300, 300]);
  });

  it("does not pad a batch that already took long enough", async () => {
    const clock = fakeClock();
    await runBatches(
      [1, 2, 3],
      async () => clock.advance(400),
      options({ clock }),
    );
    expect(clock.delays).toEqual([]);
  });

  it("ends between batches on cancel and reports it", async () => {
    const cancel = new CancelToken();
    const seen: number[] = [];
    const cut = await runBatches(
      [1, 2, 3, 4],
      async (n) => {
        seen.push(n);
        cancel.cancel();
      },
      options({ cancel }),
    );
    expect(seen).toEqual([1]);
    expect(cut).toBe(true);
  });

  it("reports a cancel that skipped items inside the last batch", async () => {
    const cancel = new CancelToken();
    const opts = options({ cancel, batchSize: 5 });
    const cut = await runBatches(
      [1, 2],
      async (n) => {
        if (n === 1) cancel.cancel();
        else await Promise.resolve();
      },
      opts,
    );
    expect(cut).toBe(true);
  });

  it("hands a worker error to onError and keeps going", async () => {
    const opts = options();
    await runBatches(
      [1, 2],
      async (n) => {
        if (n === 1) throw new Error("boom");
      },
      opts,
    );
    expect(opts.onError).toHaveBeenCalledTimes(1);
    expect(opts.onItemDone).toHaveBeenCalledTimes(2);
  });
});

describe("RunController", () => {
  it("rejects a second run while one is active and reports changes", async () => {
    const onChange = vi.fn();
    const controller = new RunController(onChange);
    let release!: () => void;
    const first = controller.run(() => new Promise<void>((r) => (release = r)));
    expect(controller.isProcessing).toBe(true);
    const job = vi.fn(async () => {});
    await controller.run(job);
    expect(job).not.toHaveBeenCalled();
    release();
    await first;
    expect(controller.isProcessing).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("toggle cancels a run in progress and starts otherwise", async () => {
    const controller = new RunController(() => {});
    const start = vi.fn();
    controller.toggle(start);
    expect(start).toHaveBeenCalledTimes(1);

    let token!: CancelToken;
    let release!: () => void;
    const running = controller.run(async (cancel) => {
      token = cancel;
      await new Promise<void>((r) => (release = r));
    });
    controller.toggle(start);
    expect(token.requested).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    release();
    await running;
  });

  it("clears the active run when the job throws", async () => {
    const controller = new RunController(() => {});
    await expect(
      controller.run(async () => {
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    expect(controller.isProcessing).toBe(false);
  });
});

describe("progress", () => {
  const t = (key: string, params: Record<string, unknown> = {}) =>
    `${key}:${JSON.stringify(params)}`;

  it("shows no estimate for the first items or a short wait", () => {
    expect(formatEta({ elapsedMs: 10_000, processed: 2, total: 100 }, t)).toBe(
      "",
    );
    expect(formatEta({ elapsedMs: 1_000, processed: 5, total: 6 }, t)).toBe("");
  });

  it("estimates in seconds and then in minutes", () => {
    expect(formatEta({ elapsedMs: 10_000, processed: 10, total: 20 }, t)).toBe(
      'eta-seconds:{"count":10}',
    );
    expect(formatEta({ elapsedMs: 60_000, processed: 10, total: 100 }, t)).toBe(
      'eta-minutes:{"count":9}',
    );
  });

  it("updates the panel with percent, counters and the estimate", () => {
    const panel = { update: vi.fn(), close: vi.fn() };
    const clock = fakeClock();
    const report = createProgressReporter({
      panel,
      key: "k",
      total: 10,
      clock,
      t,
    });
    clock.advance(30_000);
    report(5, { found: 2 });
    expect(panel.update).toHaveBeenCalledWith(
      50,
      'k:{"current":5,"total":10,"percent":50,"found":2} eta-seconds:{"count":30}',
    );
  });
});
