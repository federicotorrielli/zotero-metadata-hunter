import { runBatches, type Clock } from "../core/batch";
import type { CancelToken } from "../core/cancel";
import { createProgressReporter } from "../core/progress";
import type { ProgressPanel } from "../modules/progress";
import type { Lookups } from "../sources/lookups";
import type { ZoteroApi, ZoteroItem } from "../types";
import type { Params, Translate } from "../utils/locale";
import type { Scope } from "./action";
import { setFailureTag, TAG_UPDATE_FAILED } from "./tags";

// What a flow needs from the outside. index.ts builds it once.
export interface FlowDeps {
  api: ZoteroApi;
  lookups: Lookups;
  clock: Clock;
  t: Translate;
  log(message: string): void;
  batchSize(): number;
  createPanel(title: string, hint: string): ProgressPanel;
}

// Batches start at least this far apart. The delay is intentional API rate
// limiting, so do not remove it.
const BATCH_MIN_INTERVAL_MS = 300;

// Counters every flow keeps.
export interface RunStats {
  processed: number;
  // Items left alone because no source answered. They are neither resolved nor
  // tagged, so the panel has to name them or they vanish from the report.
  skipped: number;
  // Source name to the number of items it failed for, across the whole run.
  sourceFailures: Map<string, number>;
  cancelled: boolean;
  hadApiErrors: boolean;
}

export const newStats = (): RunStats => ({
  processed: 0,
  skipped: 0,
  sourceFailures: new Map(),
  cancelled: false,
  hadApiErrors: false,
});

export function recordSourceFailures(
  into: Map<string, number>,
  sources: string[],
): void {
  for (const source of sources) into.set(source, (into.get(source) ?? 0) + 1);
}

// "Semantic Scholar (4), CrossRef (2)", worst offender first.
function formatSourceFailures(counts: Map<string, number>): string {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([source, n]) => `${source} (${n})`)
    .join(", ");
}

// A paragraph appended to a result message.
export function tail(t: Translate, key: string, params: Params = {}): string {
  return "\n\n" + t(key, params);
}

// Adds one paragraph for every note whose count is above zero.
export function appendNotes(
  t: Translate,
  message: string,
  notes: [count: number, key: string, extra: Params][],
): string {
  return notes
    .filter(([count]) => count > 0)
    .reduce(
      (text, [count, key, extra]) => text + tail(t, key, { count, ...extra }),
      message,
    );
}

export const emptyKeyFor = (
  scope: Scope,
  keys: { library: string; selection: string },
): string => keys[scope];

// An item whose worker threw is left as it was, so it gets the failure tag.
export function tagUpdateFailed(deps: FlowDeps) {
  return async (item: ZoteroItem, stats: { taggedFailed: number }) => {
    await setFailureTag(item, TAG_UPDATE_FAILED, deps.log);
    stats.taggedFailed++;
  };
}

// Tail shared by the three panels: how many items a failing source stopped us
// from checking, and a generic warning when something else went wrong. The
// specific count already implies the warning, so the two never appear together.
export function buildSkippedTail(
  t: Translate,
  stats: RunStats,
  skippedKey: string,
): string {
  let text = "";
  if (stats.skipped > 0) text += tail(t, skippedKey, { count: stats.skipped });
  if (stats.sourceFailures.size > 0) {
    text += tail(t, "common-source-failures", {
      sources: formatSourceFailures(stats.sourceFailures),
    });
  } else if (stats.hadApiErrors) {
    text += tail(t, "common-api-warning");
  }
  return text;
}

export interface BatchJob<R extends RunStats> {
  cancel: CancelToken;
  result: R;
  // String ids: the panel title, its hint, and the progress line.
  ids: { title: string; hint: string; progress: string };
  // Counters shown on the progress line.
  counters(result: R): Params;
  worker(item: ZoteroItem, result: R): Promise<void>;
  // Extra handling when the worker throws, e.g. tagging the item.
  onError?(item: ZoteroItem, result: R): Promise<void>;
}

// The loop every flow shares: a progress panel, parallel batches, cancel, and
// one place that counts items and errors.
export async function processInBatches<R extends RunStats>(
  deps: FlowDeps,
  job: BatchJob<R>,
  items: ZoteroItem[],
): Promise<R> {
  const { t, clock, log } = deps;
  const { result, ids } = job;
  const panel = deps.createPanel(t(ids.title), t(ids.hint));
  const report = createProgressReporter({
    panel,
    key: ids.progress,
    total: items.length,
    clock,
    t,
  });

  try {
    result.cancelled = await runBatches(
      items,
      (item) => job.worker(item, result),
      {
        cancel: job.cancel,
        batchSize: deps.batchSize(),
        minIntervalMs: BATCH_MIN_INTERVAL_MS,
        clock,
        onError: async (item, error) => {
          log(`Metadata Hunter: Error processing item ${item.id}: ${error}`);
          result.hadApiErrors = true;
          await job.onError?.(item, result);
        },
        onItemDone: () => {
          result.processed++;
          report(result.processed, job.counters(result));
        },
      },
    );
  } finally {
    panel.close();
  }
  return result;
}
