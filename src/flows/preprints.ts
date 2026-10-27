import { extractArxivId, isPreprint } from "../domain/preprint";
import { SourceTally, withNullAsReject, withTimeout } from "../net/tally";
import type { PublishedRef, ZoteroItem } from "../types";
import type { Params, Translate } from "../utils/locale";
import type { Action, Scope } from "./action";
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
import { setFailureTag, TAG_NO_PUBLISHED, TAG_UPDATE_FAILED } from "./tags";

const SOURCE_TIMEOUT_MS = 10_000;

export interface PublishedLookup {
  ref: PublishedRef | null;
  // Same meaning as DOILookup.unchecked: no source gave a verdict, so "no
  // published version" is unproven and must not be tagged.
  unchecked: boolean;
  failedSources: string[];
}

// The arXiv entry of the paper itself first. Then the other sources are raced
// and the first non-null result wins.
export async function findPublishedDOI(
  deps: FlowDeps,
  item: ZoteroItem,
): Promise<PublishedLookup> {
  const title = item.getField("title");
  if (!title) return { ref: null, unchecked: false, failedSources: [] };

  const tally = new SourceTally(deps.log);
  const arxivId = extractArxivId(item);
  if (arxivId) {
    const doi = await tally.run("arXiv ID lookup", () =>
      deps.lookups.publishedByArxivId(arxivId),
    );
    if (doi) {
      return { ref: { doi }, unchecked: false, failedSources: tally.failed };
    }
  }

  try {
    const ref = await Promise.any(
      deps.lookups.published.map(({ name, find }) =>
        withNullAsReject(
          tally.track(
            name,
            withTimeout(find(item, title), SOURCE_TIMEOUT_MS, deps.clock),
          ),
        ),
      ),
    );
    return { ref, unchecked: false, failedSources: tally.failed };
  } catch {
    // Every source has settled by now, so the tally is final.
    return {
      ref: null,
      unchecked: tally.unchecked,
      failedSources: tally.failed,
    };
  }
}

// OpenReview's BibTeX usually carries the forum URL, but not for every venue's
// template. Filling it in lets the user reach the page. The URL is a courtesy,
// so a failed save is logged and the new item is kept.
async function ensureUrl(
  deps: FlowDeps,
  created: ZoteroItem,
  url: string,
): Promise<ZoteroItem> {
  if (created.getField("url")?.trim()) return created;
  try {
    created.setField("url", url);
    await created.saveTx();
  } catch (error) {
    deps.log(`Metadata Hunter: Failed to set the URL of a new item: ${error}`);
  }
  return created;
}

// Creates the published item in the same library and collections as the source.
export async function createItemFromPublished(
  deps: FlowDeps,
  ref: PublishedRef,
  source: ZoteroItem,
): Promise<ZoteroItem | null> {
  const target = {
    libraryID: source.libraryID,
    collections: source.getCollections(),
  };
  if ("doi" in ref) return deps.api.fromDOI(ref.doi, target);
  if (!("bibtex" in ref)) return deps.api.fromURL(ref.url, target);
  const created = await deps.api.fromBibtex(ref.bibtex, target);
  return created && ensureUrl(deps, created, ref.url);
}

export interface Migration {
  moved: number;
  trashed: number;
}

// An attachment whose file is missing or empty has nothing to keep, so it goes to
// the trash. A file that is only waiting to download is kept, and so are notes and
// link-only attachments. Everything else moves to the new item.
async function relocate(
  deps: FlowDeps,
  child: ZoteroItem,
  target: ZoteroItem,
): Promise<keyof Migration> {
  const isBroken = (await deps.api.attachmentState(child)) === "broken";
  if (isBroken) {
    child.deleted = true;
  } else {
    child.parentItemID = target.id;
  }
  await child.saveTx();
  return isBroken ? "trashed" : "moved";
}

// Zotero trashes children with their parent, so without this step user-added
// PDFs, annotations and notes go to the trash with the preprint. That is silent
// data loss once the trash is emptied. A child that cannot move is logged and
// left behind.
export async function migrateChildren(
  deps: FlowDeps,
  source: ZoteroItem,
  target: ZoteroItem,
): Promise<Migration> {
  const result: Migration = { moved: 0, trashed: 0 };
  for (const id of [...source.getAttachments(), ...source.getNotes()]) {
    try {
      const child = await deps.api.getItem(id);
      if (child) result[await relocate(deps, child, target)]++;
    } catch (error) {
      deps.log(
        `Metadata Hunter: Failed to re-parent child ${id} to item ${target.id}: ${error}`,
      );
    }
  }
  return result;
}

