import { getDOI, isEnrichable, isPublishedDOI } from "../domain/preprint";
import {
  enrichItemFromMetadata,
  SNAPSHOT_FIELDS,
  type NormalizedRecord,
} from "../domain/merge";
import type { ZoteroApi, ZoteroItem } from "../types";
import type { Params, Translate } from "../utils/locale";
import type { Action, Scope } from "./action";
import { findDOIForItem } from "./doi";
import { findPublishedDOI } from "./preprints";
import {
  appendNotes,
  buildSkippedTail,
  emptyKeyFor,
  newStats,
  processInBatches,
  recordSourceFailures,
  tagUpdateFailed,
  type FlowDeps,
  type RunStats,
} from "./shared";
import {
  removeFailureTags,
  setFailureTag,
  TAG_NO_DOI,
  TAG_NO_RICHER_RECORD,
  TAG_UPDATE_FAILED,
} from "./tags";

// Needs enrichment when the venue, abstract, pages or volume is missing.
export function hasSparseMetadata(item: ZoteroItem): boolean {
  const filled = (field: string) => !!item.getField(field)?.trim();
  const hasVenue = filled("publicationTitle") || filled("proceedingsTitle");
  return !hasVenue || !["abstractNote", "pages", "volume"].every(filled);
}

export const analyzeItemsForEnrichment = (items: ZoteroItem[]): ZoteroItem[] =>
  items.filter((item) => isEnrichable(item) && hasSparseMetadata(item));

// Snapshots the hydrated item into a plain object. It runs against the live
// scratch, before the erase in fetchRichRecordByDOI, so the record survives the
// scratch's deletion.
export function normalizeScratch(
  api: ZoteroApi,
  scratch: ZoteroItem,
): NormalizedRecord {
  const fields: Record<string, string> = {};
  for (const name of SNAPSHOT_FIELDS) {
    if (!api.isFieldValidForType(name, scratch.itemTypeID)) continue;
    const value = scratch.getField(name);
    if (value != null && String(value).trim()) fields[name] = String(value);
  }
  return {
    itemType: api.itemTypeName(scratch.itemTypeID),
    fields,
    creators: (scratch.getCreators() ?? []).map((creator) => ({ ...creator })),
  };
}

// Looks the DOI up through Zotero's translators, the machinery behind "Add Item
// by Identifier", and returns a plain record.
//
// The translator saves what it creates, and the enrichment must not leave a
// duplicate in the library. So the scratch is created outside any collection,
// snapshotted into a plain record while it is alive, and erased in `finally`.
// The order is load bearing in two ways. `return normalizeScratch(...)` is
// evaluated before `finally` runs, so the snapshot is taken from the live item.
// And the erase finishes before this function returns, so the duplicate never
// reaches the user. The erase is not silent: the translator sent an `add` event,
// and the matching `delete` has to fire too, or the item list keeps a stale row.
export async function fetchRichRecordByDOI(
  deps: FlowDeps,
  doi: string,
  source: ZoteroItem,
): Promise<NormalizedRecord | null> {
  let scratch: ZoteroItem | null = null;
  try {
    scratch = await deps.api.fromDOI(doi, {
      libraryID: source.libraryID,
      collections: [],
    });
    return scratch && normalizeScratch(deps.api, scratch);
  } catch (error) {
    deps.log(
      `Metadata Hunter: Failed to fetch rich record for DOI ${doi}: ${error}`,
    );
    return null;
  } finally {
    if (scratch) await eraseScratch(deps, scratch);
  }
}

async function eraseScratch(
  deps: FlowDeps,
  scratch: ZoteroItem,
): Promise<void> {
  try {
    await deps.api.eraseItem(scratch.id);
  } catch (error) {
    deps.log(
      `Metadata Hunter: Failed to erase scratch item ${scratch.id}: ${error}`,
    );
  }
}

export interface EnrichOutcome {
  skipped?: boolean;
  noDOI?: boolean;
  failed?: boolean;
  // No source answered. Nothing is tagged, and the run reports the gap.
  unchecked?: boolean;
  // Sources that threw during this item's lookups, for the run wide tally.
  failedSources?: string[];
  changed?: string[];
}

// Either the step produced a value, or the item is finished with an outcome.
type Step<T> = { value: T } | { outcome: EnrichOutcome };

async function obtainDOI(
  deps: FlowDeps,
  item: ZoteroItem,
): Promise<Step<string>> {
  const existing = getDOI(item);
  if (existing) return { value: existing };

  const lookup = await findDOIForItem(deps, item);
  if (!lookup.result) {
    if (lookup.unchecked) {
      return {
        outcome: { unchecked: true, failedSources: lookup.failedSources },
      };
    }
    await setFailureTag(item, TAG_NO_DOI, deps.log);
    return { outcome: { noDOI: true, failedSources: lookup.failedSources } };
  }

  item.setField("DOI", lookup.result.doi);
  // Keep the abstract that came with the DOI when the item has none, which saves
  // a round trip.
  if (lookup.result.abstract && !item.getField("abstractNote")?.trim()) {
    item.setField("abstractNote", lookup.result.abstract);
  }
  removeFailureTags(item, [TAG_NO_DOI]);
  await item.saveTx();
  return { value: lookup.result.doi };
}

