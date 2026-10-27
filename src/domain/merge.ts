// How a hydrated record is merged onto an existing item.
import type { Creator, ZoteroApi, ZoteroItem } from "../types";

// Scalar fields filled onto the item only when the item's own field is empty.
const FILL_MISSING_FIELDS = [
  "title",
  "publicationTitle",
  "proceedingsTitle",
  "conferenceName",
  "publisher",
  "place",
  "volume",
  "issue",
  "pages",
  "ISSN",
  "ISBN",
  "language",
  "url",
  "series",
  "seriesTitle",
  "seriesNumber",
];

// Fields snapshotted from a hydrated record, besides the fill-missing ones.
export const SNAPSHOT_FIELDS = [...FILL_MISSING_FIELDS, "abstractNote", "date"];

// An abstract shorter than this is treated as the one-line junk Scholar imports
// carry, so a longer one replaces it.
const SHORT_ABSTRACT_LENGTH = 200;

// A creator list shorter than this is treated as Scholar's truncated list.
const MIN_CREATORS = 2;

export interface NormalizedRecord {
  itemType: string;
  fields: Record<string, string>;
  creators: Creator[];
}

type FieldRules = Pick<ZoteroApi, "itemTypeID" | "isFieldValidForType">;

export interface MergeEnv {
  api: FieldRules;
  log: (message: string) => void;
}

const trimmed = (value: string | undefined): string => (value ?? "").trim();

// The hydrated list has to be longer, because an equal or shorter one adds
// nothing and would only rewrite names the user may have corrected. Then replace
// when the existing list is truncated (fewer than two creators), or when it shares
// a surname with the hydrated one, which guards against a match with the wrong paper.
export function shouldReplaceCreators(
  existing: Creator[],
  hydrated: Creator[],
): boolean {
  if (!hydrated || hydrated.length <= existing.length) return false;
  if (existing.length < MIN_CREATORS) return true;
  // Institutional creators have `name` and no `lastName`. Without the fallback,
  // lists of corporate authors would never match.
  const key = (c: Creator) => (c.lastName || c.name || "").toLowerCase().trim();
  const existingKeys = new Set(existing.map(key).filter(Boolean));
  return hydrated.some((creator) => existingKeys.has(key(creator)));
}

// The type goes first, because Zotero re-validates field and type pairs on a
// change. A journal article promoted to a conference paper, for example, keeps
// its venue in proceedingsTitle and not in publicationTitle.
function applyItemType(
  { api, log }: MergeEnv,
  item: ZoteroItem,
  record: NormalizedRecord,
): string[] {
  const typeID = record.itemType ? api.itemTypeID(record.itemType) : null;
  if (!typeID || record.itemType === item.itemType) return [];
  try {
    item.setType(typeID);
    return ["itemType"];
  } catch (error) {
    log(`Metadata Hunter: Failed to set item type: ${error}`);
    return [];
  }
}

// Gated by Zotero's per-type field validity, so a field the (possibly new) item
// type rejects is never written.
function fillMissingFields(
  api: FieldRules,
  item: ZoteroItem,
  record: NormalizedRecord,
): string[] {
  const filled: string[] = [];
  for (const field of FILL_MISSING_FIELDS) {
    const value = trimmed(record.fields[field]);
    if (!value || trimmed(item.getField(field))) continue;
    if (!api.isFieldValidForType(field, item.itemTypeID)) continue;
    item.setField(field, value);
    filled.push(field);
  }
  return filled;
}

// The gate is "no four digit year" and not "empty". Scholar imports often hold
// just a year, and a full date from CrossRef is an upgrade.
function mergeDate(item: ZoteroItem, record: NormalizedRecord): string[] {
  const incoming = trimmed(record.fields.date);
  if (!incoming) return [];
  const existing = trimmed(item.getField("date"));
  const hasYear = /\d{4}/.test(existing);
  const upgradesBareYear =
    /^\d{4}$/.test(existing) && /^\d{4}-\d{2}/.test(incoming);
  if (hasYear && !upgradesBareYear) return [];
  item.setField("date", incoming);
  return ["date"];
}

function mergeAbstract(item: ZoteroItem, record: NormalizedRecord): string[] {
  const incoming = trimmed(record.fields.abstractNote);
  const existing = trimmed(item.getField("abstractNote"));
  const replaces =
    !existing ||
    (existing.length < SHORT_ABSTRACT_LENGTH &&
      incoming.length > existing.length);
  if (!incoming || !replaces) return [];
  item.setField("abstractNote", incoming);
  return ["abstractNote"];
}

function mergeCreators(item: ZoteroItem, record: NormalizedRecord): string[] {
  if (!shouldReplaceCreators(item.getCreators() ?? [], record.creators)) {
    return [];
  }
  item.setCreators(record.creators);
  return ["creators"];
}

// Applies the record in place and returns the names of the fields it changed, so
// a caller can tell a true no-op from a successful enrichment.
export function enrichItemFromMetadata(
  env: MergeEnv,
  item: ZoteroItem,
  record: NormalizedRecord,
): string[] {
  const changed = applyItemType(env, item, record);
  changed.push(...fillMissingFields(env.api, item, record));
  changed.push(...mergeDate(item, record));
  changed.push(...mergeAbstract(item, record));
  changed.push(...mergeCreators(item, record));
  return changed;
}
