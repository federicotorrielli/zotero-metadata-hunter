import { describe, expect, it } from "vitest";
import {
  analyzeItemsForEnrichment,
  createEnrichAction,
  enrichItemMetadata,
  fetchRichRecordByDOI,
  hasSparseMetadata,
  normalizeScratch,
} from "../src/flows/enrich";
import {
  TAG_NO_DOI,
  TAG_NO_RICHER_RECORD,
  TAG_UPDATE_FAILED,
} from "../src/flows/tags";
import { doiSource, makeHarness, makeItem } from "./harness";

const title = "Attention Is All You Need";
const sparse = (over: Record<string, unknown> = {}) =>
  makeItem({
    itemType: "conferencePaper",
    fields: { title, DOI: "10.1/real" },
    creators: [{ lastName: "Vaswani" }],
    ...over,
  });
const hydrated = (over: Record<string, unknown> = {}) =>
  makeItem({
    id: 500,
    itemType: "conferencePaper",
    fields: {
      title,
      proceedingsTitle: "NeurIPS",
      pages: "1-11",
      volume: "30",
      abstractNote: "Full abstract.",
    },
    creators: [{ lastName: "Vaswani" }, { lastName: "Shazeer" }],
    ...over,
  });

describe("hasSparseMetadata", () => {
  it("needs a venue, abstract, pages and volume", () => {
    const complete = makeItem({
      fields: {
        publicationTitle: "V",
        abstractNote: "a",
        pages: "1",
        volume: "2",
      },
    });
    expect(hasSparseMetadata(complete)).toBe(false);
    expect(
      hasSparseMetadata(
        makeItem({ fields: { ...complete.fields, volume: "" } }),
      ),
    ).toBe(true);
    const conference = makeItem({
      fields: {
        proceedingsTitle: "P",
        abstractNote: "a",
        pages: "1",
        volume: "2",
      },
    });
    expect(hasSparseMetadata(conference)).toBe(false);
    expect(hasSparseMetadata(makeItem())).toBe(true);
  });

  it("filters library runs to enrichable sparse items", () => {
    const keep = sparse({ id: 1 });
    const preprint = makeItem({ id: 2, itemType: "preprint" });
    expect(analyzeItemsForEnrichment([keep, preprint])).toEqual([keep]);
  });
});

describe("normalizeScratch and fetchRichRecordByDOI", () => {
  it("snapshots the type, the valid non-empty fields and the creators", () => {
    const h = makeHarness();
    const record = normalizeScratch(h.api, hydrated());
    expect(record.itemType).toBe("conferencePaper");
    expect(record.fields).toMatchObject({ pages: "1-11", volume: "30" });
    expect(record.fields.ISSN).toBeUndefined();
    expect(record.creators).toHaveLength(2);
  });

  it("erases the scratch item after taking the snapshot", async () => {
    const h = makeHarness();
    h.api.next.doi = hydrated();
    const record = await fetchRichRecordByDOI(h.deps, "10.1/real", sparse());
    expect(record?.fields.pages).toBe("1-11");
    expect(h.api.erased).toEqual([500]);
    expect(h.api.created[0].collections).toEqual([]);
  });

  it("erases the scratch even when the snapshot fails", async () => {
    const h = makeHarness();
    const scratch = hydrated();
    scratch.getCreators = () => {
      throw new Error("boom");
    };
    h.api.next.doi = scratch;
    expect(
      await fetchRichRecordByDOI(h.deps, "10.1/real", sparse()),
    ).toBeNull();
    expect(h.api.erased).toEqual([500]);
  });

  it("returns null and erases nothing when no item came back", async () => {
    const h = makeHarness();
    expect(
      await fetchRichRecordByDOI(h.deps, "10.1/real", sparse()),
    ).toBeNull();
    expect(h.api.erased).toEqual([]);
  });

  it("logs a failed erase and still returns the record", async () => {
    const h = makeHarness();
    h.api.next.doi = hydrated();
    h.api.eraseItem = async () => {
      throw new Error("locked");
    };
    expect(
      await fetchRichRecordByDOI(h.deps, "10.1/real", sparse()),
    ).not.toBeNull();
    expect(h.logs.some((m) => m.includes("Failed to erase scratch"))).toBe(
      true,
    );
  });
});

