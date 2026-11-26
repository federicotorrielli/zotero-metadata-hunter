import type { Clock } from "../core/batch";

export type Throttle = <T>(task: () => Promise<T>) => Promise<T>;

// Starts the tasks at least `intervalMs` apart, in the order of the calls. Every
// call shares one schedule. Therefore parallel batches cannot exceed the rate.
export function createThrottle(
  clock: Pick<Clock, "now" | "delay">,
  intervalMs: number,
): Throttle {
  let nextStart = 0;
  return async (task) => {
    const now = clock.now();
    const start = Math.max(now, nextStart);
    nextStart = start + intervalMs;
    if (start > now) await clock.delay(start - now);
    return task();
  };
}
