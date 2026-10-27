import type { ProgressPanel } from "../modules/progress";
import type { Params, Translate } from "../utils/locale";
import type { Clock } from "./batch";

const MIN_ITEMS_FOR_ETA = 3;
const MIN_ETA_MS = 5_000;

// Empty until the estimate is useful.
export interface Progress {
  elapsedMs: number;
  processed: number;
  total: number;
}

export function formatEta(
  { elapsedMs, processed, total }: Progress,
  t: Translate,
): string {
  if (processed < MIN_ITEMS_FOR_ETA) return "";
  const remaining = (elapsedMs / processed) * (total - processed);
  if (remaining < MIN_ETA_MS) return "";
  if (remaining < 60_000) {
    return t("eta-seconds", { count: Math.round(remaining / 1_000) });
  }
  return t("eta-minutes", { count: Math.round(remaining / 60_000) });
}

export interface ProgressSpec {
  panel: ProgressPanel;
  // The id of the progress line. It receives current, total and percent, plus
  // whatever the flow passes with each update.
  key: string;
  total: number;
  clock: Clock;
  t: Translate;
}

// Returns the function a flow calls after each item with its own counters.
export function createProgressReporter(
  spec: ProgressSpec,
): (done: number, counters: Params) => void {
  const { panel, key, total, clock, t } = spec;
  const startedAt = clock.now();
  return (done, counters) => {
    const percent = Math.round((done / total) * 100);
    const line = t(key, { current: done, total, percent, ...counters });
    const eta = formatEta(
      { elapsedMs: clock.now() - startedAt, processed: done, total },
      t,
    );
    panel.update(percent, eta ? `${line} ${eta}` : line);
  };
}