// An arXiv DOI on a non preprint item resolves only to the preprint record,
// which would demote the item type and overwrite its venue and creators. A
// published DOI is looked up first. When none exists (OpenReview only venues, say)
// the item is left alone, and the user can run the preprint flow or fix the DOI.
async function ensurePublishedDOI(
  deps: FlowDeps,
  item: ZoteroItem,
  doi: string,
): Promise<Step<string>> {
  if (isPublishedDOI(doi)) return { value: doi };

  const upgraded = await findPublishedDOI(deps, item);
  if (
    upgraded.ref &&
    "doi" in upgraded.ref &&
    isPublishedDOI(upgraded.ref.doi)
  ) {
    item.setField("DOI", upgraded.ref.doi);
    await item.saveTx();
    return { value: upgraded.ref.doi };
  }
  if (upgraded.unchecked) {
    return {
      outcome: { unchecked: true, failedSources: upgraded.failedSources },
    };
  }
  await setFailureTag(item, TAG_NO_RICHER_RECORD, deps.log);
  return { outcome: { changed: [] } };
}

async function mergeRichRecord(
  deps: FlowDeps,
  item: ZoteroItem,
  doi: string,
): Promise<EnrichOutcome> {
  const record = await fetchRichRecordByDOI(deps, doi, item);
  if (!record) {
    await setFailureTag(item, TAG_UPDATE_FAILED, deps.log);
    return { failed: true };
  }
  // Even with a published DOI, the record can come back as a preprint, because
  // some preprint servers register DOIs with CrossRef. The item is established as
  // published, so the merge is skipped and the item keeps its type.
  if (record.itemType === "preprint") {
    await setFailureTag(item, TAG_NO_RICHER_RECORD, deps.log);
    return { changed: [] };
  }

  const changed = enrichItemFromMetadata(
    { api: deps.api, log: deps.log },
    item,
    record,
  );
  if (changed.length > 0) {
    removeFailureTags(item, [TAG_NO_RICHER_RECORD, TAG_UPDATE_FAILED]);
    await item.saveTx();
  } else {
    await setFailureTag(item, TAG_NO_RICHER_RECORD, deps.log);
  }
  return { changed };
}

export async function enrichItemMetadata(
  deps: FlowDeps,
  item: ZoteroItem,
): Promise<EnrichOutcome> {
  if (!isEnrichable(item)) return { skipped: true };

  const withDOI = await obtainDOI(deps, item);
  if ("outcome" in withDOI) return withDOI.outcome;
  const published = await ensurePublishedDOI(deps, item, withDOI.value);
  if ("outcome" in published) return published.outcome;
  return mergeRichRecord(deps, item, published.value);
}

export interface EnrichStats extends RunStats {
  enriched: number;
  fieldsFilled: number;
  taggedNoDOI: number;
  taggedNoRicher: number;
  taggedFailed: number;
}

const newEnrichStats = (): EnrichStats => ({
  ...newStats(),
  enriched: 0,
  fieldsFilled: 0,
  taggedNoDOI: 0,
  taggedNoRicher: 0,
  taggedFailed: 0,
});

function countOutcome(stats: EnrichStats, outcome: EnrichOutcome): void {
  recordSourceFailures(stats.sourceFailures, outcome.failedSources ?? []);
  if (outcome.unchecked) stats.skipped++;
  else if (outcome.noDOI) stats.taggedNoDOI++;
  else if (outcome.failed) stats.taggedFailed++;
  else if (outcome.changed?.length) {
    stats.enriched++;
    stats.fieldsFilled += outcome.changed.length;
  } else if (outcome.changed) stats.taggedNoRicher++;
}

function summaryKey(r: EnrichStats): string {
  if (r.cancelled) return "enrich-cancelled";
  return r.enriched === 0 ? "enrich-none-enriched" : "enrich-found";
}

function buildEnrichMessage(t: Translate, r: EnrichStats): string {
  let message = t(summaryKey(r), {
    total: r.processed,
    processed: r.processed,
    enriched: r.enriched,
    fields: r.fieldsFilled,
  });
  const notes: [number, string, Params][] = [
    [r.taggedNoDOI, "enrich-tagged-no-doi", { tag: TAG_NO_DOI }],
    [
      r.taggedNoRicher,
      "enrich-tagged-no-richer",
      { tag: TAG_NO_RICHER_RECORD },
    ],
    [r.taggedFailed, "enrich-tagged-failed", { tag: TAG_UPDATE_FAILED }],
  ];
  return (
    appendNotes(t, message, notes) +
    buildSkippedTail(t, r, "common-skipped-items")
  );
}

export function createEnrichAction(
  deps: FlowDeps,
  scope: Scope,
): Action<EnrichStats> {
  return {
    titleKey: "enrich-title",
    emptyKey: emptyKeyFor(scope, {
      library: "enrich-none-eligible",
      selection: "enrich-none-eligible-selected",
    }),
    // A right-click run respects the user's selection and skips the sparse
    // check. Preprints and non regular items are skipped either way.
    select: (items) =>
      scope === "library"
        ? analyzeItemsForEnrichment(items)
        : items.filter(isEnrichable),
    process: (items, cancel) =>
      processInBatches<EnrichStats>(
        deps,
        {
          cancel,
          result: newEnrichStats(),
          ids: {
            title: "enrich-progress-title",
            hint: "enrich-progress-hint",
            progress: "enrich-progress-item",
          },
          counters: (r) => ({ enriched: r.enriched, fields: r.fieldsFilled }),
          worker: async (item, stats) =>
            countOutcome(stats, await enrichItemMetadata(deps, item)),
          onError: tagUpdateFailed(deps),
        },
        items,
      ),
    message: (result) => buildEnrichMessage(deps.t, result),
  };
}
