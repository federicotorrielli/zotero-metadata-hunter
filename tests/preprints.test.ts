import { describe, expect, it, vi } from "vitest";
import {
  createItemFromPublished,
  createPreprintAction,
  findPublishedDOI,
  migrateChildren,
  promoteDocumentToPreprint,
} from "../src/flows/preprints";
import { TAG_NO_PUBLISHED, TAG_UPDATE_FAILED } from "../src/flows/tags";
import { makeHarness, makeItem, TYPE_IDS } from "./harness";

const title = "Attention Is All You Need";
const preprint = (over: Record<string, unknown> = {}) =>
  makeItem({
    itemType: "preprint",
    fields: { title, DOI: "10.48550/arXiv.1706.03762" },
    collections: [7],
    ...over,
  });
const published = (id = 99) =>
  makeItem({ id, itemType: "conferencePaper", fields: { title } });

const source = (name: string, ref: unknown) => ({
  name,
  find: vi.fn(async () => {
    if (ref instanceof Error) throw ref;
    return ref as any;
  }),
});

describe("findPublishedDOI", () => {
  it("answers from the arXiv entry first and skips the race", async () => {
    const h = makeHarness();
    h.lookups.publishedByArxivId = async () => "10.1/pub";
    const raced = source("S", { doi: "10.1/other" });
    h.lookups.published.push(raced);
    const lookup = await findPublishedDOI(h.deps, preprint());
    expect(lookup.ref).toEqual({ doi: "10.1/pub" });
    expect(raced.find).not.toHaveBeenCalled();
  });

  it("races the other sources and keeps the first result", async () => {
    const h = makeHarness();
    h.lookups.published.push(
      source("A", new Error("429")),
      source("B", null),
      source("C", { url: "https://pmlr.press/x" }),
    );
    const lookup = await findPublishedDOI(h.deps, preprint());
    expect(lookup.ref).toEqual({ url: "https://pmlr.press/x" });
    expect(lookup.failedSources).toContain("A");
  });

  it("is unchecked when every source threw", async () => {
    const h = makeHarness();
    h.lookups.published.push(
      source("A", new Error("x")),
      source("B", new Error("y")),
    );
    const lookup = await findPublishedDOI(
      h.deps,
      preprint({ fields: { title } }),
    );
    expect(lookup).toMatchObject({ ref: null, unchecked: true });
  });

  it("is checked when a source answered no", async () => {
    const h = makeHarness();
    h.lookups.published.push(source("A", new Error("x")), source("B", null));
    expect((await findPublishedDOI(h.deps, preprint())).unchecked).toBe(false);
  });
});

describe("createItemFromPublished", () => {
  it("creates from a DOI in the source's library and collections", async () => {
    const h = makeHarness();
    h.api.next.doi = published();
    const created = await createItemFromPublished(
      h.deps,
      { doi: "10.1/x" },
      preprint(),
    );
    expect(created?.id).toBe(99);
    expect(h.api.created).toEqual([
      { kind: "doi", arg: "10.1/x", collections: [7] },
    ]);
  });

  it("imports BibTeX and fills in a missing URL", async () => {
    const h = makeHarness();
    const created = published();
    h.api.next.bibtex = created;
    await createItemFromPublished(
      h.deps,
      { bibtex: "@a{}", url: "https://o.net/f" },
      preprint(),
    );
    expect(created.getField("url")).toBe("https://o.net/f");
    expect(created.saves).toBe(1);
  });

  it("keeps the URL the BibTeX already carried", async () => {
    const h = makeHarness();
    const created = makeItem({ id: 5, fields: { url: "https://own" } });
    h.api.next.bibtex = created;
    await createItemFromPublished(
      h.deps,
      { bibtex: "@a{}", url: "https://o.net/f" },
      preprint(),
    );
    expect(created.getField("url")).toBe("https://own");
    expect(created.saves).toBe(0);
  });

  it("keeps the new item when saving the URL fails", async () => {
    const h = makeHarness();
    const created = makeItem({ id: 5, saveError: new Error("db") });
    h.api.next.bibtex = created;
    const result = await createItemFromPublished(
      h.deps,
      { bibtex: "@a{}", url: "https://o.net/f" },
      preprint(),
    );
    expect(result).toBe(created);
    expect(h.logs.some((m) => m.includes("Failed to set the URL"))).toBe(true);
  });

  it("uses the web translator for a bare URL", async () => {
    const h = makeHarness();
    h.api.next.url = published();
    await createItemFromPublished(
      h.deps,
      { url: "https://pmlr.press/x" },
      preprint(),
    );
    expect(h.api.created[0].kind).toBe("url");
  });
});

