// The slice of Zotero's objects this plugin uses. Zotero has no types of its own, so
// each interface lists only what the code calls, which keeps test doubles small.

export interface Creator {
  firstName?: string;
  lastName?: string;
  name?: string;
  fieldMode?: number;
  creatorType?: string;
}

export interface ZoteroItem {
  id: number;
  libraryID: number;
  itemType: string;
  itemTypeID: number;
  deleted: boolean;
  parentItemID: number | false | null;
  isRegularItem(): boolean;
  getField(name: string): string;
  setField(name: string, value: string): void;
  getCreators(): Creator[];
  setCreators(creators: Creator[]): void;
  setType(itemTypeID: number): void;
  hasTag(tag: string): boolean;
  addTag(tag: string): void;
  removeTag(tag: string): void;
  getCollections(): number[];
  getAttachments(): number[];
  getNotes(): number[];
  isAttachment(): boolean;
  attachmentLinkMode: number;
  attachmentSyncState: number;
  getFilePathAsync(): Promise<string | false>;
  saveTx(): Promise<unknown>;
}

export interface TreeRow {
  isTrash(): boolean;
  isFeedsOrFeed(): boolean;
  isBucket(): boolean;
  isShare(): boolean;
  getItems(options: { unfiltered: boolean }): Promise<ZoteroItem[]>;
}

export interface ZoteroPane {
  getSelectedItems(): ZoteroItem[];
  getCollectionTreeRows(): TreeRow[];
}

// Semantic Scholar can return the DOI and the abstract in one request, so a DOI
// result may carry the abstract and spare a second lookup.
export interface DOIResult {
  doi: string;
  abstract: string | null;
}

// A published reference is a DOI, a venue URL (e.g. PMLR), or a BibTeX record
// carried alongside the URL it came from. Venues like ICLR publish through
// OpenReview and never assign DOIs, so a DOI alone cannot describe them.
export type PublishedRef =
  { doi: string } | { url: string } | { bibtex: string; url: string };

// What a child item holds. "not-a-file" covers notes and link-only attachments.
// "awaiting-download" is a file Zotero has on its server and has not fetched yet.
// "unreachable" is a linked file whose path is not reachable from this computer,
// for example on a drive that is not mounted. Both look missing here and must not
// be treated as broken.
export type AttachmentState =
  "not-a-file" | "healthy" | "awaiting-download" | "unreachable" | "broken";

export interface TranslateTarget {
  libraryID: number;
  collections: number[];
}

// Everything the flows need from Zotero besides the item objects themselves.
// The real one lives in zoteroApi.ts. Tests pass a fake.
export interface ZoteroApi {
  itemTypeID(name: string): number | null;
  itemTypeName(itemTypeID: number): string;
  isFieldValidForType(field: string, itemTypeID: number): boolean;
  getItem(id: number): Promise<ZoteroItem | null>;
  attachmentState(item: ZoteroItem): Promise<AttachmentState>;
  eraseItem(id: number): Promise<void>;
  // Each translator call saves the new item to the library. All three resolve to
  // null when no translator or no result is available.
  fromDOI(doi: string, target: TranslateTarget): Promise<ZoteroItem | null>;
  fromURL(url: string, target: TranslateTarget): Promise<ZoteroItem | null>;
  fromBibtex(
    bibtex: string,
    target: TranslateTarget,
  ): Promise<ZoteroItem | null>;
}
