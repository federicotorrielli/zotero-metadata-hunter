import type { ZoteroItem } from "../types";

// Persistent tags on items that could not be processed. Users filter their
// library by them to find items that need attention, and a later successful run
// removes them. Any code path that resolves an item must clear its tags, or
// stale ones accumulate.
export const TAG_NO_DOI = "MetadataHunter: No DOI";
export const TAG_NO_PUBLISHED = "MetadataHunter: No Published Version";
export const TAG_UPDATE_FAILED = "MetadataHunter: Update Failed";
export const TAG_NO_RICHER_RECORD = "MetadataHunter: No Richer Record";

// The mutators change the item in memory and say whether anything changed, so a
// caller can batch every edit of an item into one save.
function addFailureTag(item: ZoteroItem, tag: string): boolean {
  if (item.hasTag(tag)) return false;
  item.addTag(tag);
  return true;
}

export function removeFailureTags(item: ZoteroItem, tags: string[]): boolean {
  const present = tags.filter((tag) => item.hasTag(tag));
  for (const tag of present) item.removeTag(tag);
  return present.length > 0;
}

// Tagging is best effort: a failed save is logged and does not fail the run.
export async function setFailureTag(
  item: ZoteroItem,
  tag: string,
  log: (message: string) => void,
): Promise<void> {
  try {
    if (addFailureTag(item, tag)) await item.saveTx();
  } catch (error) {
    log(`Metadata Hunter: Failed to add tag "${tag}" to item: ${error}`);
  }
}