describe("migrateChildren", () => {
  it("moves attachments and notes and counts them", async () => {
    const h = makeHarness();
    const pdf = makeItem({ id: 10, itemType: "document" });
    const note = makeItem({ id: 11 });
    h.api.store.set(10, pdf);
    h.api.store.set(11, note);
    const target = published(99);
    const result = await migrateChildren(
      h.deps,
      preprint({ attachments: [10], notes: [11] }),
      target,
    );
    expect(result).toEqual({ moved: 2, trashed: 0 });
    expect(pdf.parentItemID).toBe(99);
    expect(note.parentItemID).toBe(99);
  });

  it("trashes an attachment whose file is missing or empty and keeps the rest", async () => {
    const h = makeHarness();
    const broken = makeItem({ id: 10 });
    const waiting = makeItem({ id: 11 });
    const healthy = makeItem({ id: 12 });
    const note = makeItem({ id: 13 });
    for (const child of [broken, waiting, healthy, note])
      h.api.store.set(child.id, child);
    h.api.attachmentStates.set(10, "broken");
    h.api.attachmentStates.set(11, "awaiting-download");
    h.api.attachmentStates.set(13, "not-a-file");
    const result = await migrateChildren(
      h.deps,
      preprint({ attachments: [10, 11, 12], notes: [13] }),
      published(99),
    );
    expect(result).toEqual({ moved: 3, trashed: 1 });
    expect(broken.deleted).toBe(true);
    expect(broken.parentItemID).toBe(false);
    expect(broken.saves).toBe(1);
    for (const kept of [waiting, healthy, note]) {
      expect(kept.deleted).toBe(false);
      expect(kept.parentItemID).toBe(99);
    }
  });

  it("logs a child that cannot move and moves the rest", async () => {
    const h = makeHarness();
    h.api.store.set(10, makeItem({ id: 10, saveError: new Error("locked") }));
    h.api.store.set(11, makeItem({ id: 11 }));
    const count = await migrateChildren(
      h.deps,
      preprint({ attachments: [10, 11] }),
      published(),
    );
    expect(count).toEqual({ moved: 1, trashed: 0 });
    expect(h.logs.some((m) => m.includes("re-parent child 10"))).toBe(true);
  });
});

describe("promoteDocumentToPreprint", () => {
  it("retypes a document and ignores other types", async () => {
    const h = makeHarness();
    const doc = makeItem({ itemType: "document" });
    expect(await promoteDocumentToPreprint(h.deps, doc)).toBe(true);
    expect(doc.itemTypeID).toBe(TYPE_IDS.preprint);
    expect(await promoteDocumentToPreprint(h.deps, makeItem())).toBe(false);
  });
});

