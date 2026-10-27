import {
  getDOI,
  hasDOI,
  isPreprint,
  isPublishedDOI,
  lacksDOIOrAbstract,
} from "../domain/preprint";
import { SourceTally, withNullAsReject, withTimeout } from "../net/tally";
import type { DOIResult, ZoteroItem } from "../types";
import type { Translate } from "../utils/locale";
import type { Action, Scope } from "./action";
import {
  buildSkippedTail,
  emptyKeyFor,
  newStats,
  processInBatches,
  recordSourceFailures,
  tail,
  type FlowDeps,
  type RunStats,
} from "./shared";
import { removeFailureTags, setFailureTag, TAG_NO_DOI } from "./tags";

const ABSTRACT_TIMEOUT_MS = 8_000;

export interface DOILookup {
  result: DOIResult | null;
  // True when no source gave a verdict at all. The absence of a DOI is then
  // unproven and must not be tagged. One source answering "no record" is enough
  // to make it false.
  unchecked: boolean;
  // Names of the sources that threw, for the result panel.
  failedSources: string[];
}

const NOT_APPLICABLE: DOILookup = {
  result: null,
  unchecked: false,
  failedSources: [],
};

// Tries the sources in priority order. A non-preprint item rejects every arXiv
// preprint DOI (10.48550/arXiv.*) from every source. Otherwise the cascade could
// attach a preprint identifier to a published paper whose venue issues no DOI,
// and a later enrichment would resolve that DOI back to the preprint record and
// demote the item. Preprint items keep arXiv DOIs, so they can receive their own.
export async function findDOIForItem(
  deps: FlowDeps,
  item: ZoteroItem,
): Promise<DOILookup> {
  const title = item.getField("title");
  if (!item.isRegularItem() || hasDOI(item) || !title) return NOT_APPLICABLE;

  const requirePublished = !isPreprint(item);
  const accept = (found: DOIResult | null): DOIResult | null =>
    found && (!requirePublished || isPublishedDOI(found.doi)) ? found : null;

  const tally = new SourceTally(deps.log);
  for (const { name, find } of deps.lookups.doiCascade) {
    const found = accept(await tally.run(name, () => find(item, title)));
    if (found) {
      return { result: found, unchecked: false, failedSources: tally.failed };
    }
  }
  return {
    result: null,
    unchecked: tally.unchecked,
    failedSources: tally.failed,
  };
}

// Races the abstract sources. The first to return something wins. A missing
// abstract writes no tag, so "every source failed" and "none had one" are the
// same outcome here.
export async function findAbstractForItem(
  deps: FlowDeps,
  item: ZoteroItem,
  doi: string,
): Promise<string | null> {
  if (item.getField("abstractNote")?.trim()) return null;
  const tally = new SourceTally(deps.log);
  try {
    return await Promise.any(
      deps.lookups.abstracts.map(({ name, find }) =>
        withNullAsReject(
          tally.track(
            name,
            withTimeout(find(doi), ABSTRACT_TIMEOUT_MS, deps.clock),
          ),
        ),
      ),
    );
  } catch {
    return null;
  }
}

export interface DOIResultStats extends RunStats {
  foundDOIs: number;
  foundAbstracts: number;
  taggedNoDOI: number;
}

// An item whose edits are saved once, after the last lookup.
interface Edit {
  item: ZoteroItem;
  dirty: boolean;
}

interface Resolved {
  doi: string | null;
  // True when the DOI came from a lookup and was not on the item already.
  isNew: boolean;
  // The abstract that came with the DOI (Semantic Scholar), if any.
  abstract: string | null;
}

