import type { Clock } from "../core/batch";

// Bookkeeping for lookups that ask several sources.

// Rejects when the promise has not settled in time, and clears its timer either
// way so a finished request leaves nothing pending.
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  clock: Pick<Clock, "after">,
): Promise<T> {
  let cancel = () => {};
  const timeout = new Promise<never>((_, reject) => {
    cancel = clock.after(ms, () =>
      reject(new Error(`timed out after ${ms}ms`)),
    );
  });
  return Promise.race([promise, timeout]).finally(cancel);
}

// Turns a Promise<T | null> into one that rejects on null, so Promise.any skips
// the sources that found nothing.
export function withNullAsReject<T>(promise: Promise<T | null>): Promise<T> {
  return promise.then((value) => {
    if (value === null) throw new Error("not found");
    return value;
  });
}

// How each source behaved during one lookup. "Answered" covers a source that
// returned a verdict, including the verdict "I hold no record of this paper".
// "Failed" covers a source that threw.
//
// One source answering "no record" is evidence about the paper, so it is enough
// to justify a failure tag. Only when no source answered at all is the absence
// unproven. An earlier version treated any failure as disqualifying, which
// suppressed the tag for two thirds of a real run, because with four sources
// something throws most of the time.
//
// Read the tally only once every source has settled. Promise.any resolves while
// its losers are still in flight, so an early read is a moving target.
export class SourceTally {
  answered = 0;
  readonly failed: string[] = [];

  constructor(private readonly log: (message: string) => void) {}

  get unchecked(): boolean {
    return this.answered === 0;
  }

  // Runs one source of a sequential cascade. A throw is recorded and turned into
  // null, so the cascade carries on with the next source.
  async run<T>(source: string, fn: () => Promise<T | null>): Promise<T | null> {
    try {
      const value = await fn();
      this.answered++;
      return value;
    } catch (error) {
      this.recordFailure(source, error);
      return null;
    }
  }

  // Same bookkeeping for a raced lookup. The error is rethrown, so Promise.any
  // goes on waiting for the other sources. Wrap this inside withNullAsReject and
  // not outside it, otherwise a source that found nothing counts as a failure.
  track<T>(source: string, promise: Promise<T>): Promise<T> {
    return promise.then(
      (value) => {
        this.answered++;
        return value;
      },
      (error) => {
        this.recordFailure(source, error);
        throw error;
      },
    );
  }

  private recordFailure(source: string, error: unknown): void {
    this.failed.push(source);
    this.log(`Metadata Hunter: ${source} failed: ${error}`);
  }
}
