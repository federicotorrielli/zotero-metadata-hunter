import type { ZoteroItem } from "../types";

// The slice of Zotero.ItemTreeManager this module calls.
export interface ColumnManager {
  registerColumn(options: Record<string, unknown>): string | false;
}

// A check mark for a regular item that has an abstract. Notes and attachments
// have no abstract field, so their cell stays empty.
export const abstractMark = (item: ZoteroItem): string =>
  item.isRegularItem() && item.getField("abstractNote")?.trim() ? "✓" : "";

// An optional column for the item list. The user switches it on from the column
// picker. Zotero removes it when the plugin is disabled, because of `pluginID`.
export function registerAbstractColumn(
  manager: ColumnManager,
  pluginID: string,
  label: string,
): void {
  manager.registerColumn({
    dataKey: "hasAbstract",
    label,
    pluginID,
    dataProvider: abstractMark,
  });
}