// An item that already has a DOI may carry a stale "no DOI" tag from an earlier
// run, e.g. when the user typed the DOI in by hand. Clearing it keeps tag filters
// from surfacing the item for ever.
async function resolveDOI(
  deps: FlowDeps,
  edit: Edit,
  stats: DOIResultStats,
): Promise<Resolved> {
  const { item } = edit;
  const existing = getDOI(item);
  if (existing) {
    edit.dirty = removeFailureTags(item, [TAG_NO_DOI]) || edit.dirty;
    return { doi: existing, isNew: false, abstract: null };
  }

  const lookup = await findDOIForItem(deps, item);
  recordSourceFailures(stats.sourceFailures, lookup.failedSources);
  if (lookup.result) {
    item.setField("DOI", lookup.result.doi);
    removeFailureTags(item, [TAG_NO_DOI]);
    edit.dirty = true;
    return {
      doi: lookup.result.doi,
      isNew: true,
      abstract: lookup.result.abstract,
    };
  }
  if (lookup.unchecked) {
    stats.skipped++;
  } else {
    await setFailureTag(item, TAG_NO_DOI, deps.log);
    stats.taggedNoDOI++;
  }
  return { doi: null, isNew: false, abstract: null };
}

async function resolveAbstract(
  deps: FlowDeps,
  edit: Edit,
  resolved: Resolved & { doi: string },
): Promise<boolean> {
  const { item } = edit;
  const bundled =
    resolved.abstract && !item.getField("abstractNote")?.trim()
      ? resolved.abstract
      : null;
  const abstract =
    bundled ?? (await findAbstractForItem(deps, item, resolved.doi));
  if (!abstract) return false;
  item.setField("abstractNote", abstract);
  edit.dirty = true;
  return true;
}

async function processOne(
  deps: FlowDeps,
  item: ZoteroItem,
  stats: DOIResultStats,
): Promise<void> {
  const edit: Edit = { item, dirty: false };
  const resolved = await resolveDOI(deps, edit, stats);
  const foundAbstract = resolved.doi
    ? await resolveAbstract(deps, edit, { ...resolved, doi: resolved.doi })
    : false;
  if (edit.dirty) await item.saveTx();
  // The counters change after the save, so a failed save is not reported.
  if (resolved.isNew) stats.foundDOIs++;
  if (foundAbstract) stats.foundAbstracts++;
}

const newDOIStats = (): DOIResultStats => ({
  ...newStats(),
  foundDOIs: 0,
  foundAbstracts: 0,
  taggedNoDOI: 0,
});

// Regular items without a DOI or without an abstract.
export const itemsToProcess = (items: ZoteroItem[]): ZoteroItem[] =>
  items.filter(lacksDOIOrAbstract);

function summaryKey(r: DOIResultStats): string {
  if (r.cancelled) return "find-doi-cancelled";
  if (r.foundDOIs === 0 && r.foundAbstracts === 0) return "find-doi-none-found";
  if (r.foundDOIs === 0) return "find-doi-found-abstracts-only";
  if (r.foundAbstracts === 0) return "find-doi-found-dois-only";
  return "find-doi-found";
}

function buildResultMessage(t: Translate, r: DOIResultStats): string {
  let message = t(summaryKey(r), {
    total: r.processed,
    processed: r.processed,
    dois: r.foundDOIs,
    abstracts: r.foundAbstracts,
  });
  if (r.taggedNoDOI > 0) {
    message += tail(t, "find-doi-tagged-no-doi", {
      count: r.taggedNoDOI,
      tag: TAG_NO_DOI,
    });
  }
  return message + buildSkippedTail(t, r, "common-skipped-items");
}

export function createDOIAction(
  deps: FlowDeps,
  scope: Scope,
): Action<DOIResultStats> {
  return {
    titleKey: "find-doi-title",
    emptyKey: emptyKeyFor(scope, {
      library: "find-doi-all-have-data",
      selection: "find-doi-all-selected-have-data",
    }),
    select: itemsToProcess,
    process: (items, cancel) =>
      processInBatches<DOIResultStats>(
        deps,
        {
          cancel,
          result: newDOIStats(),
          ids: {
            title: "find-doi-progress-title",
            hint: "find-doi-progress-hint",
            progress: "find-doi-progress-item",
          },
          counters: (r) => ({ dois: r.foundDOIs, abstracts: r.foundAbstracts }),
          worker: (item, stats) => processOne(deps, item, stats),
        },
        items,
      ),
    message: (result) => buildResultMessage(deps.t, result),
  };
}
