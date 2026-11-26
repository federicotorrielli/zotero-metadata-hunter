import { SNAPSHOT_FIELDS, type NormalizedRecord } from "./domain/merge";
import type {
  AttachmentState,
  Creator,
  TranslateTarget,
  ZoteroApi,
  ZoteroItem,
} from "./types";

export interface FileSystem {
  fileSize(path: string): Promise<number>;
}

// Zotero's bundled BibTeX import translator.
const BIBTEX_TRANSLATOR_ID = "9cb70025-a888-4a29-a210-93ec52da40d4";

const translateOptions = ({ libraryID, collections }: TranslateTarget) => ({
  libraryID,
  collections,
  saveAttachments: false,
});

async function translateDOI(
  zotero: any,
  doi: string,
  options: object,
): Promise<any[] | undefined> {
  const translate = new zotero.Translate.Search();
  translate.setIdentifier({ DOI: doi });
  const translators = await translate.getTranslators();
  if (!translators.length) return undefined;
  translate.setTranslator(translators);
  return translate.translate(options);
}

// Zotero cleans translator creators when it saves an item, and nothing is saved
// here. `setCreators` throws on an entry without a type or without a string
// last name, after it has already overwritten the entries before it. So every
// entry is made valid here, and one with no name at all is dropped.
function toCreator(raw: any): Creator | null {
  const text = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";
  const first = text(raw.firstName);
  const last = text(raw.lastName) || text(raw.name);
  if (!first && !last) return null;
  const creatorType = text(raw.creatorType) || "author";
  // A single-field name: an institution, or a person with only a given name,
  // which Zotero rejects in two-field form.
  if (!last || raw.fieldMode === 1) {
    const lastName = [first, last].filter(Boolean).join(" ");
    return { firstName: "", lastName, fieldMode: 1, creatorType };
  }
  return { firstName: first, lastName: last, creatorType };
}

// A translator may use the base name of a field (publicationTitle) where the
// item type has its own (proceedingsTitle). Zotero maps these when it saves an
// item, and nothing is saved here, so the mapping is done by hand.
function toRecord(zotero: any, json: any): NormalizedRecord | null {
  const typeID = zotero.ItemTypes.getID(json.itemType);
  if (!typeID) return null;
  const fields: Record<string, string> = {};
  for (const name of SNAPSHOT_FIELDS) {
    const value = String(json[name] ?? "").trim();
    const fieldID =
      value && zotero.ItemFields.getFieldIDFromTypeAndBase(typeID, name);
    if (fieldID) fields[zotero.ItemFields.getName(fieldID)] = value;
  }
  const creators = (json.creators ?? [])
    .map(toCreator)
    .filter((creator: Creator | null) => creator !== null);
  return { itemType: json.itemType, fields, creators };
}

// `libraryID: false` makes the translator return plain item JSON and save
// nothing. No item is added to the library, so no notifier event fires and no
// other plugin sees a duplicate of the item being enriched.
async function lookupDOI(
  zotero: any,
  doi: string,
): Promise<NormalizedRecord | null> {
  const found = await translateDOI(zotero, doi, {
    libraryID: false,
    saveAttachments: false,
  });
  return found?.[0] ? toRecord(zotero, found[0]) : null;
}

// The web translator, like dragging a URL into Zotero. It handles venues such as
// ICLR that publish through OpenReview without assigning DOIs.
async function translateURL(
  zotero: any,
  url: string,
  target: TranslateTarget,
): Promise<ZoteroItem[] | undefined> {
  let created: ZoteroItem[] | undefined;
  await zotero.HTTP.processDocuments([url], async (doc: any) => {
    const translate = new zotero.Translate.Web();
    translate.setDocument(doc);
    const translators = await translate.getTranslators();
    if (!translators.length) return;
    translate.setTranslator(translators);
    created = await translate.translate(translateOptions(target));
  });
  return created;
}

// The translator chooses the item type from the entry type and parses authors,
// venue and year. Building those fields by hand would duplicate it and get the
// edge cases wrong.
async function translateBibtex(
  zotero: any,
  bibtex: string,
  target: TranslateTarget,
): Promise<ZoteroItem[] | undefined> {
  const translate = new zotero.Translate.Import();
  translate.setString(bibtex);
  translate.setTranslator(BIBTEX_TRANSLATOR_ID);
  return translate.translate(translateOptions(target));
}

// A file that cannot be read counts as empty, so it counts as broken.
async function sizeOf(io: FileSystem, path: string): Promise<number> {
  try {
    return await io.fileSize(path);
  } catch {
    return 0;
  }
}

async function classifyAttachment(
  zotero: any,
  io: FileSystem,
  item: ZoteroItem,
): Promise<AttachmentState> {
  const { Attachments, Sync } = zotero;
  const isLinkOnly =
    item.attachmentLinkMode === Attachments.LINK_MODE_LINKED_URL;
  if (!item.isAttachment() || isLinkOnly) return "not-a-file";

  const path = await item.getFilePathAsync();
  if (path && (await sizeOf(io, path)) > 0) return "healthy";
  const isLinkedFile =
    item.attachmentLinkMode === Attachments.LINK_MODE_LINKED_FILE;
  if (isLinkedFile && !path) return "unreachable";

  const { SYNC_STATE_TO_DOWNLOAD, SYNC_STATE_FORCE_DOWNLOAD } =
    Sync.Storage.Local;
  const waiting = [SYNC_STATE_TO_DOWNLOAD, SYNC_STATE_FORCE_DOWNLOAD];
  return waiting.includes(item.attachmentSyncState)
    ? "awaiting-download"
    : "broken";
}

// The only place that talks to Zotero's translators and item registries. The
// `from*` methods save what the translator creates and return the saved item.
export function createZoteroApi(
  zotero: any,
  io: FileSystem,
  log: (message: string) => void,
): ZoteroApi {
  // A failed translation becomes null, because losing one new item must not abort
  // the run. The caller tags the source item instead.
  async function attempt(
    what: string,
    translate: () => Promise<ZoteroItem[] | undefined>,
  ): Promise<ZoteroItem | null> {
    try {
      return (await translate())?.[0] ?? null;
    } catch (error) {
      log(`Metadata Hunter: Failed to create item from ${what}: ${error}`);
      return null;
    }
  }

  return {
    itemTypeID: (name) => zotero.ItemTypes.getID(name) || null,
    itemTypeName: (id) => zotero.ItemTypes.getName(id) ?? "",
    isFieldValidForType(field, itemTypeID) {
      const fieldID = zotero.ItemFields.getID(field);
      return !!fieldID && zotero.ItemFields.isValidForType(fieldID, itemTypeID);
    },
    getItem: async (id) => (await zotero.Items.getAsync(id)) || null,
    attachmentState: (item) => classifyAttachment(zotero, io, item),
    lookupDOI: (doi) => lookupDOI(zotero, doi),
    fromDOI: (doi, target) =>
      attempt(`DOI ${doi}`, () =>
        translateDOI(zotero, doi, translateOptions(target)),
      ),
    fromURL: (url, target) =>
      attempt(`URL ${url}`, () => translateURL(zotero, url, target)),
    fromBibtex: (bibtex, target) =>
      attempt("BibTeX", () => translateBibtex(zotero, bibtex, target)),
  };
}