describe("preprint action", () => {
  async function run(items: ReturnType<typeof makeItem>[], h = makeHarness()) {
    const action = createPreprintAction(h.deps, "library");
    const result = await action.process(items, h.cancel);
    return { result, message: action.message(result) };
  }

  it("replaces the preprint and moves its children before trashing it", async () => {
    const h = makeHarness();
    h.lookups.publishedByArxivId = async () => "10.1/pub";
    const newItem = published();
    h.api.next.doi = newItem;
    const pdf = makeItem({ id: 10 });
    h.api.store.set(10, pdf);
    const source = preprint({ attachments: [10] });
    const order: string[] = [];
    const save = source.saveTx;
    source.saveTx = async () => {
      order.push(
        `source deleted=${source.deleted}, child parent=${pdf.parentItemID}`,
      );
      return save();
    };
    const { result, message } = await run([source], h);
    expect(order).toEqual(["source deleted=true, child parent=99"]);
    expect(result).toMatchObject({ found: 1, migratedChildren: 1 });
    expect(message).toContain("Found a published version for 1 of them.");
    expect(message).toContain("Moved 1 attachment or note");
  });

  it("reports the attachments it trashed", async () => {
    const h = makeHarness();
    h.lookups.publishedByArxivId = async () => "10.1/pub";
    h.api.next.doi = published();
    const dead = makeItem({ id: 10 });
    h.api.store.set(10, dead);
    h.api.attachmentStates.set(10, "broken");
    const { result, message } = await run([preprint({ attachments: [10] })], h);
    expect(result).toMatchObject({
      trashedAttachments: 1,
      migratedChildren: 0,
    });
    expect(message).toContain(
      "Moved 1 attachment to the trash, because its file was missing or empty.",
    );
  });

  it("tags a preprint with no published version and promotes a document", async () => {
    const h = makeHarness();
    h.lookups.published.push(source("A", null));
    const doc = makeItem({
      itemType: "document",
      fields: { title, url: "https://arxiv.org/abs/1706.03762" },
    });
    const { result, message } = await run([doc], h);
    expect(doc.hasTag(TAG_NO_PUBLISHED)).toBe(true);
    expect(doc.itemTypeID).toBe(TYPE_IDS.preprint);
    expect(result).toMatchObject({
      taggedNoPublished: 1,
      convertedToPreprint: 1,
    });
    expect(message).toContain(
      'Changed 1 generic "document" item to the "preprint" item type.',
    );
  });

  it("tags the failure when a published version is found but not created", async () => {
    const h = makeHarness();
    h.lookups.published.push(source("A", { doi: "10.1/x" }));
    h.api.next.doi = null;
    const item = preprint();
    const { result } = await run([item], h);
    expect(item.hasTag(TAG_UPDATE_FAILED)).toBe(true);
    expect(item.deleted).toBe(false);
    expect(result.taggedFailed).toBe(1);
  });

  it("tags a preprint whose worker threw", async () => {
    const h = makeHarness();
    h.lookups.published.push(source("A", { doi: "10.1/x" }));
    h.api.next.doi = new Error("translator crashed");
    const item = preprint();
    const { result } = await run([item], h);
    expect(item.hasTag(TAG_UPDATE_FAILED)).toBe(true);
    expect(result).toMatchObject({ hadApiErrors: true, taggedFailed: 1 });
  });

  it("leaves an unchecked preprint untagged", async () => {
    const h = makeHarness();
    h.lookups.published.push(source("A", new Error("429")));
    const item = preprint({ fields: { title } });
    const { result } = await run([item], h);
    expect(item.tags.size).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("ends after a cancel and leaves the remaining preprints alone", async () => {
    const h = makeHarness({ batchSize: () => 1 });
    h.lookups.published.push({
      name: "A",
      find: async () => {
        h.cancel.cancel();
        return null;
      },
    });
    const items = [1, 2].map((id) => preprint({ id, fields: { title } }));
    const { result, message } = await run(items, h);
    expect(result).toMatchObject({ cancelled: true, processed: 1 });
    expect(items[1].tags.size).toBe(0);
    expect(message).toContain("Stopped after 1 preprint.");
  });

  it("selects only preprints", () => {
    const h = makeHarness();
    const action = createPreprintAction(h.deps, "selection");
    const keep = preprint({ id: 1 });
    const drop = makeItem({ id: 2, itemType: "conferencePaper" });
    expect(action.select([keep, drop])).toEqual([keep]);
    expect(action.emptyKey).toBe("preprint-none-found-selected");
  });
});
