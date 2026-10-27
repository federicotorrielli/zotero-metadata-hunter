import type { CancelToken } from "./cancel";

export interface Clock {
  now(): number;
  delay(ms: number): Promise<void>;
  // Calls `fn` after `ms`. Returns the function that cancels the call.
  after(ms: number, fn: () => void): () => void;
}

export interface BatchOptions<T> {
  cancel: CancelToken;
  batchSize: number;
  // Batches start at least this far apart, so cached items cannot hammer an API.
  minIntervalMs: number;
  clock: Clock;
  onError(item: T, error: unknown): Promise<void>;
  // Called once for every item that was started, including the failed ones.
  onItemDone(): void;
}

// Runs the worker over the items in parallel batches. Resolves to true when the
// run was cut short, which is when some item never started because of a cancel.
export async function runBatches<T>(
  items: readonly T[],
  worker: (item: T) => Promise<void>,
  options: BatchOptions<T>,
): Promise<boolean> {
  const { cancel, batchSize, minIntervalMs, clock } = options;
  let cutShort = false;

  const runOne = async (item: T): Promise<void> => {
    if (cancel.requested) {
      cutShort = true;
      return;
    }
    try {
      await worker(item);
    } catch (error) {
      await options.onError(item, error);
    }
    options.onItemDone();
  };

  for (let start = 0; start < items.length; start += batchSize) {
    if (cancel.requested) return true;
    const startedAt = clock.now();
    await Promise.all(items.slice(start, start + batchSize).map(runOne));

    const isLast = start + batchSize >= items.length;
    const wait = minIntervalMs - (clock.now() - startedAt);
    if (!isLast && !cancel.requested && wait > 0) await clock.delay(wait);
  }
  return cutShort;
}
