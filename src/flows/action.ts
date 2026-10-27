import type { CancelToken, RunController } from "../core/cancel";
import type { ZoteroItem } from "../types";
import type { Translate } from "../utils/locale";
import type { RunStats } from "./shared";

// Library runs act on the selected rows, selection runs on the selected items.
export type Scope = "library" | "selection";

export interface Action<R extends RunStats> {
  titleKey: string;
  // Shown when `select` leaves nothing to do.
  emptyKey: string;
  select(items: ZoteroItem[]): ZoteroItem[];
  process(items: ZoteroItem[], cancel: CancelToken): Promise<R>;
  message(result: R): string;
}

export interface ActionDeps {
  controller: RunController;
  t: Translate;
  showResult(title: string, message: string, isError: boolean): void;
  log(message: string): void;
}

// The picked items are read inside the run, so a failure while reading them
// reaches the user like any other failure.
export async function runAction<R extends RunStats>(
  deps: ActionDeps,
  action: Action<R>,
  candidates: () => Promise<ZoteroItem[]>,
): Promise<void> {
  const { controller, t, showResult } = deps;
  if (controller.isProcessing) return;

  const title = t(action.titleKey);
  try {
    const items = action.select(await candidates());
    if (items.length === 0) {
      showResult(title, t(action.emptyKey), false);
      return;
    }
    await controller.run(async (cancel) => {
      const result = await action.process(items, cancel);
      const needsAttention = result.hadApiErrors || result.skipped > 0;
      showResult(title, action.message(result), needsAttention);
    });
  } catch (error) {
    deps.log(`Metadata Hunter: ${title} failed: ${error}`);
    showResult(title, t("common-run-failed", { error: String(error) }), true);
  }
}