// Bare imports (Google Scholar BibTeX, RIS, manual entry) often land arXiv
// preprints as Zotero's generic "document" type. When the action confirms a
// preprint but nothing replaces it, the proper type categorizes it correctly.
// Zotero remaps the base fields across the change, so no metadata is lost.
export async function promoteDocumentToPreprint(
  deps: FlowDeps,
  item: ZoteroItem,
): Promise<boolean> {
  const preprintTypeID = deps.api.itemTypeID("preprint");
  if (item.itemType !== "document" || !preprintTypeID) return false;
  try {
    item.setType(preprintTypeID);
    await item.saveTx();
    return true;
  } catch (error) {
    deps.log(
      `Metadata Hunter: Failed to promote document ${item.id} to preprint: ${error}`,
    );
    return false;
  }
}

export interface PreprintStats extends RunStats {
  found: number;
  migratedChildren: number;
  trashedAttachments: number;
  taggedNoPublished: number;
  taggedFailed: number;
  convertedToPreprint: number;
}

async function replaceWithPublished(
  deps: FlowDeps,
  { source, created }: { source: ZoteroItem; created: ZoteroItem },
  stats: PreprintStats,
): Promise<void> {
  // The children move before the source is trashed, or they follow it there.
  const { moved, trashed } = await migrateChildren(deps, source, created);
  stats.migratedChildren += moved;
  stats.trashedAttachments += trashed;
  source.deleted = true;
  await source.saveTx();
  stats.found++;
}

async function keepSource(
  deps: FlowDeps,
  { source, lookup }: { source: ZoteroItem; lookup: PublishedLookup },
  stats: PreprintStats,
): Promise<void> {
  if (await promoteDocumentToPreprint(deps, source))
    stats.convertedToPreprint++;
  if (lookup.ref) {
    await setFailureTag(source, TAG_UPDATE_FAILED, deps.log);
    stats.taggedFailed++;
  } else if (lookup.unchecked) {
    stats.skipped++;
  } else {
    await setFailureTag(source, TAG_NO_PUBLISHED, deps.log);
    stats.taggedNoPublished++;
  }
}

async function processOne(
  deps: FlowDeps,
  item: ZoteroItem,
  stats: PreprintStats,
): Promise<void> {
  const lookup = await findPublishedDOI(deps, item);
  recordSourceFailures(stats.sourceFailures, lookup.failedSources);
  const created = lookup.ref
    ? await createItemFromPublished(deps, lookup.ref, item)
    : null;
  if (created) {
    await replaceWithPublished(deps, { source: item, created }, stats);
  } else {
    await keepSource(deps, { source: item, lookup }, stats);
  }
}

const newPreprintStats = (): PreprintStats => ({
  ...newStats(),
  found: 0,
  migratedChildren: 0,
  trashedAttachments: 0,
  taggedNoPublished: 0,
  taggedFailed: 0,
  convertedToPreprint: 0,
});

function summaryKey(r: PreprintStats): string {
  if (r.cancelled) return "preprint-cancelled";
  return r.found === 0 ? "preprint-no-published" : "preprint-found";
}

function buildPreprintMessage(t: Translate, r: PreprintStats): string {
  let message = t(summaryKey(r), {
    checked: r.processed,
    total: r.processed,
    found: r.found,
  });
  const notes: [number, string, Params][] = [
    [r.migratedChildren, "preprint-migrated-children", {}],
    [r.trashedAttachments, "preprint-trashed-attachments", {}],
    [r.convertedToPreprint, "preprint-converted-to-preprint", {}],
    [
      r.taggedNoPublished,
      "preprint-tagged-no-published",
      { tag: TAG_NO_PUBLISHED },
    ],
    [r.taggedFailed, "preprint-tagged-failed", { tag: TAG_UPDATE_FAILED }],
  ];
  return (
    appendNotes(t, message, notes) +
    buildSkippedTail(t, r, "common-skipped-preprints")
  );
}

export function createPreprintAction(
  deps: FlowDeps,
  scope: Scope,
): Action<PreprintStats> {
  return {
    titleKey: "preprint-title",
    emptyKey: emptyKeyFor(scope, {
      library: "preprint-none-found",
      selection: "preprint-none-found-selected",
    }),
    select: (items) => items.filter(isPreprint),
    process: (items, cancel) =>
      processInBatches<PreprintStats>(
        deps,
        {
          cancel,
          result: newPreprintStats(),
          ids: {
            title: "preprint-progress-title",
            hint: "preprint-progress-hint",
            progress: "preprint-progress-item",
          },
          counters: (r) => ({ found: r.found }),
          worker: (item, stats) => processOne(deps, item, stats),
          // A worker that threw leaves the item as it was, so it gets the failure tag.
          onError: tagUpdateFailed(deps),
        },
        items,
      ),
    message: (result) => buildPreprintMessage(deps.t, result),
  };
}
