import { describe, expect, it, vi } from "vitest";
import { createZoteroApi } from "../src/zoteroApi";

const target = { libraryID: 3, collections: [7, 8] };
const files = (size: number | Error = 1) => ({
  fileSize: async () => {
    if (size instanceof Error) throw size;
    return size;
  },
});

function fakeZotero(over: Record<string, any> = {}) {
  const calls: Record<string, any[]> = {
    translate: [],
    identifier: [],
    string: [],
    translator: [],
  };
  class Translator {
    constructor(public translators: unknown[] = [{}]) {}
    setIdentifier = (id: unknown) => calls.identifier.push(id);
    setString = (s: unknown) => calls.string.push(s);
    setDocument = vi.fn();
    getTranslators = async () => this.translators;
    setTranslator = (t: unknown) => calls.translator.push(t);
    translate = async (options: unknown): Promise<any[]> => {
      calls.translate.push(options);
      return [{ id: 42 }];
    };
  }
  return {
    calls,
    zotero: {
      ItemTypes: {
        getID: (n: string) => ({ preprint: 3, conferencePaper: 4 })[n] ?? false,
        getName: (id: number) => (id === 3 ? "preprint" : undefined),
      },
      ItemFields: {
        getID: (n: string) => (n === "title" ? 1 : false),
        isValidForType: (_f: number, type: number) => type === 3,
        // publicationTitle is the only base name with a type specific field.
        // Like Zotero: throws without a type, false for a field the type lacks.
        // Here the fake type lacks ISSN.
        getFieldIDFromTypeAndBase: (type: number | false, n: string) => {
          if (!type) throw new Error(`Invalid item type '${type}'`);
          if (n === "ISSN") return false;
          return n === "publicationTitle" ? "proceedingsTitle" : n;
        },
        getName: (id: string) => id,
      },
      Items: {
        getAsync: async (id: number) => (id === 1 ? { id } : false),
      },
      Translate: { Search: Translator, Import: Translator, Web: Translator },
      Attachments: { LINK_MODE_LINKED_URL: 3, LINK_MODE_LINKED_FILE: 2 },
      Sync: {
        Storage: {
          Local: { SYNC_STATE_TO_DOWNLOAD: 1, SYNC_STATE_FORCE_DOWNLOAD: 4 },
        },
      },
      HTTP: {
        processDocuments: async (
          _urls: string[],
          handler: (doc: unknown) => Promise<void>,
        ) => handler({}),
      },
      ...over,
    },
  };
}

