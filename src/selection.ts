import type { TreeRow, ZoteroItem, ZoteroPane } from "./types";

// Rows whose items a run must never edit.
function isEditableRow(row: TreeRow): boolean {
  return !(
    row.isTrash() ||
    row.isFeedsOrFeed() ||
    row.isBucket() ||
    row.isShare()
  );
}

// One item can belong to several selected rows.
export function uniqueByID(items: Iterable<ZoteroItem>): ZoteroItem[] {
  return [...new Map([...items].map((item) => [item.id, item])).values()];
}

// The items a library wide run acts on: the explicit item selection when there is
// one, otherwise every item of the selected rows (collections, saved searches,
// libraries and the like). Search filters are ignored, so a run covers the whole
// row, and the "show items from subcollections" setting applies.
export async function resolveTargetItems(
  pane: ZoteroPane,
): Promise<ZoteroItem[]> {
  const selected = pane.getSelectedItems();
  if (selected.length > 0) return selected;

  const rows = pane.getCollectionTreeRows().filter(isEditableRow);
  const itemsPerRow = await Promise.all(
    rows.map((row) => row.getItems({ unfiltered: true })),
  );
  return uniqueByID(itemsPerRow.flat());
}
