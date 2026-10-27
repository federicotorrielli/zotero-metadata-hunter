import type { Creator, ZoteroItem } from "../src/types";

export const TYPE_IDS: Record<string, number> = {
  journalArticle: 1,
  conferencePaper: 2,
  preprint: 3,
  document: 4,
};
const TYPE_NAMES = Object.fromEntries(
  Object.entries(TYPE_IDS).map(([name, id]) => [id, name]),
);
export const typeName = (id: number): string => TYPE_NAMES[id] ?? "";

interface ItemSpec {
  id?: number;
  itemType?: string;
  fields?: Record<string, string>;
  creators?: Creator[];
  tags?: string[];
  regular?: boolean;
  attachments?: number[];
  notes?: number[];
  collections?: number[];
  saveError?: Error;
  linkMode?: number;
  syncState?: number;
  file?: "ok" | "missing" | "empty";
}

export interface FakeItem extends ZoteroItem {
  saves: number;
  fields: Record<string, string>;
  tags: Set<string>;
}

export function makeItem(spec: ItemSpec = {}): FakeItem {
  const fields = { ...spec.fields };
  const tags = new Set(spec.tags);
  let creators = [...(spec.creators ?? [])];
  const item: FakeItem = {
    id: spec.id ?? 1,
    libraryID: 1,
    itemType: spec.itemType ?? "journalArticle",
    itemTypeID: TYPE_IDS[spec.itemType ?? "journalArticle"],
    deleted: false,
    parentItemID: false,
    saves: 0,
    fields,
    tags,
    isRegularItem: () => spec.regular ?? true,
    getField: (name) => fields[name] ?? "",
    setField: (name, value) => {
      fields[name] = value;
    },
    getCreators: () => creators,
    setCreators: (next) => {
      creators = next;
    },
    setType: (id) => {
      item.itemTypeID = id;
      item.itemType = typeName(id);
    },
    hasTag: (tag) => tags.has(tag),
    addTag: (tag) => void tags.add(tag),
    removeTag: (tag) => void tags.delete(tag),
    getCollections: () => spec.collections ?? [],
    getAttachments: () => spec.attachments ?? [],
    getNotes: () => spec.notes ?? [],
    isAttachment: () => spec.linkMode !== undefined,
    attachmentLinkMode: spec.linkMode ?? 0,
    attachmentSyncState: spec.syncState ?? 2,
    getFilePathAsync: async () =>
      spec.file === "missing" ? false : `/storage/${spec.id ?? 1}/file.pdf`,
    saveTx: async () => {
      if (spec.saveError) throw spec.saveError;
      item.saves++;
    },
  };
  return item;
}