describe("createZoteroApi", () => {
  const log = vi.fn();

  it("answers item type and field questions, with null for the unknown", () => {
    const api = createZoteroApi(fakeZotero().zotero, files(), log);
    expect(api.itemTypeID("preprint")).toBe(3);
    expect(api.itemTypeID("nope")).toBeNull();
    expect(api.itemTypeName(3)).toBe("preprint");
    expect(api.itemTypeName(99)).toBe("");
    expect(api.isFieldValidForType("title", 3)).toBe(true);
    expect(api.isFieldValidForType("title", 1)).toBe(false);
    expect(api.isFieldValidForType("unknown", 3)).toBe(false);
  });

  it("gets items", async () => {
    const api = createZoteroApi(fakeZotero().zotero, files(), log);
    expect(await api.getItem(1)).toEqual({ id: 1 });
    expect(await api.getItem(2)).toBeNull();
  });

  it("looks a DOI up without saving and maps base field names", async () => {
    const { zotero, calls } = fakeZotero();
    const creators = [
      { firstName: "Ashish", lastName: "Vaswani", creatorType: "editor" },
      { firstName: "Jane", lastName: null },
      { lastName: "Google", fieldMode: 1, creatorType: "author" },
      { creatorType: "author" },
    ];
    zotero.Translate.Search = class extends zotero.Translate.Search {
      translate = async (options: unknown) => {
        calls.translate.push(options);
        return [
          {
            itemType: "conferencePaper",
            publicationTitle: "NeurIPS",
            volume: 30,
            ISSN: "1234-5678",
            pages: " ",
            creators,
          },
        ];
      };
    };
    const record = await createZoteroApi(zotero, files(), log).lookupDOI(
      "10.1/x",
    );
    expect(calls.translate[0]).toEqual({
      libraryID: false,
      saveAttachments: false,
    });
    expect(record).toEqual({
      itemType: "conferencePaper",
      fields: { proceedingsTitle: "NeurIPS", volume: "30" },
      creators: [
        { firstName: "Ashish", lastName: "Vaswani", creatorType: "editor" },
        {
          firstName: "",
          lastName: "Jane",
          fieldMode: 1,
          creatorType: "author",
        },
        {
          firstName: "",
          lastName: "Google",
          fieldMode: 1,
          creatorType: "author",
        },
      ],
    });
  });

  it("answers null for a record of an unknown item type", async () => {
    const { zotero } = fakeZotero();
    zotero.Translate.Search = class extends zotero.Translate.Search {
      translate = async () => [{ itemType: "hologram", title: "T" }];
    };
    expect(
      await createZoteroApi(zotero, files(), log).lookupDOI("10.1/x"),
    ).toBeNull();
  });

  it("creates from a DOI in the target library without attachments", async () => {
    const { zotero, calls } = fakeZotero();
    const created = await createZoteroApi(zotero, files(), log).fromDOI(
      "10.1/x",
      target,
    );
    expect(created).toEqual({ id: 42 });
    expect(calls.identifier).toEqual([{ DOI: "10.1/x" }]);
    expect(calls.translate[0]).toEqual({
      libraryID: 3,
      collections: [7, 8],
      saveAttachments: false,
    });
  });

  it("returns null when no translator handles the DOI", async () => {
    const { zotero } = fakeZotero();
    zotero.Translate.Search = class {
      setIdentifier() {}
      getTranslators = async () => [];
    } as any;
    expect(
      await createZoteroApi(zotero, files(), log).fromDOI("10.1/x", target),
    ).toBeNull();
  });

  it("imports BibTeX with the bundled translator", async () => {
    const { zotero, calls } = fakeZotero();
    await createZoteroApi(zotero, files(), log).fromBibtex("@a{}", target);
    expect(calls.string).toEqual(["@a{}"]);
    expect(calls.translator).toEqual(["9cb70025-a888-4a29-a210-93ec52da40d4"]);
  });

  it("creates from a URL through the web translator", async () => {
    const { zotero } = fakeZotero();
    expect(
      await createZoteroApi(zotero, files(), log).fromURL(
        "https://x.org",
        target,
      ),
    ).toEqual({ id: 42 });
  });

  it("logs a translator error and answers null", async () => {
    const { zotero } = fakeZotero();
    zotero.Translate.Search = class {
      setIdentifier() {}
      getTranslators = async () => {
        throw new Error("network");
      };
    } as any;
    const messages: string[] = [];
    const api = createZoteroApi(
      zotero,
      files(),
      (m: string) => void messages.push(m),
    );
    expect(await api.fromDOI("10.1/x", target)).toBeNull();
    expect(messages[0]).toContain("Failed to create item from DOI 10.1/x");
  });

  describe("attachmentState", () => {
    const attachment = (over: Record<string, unknown> = {}) =>
      ({
        isAttachment: () => true,
        attachmentLinkMode: 0,
        attachmentSyncState: 2,
        getFilePathAsync: async () => "/storage/ABC/paper.pdf",
        ...over,
      }) as any;
    const state = (item: any, size: number | Error = 1) =>
      createZoteroApi(fakeZotero().zotero, files(size), log).attachmentState(
        item,
      );

    it("calls a stored file with content healthy", async () => {
      expect(await state(attachment())).toBe("healthy");
    });

    it("leaves notes and link-only attachments alone", async () => {
      expect(await state(attachment({ isAttachment: () => false }))).toBe(
        "not-a-file",
      );
      expect(await state(attachment({ attachmentLinkMode: 3 }))).toBe(
        "not-a-file",
      );
    });

    it("calls a file that is not on disk broken", async () => {
      expect(
        await state(attachment({ getFilePathAsync: async () => false })),
      ).toBe("broken");
    });

    it("keeps a linked file it cannot reach, and judges one it can reach", async () => {
      const linked = { attachmentLinkMode: 2 };
      const unreachable = attachment({
        ...linked,
        getFilePathAsync: async () => false,
      });
      expect(await state(unreachable)).toBe("unreachable");
      expect(await state(attachment(linked), 0)).toBe("broken");
    });

    it("calls an empty or unreadable file broken", async () => {
      expect(await state(attachment(), 0)).toBe("broken");
      expect(await state(attachment(), new Error("denied"))).toBe("broken");
    });

    it("keeps a file that is only waiting to download", async () => {
      const missing = { getFilePathAsync: async () => false };
      expect(
        await state(attachment({ ...missing, attachmentSyncState: 1 })),
      ).toBe("awaiting-download");
      expect(
        await state(attachment({ ...missing, attachmentSyncState: 4 })),
      ).toBe("awaiting-download");
    });
  });
});
