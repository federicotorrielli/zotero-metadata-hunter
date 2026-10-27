import type { ZoteroItem } from "../types";

// The first author surname usable as a query filter. Institutional creators
// (fieldMode 1) carry `name` and no `lastName`, so they are skipped. Some BibTeX
// imports put an institution first, and without this skip the author filter would
// be dropped instead of using a real person.
export function firstAuthorLastName(item: ZoteroItem): string | null {
  for (const creator of item.getCreators() ?? []) {
    if (creator.lastName && String(creator.lastName).trim()) {
      return String(creator.lastName);
    }
  }
  return null;
}