describe("enrichItemMetadata", () => {
  it("merges the record and saves the item once", async () => {
    const h = makeHarness();
    h.api.next.doi = hydrated();
    const item = sparse({ tags: [TAG_NO_RICHER_RECORD] });
    const outcome = await enrichItemMetadata(h.deps, item);
    expect(outcome.changed).toEqual(
      expect.arrayContaining([
        "proceedingsTitle",
        "pages",
        "volume",
        "abstractNote",
        "creators",
      ]),
    );
    expect(item.saves).toBe(1);
    expect(item.hasTag(TAG_NO_RICHER_RECORD)).toBe(false);
  });

  it("tags an item the record adds nothing to", async () => {
    const h = makeHarness();
    h.api.next.doi = makeItem({
      id: 500,
      itemType: "conferencePaper",
      fields: { title },
    });
    const item = sparse();
    const outcome = await enrichItemMetadata(h.deps, item);
    expect(outcome.changed).toEqual([]);
    expect(item.hasTag(TAG_NO_RICHER_RECORD)).toBe(true);
  });

  it("does not merge a record that came back as a preprint", async () => {
    const h = makeHarness();
    h.api.next.doi = hydrated({ itemType: "preprint" });
    const item = sparse();
    const outcome = await enrichItemMetadata(h.deps, item);
    expect(outcome.changed).toEqual([]);
    expect(item.itemType).toBe("conferencePaper");
    expect(item.hasTag(TAG_NO_RICHER_RECORD)).toBe(true);
  });

  it("tags a failed lookup", async () => {
    const h = makeHarness();
    const item = sparse();
    expect(await enrichItemMetadata(h.deps, item)).toEqual({ failed: true });
    expect(item.hasTag(TAG_UPDATE_FAILED)).toBe(true);
  });

  it("looks a missing DOI up and saves it before merging", async () => {
    const h = makeHarness();
    h.lookups.doiCascade.push(
      doiSource("A", { doi: "10.1/new", abstract: "Bundled." }),
    );
    h.api.next.doi = hydrated();
    const item = sparse({ fields: { title }, tags: [TAG_NO_DOI] });
    await enrichItemMetadata(h.deps, item);
    expect(item.fields.DOI).toBe("10.1/new");
    expect(item.hasTag(TAG_NO_DOI)).toBe(false);
    expect(h.api.created[0].arg).toBe("10.1/new");
  });

  it("tags an item no source has a DOI for, and leaves an unchecked one alone", async () => {
    const none = makeHarness();
    none.lookups.doiCascade.push(doiSource("A", null));
    const tagged = sparse({ fields: { title } });
    expect(await enrichItemMetadata(none.deps, tagged)).toMatchObject({
      noDOI: true,
    });
    expect(tagged.hasTag(TAG_NO_DOI)).toBe(true);

    const down = makeHarness();
    down.lookups.doiCascade.push(doiSource("A", new Error("429")));
    const unchanged = sparse({ fields: { title } });
    expect(await enrichItemMetadata(down.deps, unchanged)).toMatchObject({
      unchecked: true,
      failedSources: ["A"],
    });
    expect(unchanged.tags.size).toBe(0);
  });

  it("will not use an arXiv DOI on a published item without a better one", async () => {
    const h = makeHarness();
    const item = sparse({
      fields: { title, DOI: "10.48550/arXiv.1706.03762" },
    });
    const outcome = await enrichItemMetadata(h.deps, item);
    expect(outcome.changed).toEqual([]);
    expect(h.api.created).toEqual([]);
    expect(item.hasTag(TAG_NO_RICHER_RECORD)).toBe(true);
  });

  it("swaps an arXiv DOI for the published one before merging", async () => {
    const h = makeHarness();
    h.lookups.publishedByArxivId = async () => "10.1/pub";
    h.api.next.doi = hydrated();
    const item = sparse({
      fields: { title, DOI: "10.48550/arXiv.1706.03762" },
    });
    await enrichItemMetadata(h.deps, item);
    expect(item.fields.DOI).toBe("10.1/pub");
    expect(h.api.created[0].arg).toBe("10.1/pub");
  });

  it("skips items that are not enrichable", async () => {
    const h = makeHarness();
    expect(
      await enrichItemMetadata(h.deps, makeItem({ itemType: "preprint" })),
    ).toEqual({ skipped: true });
  });
});

describe("enrich action", () => {
  it("counts enriched items and filled fields, and words the result", async () => {
    const h = makeHarness();
    h.api.next.doi = hydrated();
    const action = createEnrichAction(h.deps, "library");
    const result = await action.process([sparse()], h.cancel);
    expect(result.enriched).toBe(1);
    expect(result.fieldsFilled).toBeGreaterThan(0);
    expect(action.message(result)).toMatch(
      /^Checked 1 item\. Enriched 1 of them, filling \d+ fields?\.$/,
    );
  });

  it("tags an item whose worker threw", async () => {
    const h = makeHarness();
    h.api.next.doi = hydrated();
    const item = sparse({ saveError: new Error("locked") });
    const action = createEnrichAction(h.deps, "library");
    const result = await action.process([item], h.cancel);
    expect(result).toMatchObject({ hadApiErrors: true, taggedFailed: 1 });
  });

  it("applies the sparse filter to library runs and not to selections", () => {
    const h = makeHarness();
    const complete = makeItem({
      id: 1,
      itemType: "conferencePaper",
      fields: {
        proceedingsTitle: "P",
        abstractNote: "a",
        pages: "1",
        volume: "2",
      },
    });
    expect(createEnrichAction(h.deps, "library").select([complete])).toEqual(
      [],
    );
    expect(createEnrichAction(h.deps, "selection").select([complete])).toEqual([
      complete,
    ]);
  });

  it("ends after a cancel and leaves the remaining items alone", async () => {
    const h = makeHarness({ batchSize: () => 1 });
    h.api.next.doi = hydrated();
    h.lookups.doiCascade.push({
      name: "A",
      find: async () => {
        h.cancel.cancel();
        return { doi: "10.1/new", abstract: null };
      },
    });
    const items = [1, 2].map((id) => sparse({ id, fields: { title } }));
    const action = createEnrichAction(h.deps, "selection");
    const result = await action.process(items, h.cancel);
    expect(result.cancelled).toBe(true);
    expect(result.processed).toBe(1);
    expect(items[1].saves).toBe(0);
    expect(items[1].fields.DOI).toBeUndefined();
  });
});
