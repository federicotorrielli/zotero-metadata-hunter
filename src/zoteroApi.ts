import type {
  AttachmentState,
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
  target: TranslateTarget,
): Promise<ZoteroItem[] | undefined> {
  const translate = new zotero.Translate.Search();
  translate.setIdentifier({ DOI: doi });
  const translators = await translate.getTranslators();
  if (!translators.length) return undefined;
  translate.setTranslator(translators);
  return translate.translate(translateOptions(target));
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
// translators save what they create, so every method here returns the saved item.
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
    eraseItem: (id) => zotero.Items.erase(id),
    fromDOI: (doi, target) =>
      attempt(`DOI ${doi}`, () => translateDOI(zotero, doi, target)),
    fromURL: (url, target) =>
      attempt(`URL ${url}`, () => translateURL(zotero, url, target)),
    fromBibtex: (bibtex, target) =>
      attempt("BibTeX", () => translateBibtex(zotero, bibtex, target)),
  };
}
