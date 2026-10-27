import { describe, expect, it, vi } from "vitest";
import {
  itemsToProcess,
  createDOIAction,
  findAbstractForItem,
  findDOIForItem,
} from "../src/flows/doi";
import { TAG_NO_DOI } from "../src/flows/tags";
import { doiSource, makeHarness, makeItem } from "./harness";

const title = "A Watermark for Large Language Models";
const found = (doi: string, abstract: string | null = null) => ({
  doi,
  abstract,
});

describe("findDOIForItem", () => {
  it("tries the sources in order and ends at the first hit", async () => {
    const h = makeHarness();
    const first = doiSource("A", null);
    const second = doiSource("B", found("10.1/b"));
    const third = doiSource("C", found("10.1/c"));
    h.lookups.doiCascade.push(first, second, third);
    const lookup = await findDOIForItem(
      h.deps,
      makeItem({ fields: { title } }),
    );
    expect(lookup.result?.doi).toBe("10.1/b");
    expect(third.find).not.toHaveBeenCalled();
    expect(lookup.unchecked).toBe(false);
  });

  it("rejects an arXiv DOI for a published item and goes on", async () => {
    const h = makeHarness();
    h.lookups.doiCascade.push(
      doiSource("A", found("10.48550/arXiv.2301.10226")),
      doiSource("B", found("10.1/real")),
    );
    const item = makeItem({ itemType: "conferencePaper", fields: { title } });
    expect((await findDOIForItem(h.deps, item)).result?.doi).toBe("10.1/real");
  });

  it("keeps an arXiv DOI for a preprint item", async () => {
    const h = makeHarness();
    h.lookups.doiCascade.push(
      doiSource("A", found("10.48550/arXiv.2301.10226")),
    );
    const item = makeItem({ itemType: "preprint", fields: { title } });
    expect((await findDOIForItem(h.deps, item)).result?.doi).toBe(
      "10.48550/arXiv.2301.10226",
    );
  });

  it("is unchecked only when every source threw", async () => {
    const h = makeHarness();
    h.lookups.doiCascade.push(
      doiSource("A", new Error("429")),
      doiSource("B", new Error("500")),
    );
    const lookup = await findDOIForItem(
      h.deps,
      makeItem({ fields: { title } }),
    );
    expect(lookup.unchecked).toBe(true);
    expect(lookup.failedSources).toEqual(["A", "B"]);
  });

  it("is checked when one source answered no even though another threw", async () => {
    const h = makeHarness();
    h.lookups.doiCascade.push(
      doiSource("A", new Error("429")),
      doiSource("B", null),
    );
    const lookup = await findDOIForItem(
      h.deps,
      makeItem({ fields: { title } }),
    );
    expect(lookup.unchecked).toBe(false);
    expect(lookup.result).toBeNull();
  });

  it("does nothing for an item with a DOI or without a title", async () => {
    const h = makeHarness();
    const source = doiSource("A", found("10.1/x"));
    h.lookups.doiCascade.push(source);
    await findDOIForItem(
      h.deps,
      makeItem({ fields: { title, DOI: "10.1/y" } }),
    );
    await findDOIForItem(h.deps, makeItem());
    expect(source.find).not.toHaveBeenCalled();
  });
});

describe("findAbstractForItem", () => {
  it("takes the first source that answers and ignores failures", async () => {
    const h = makeHarness();
    h.lookups.abstracts.push(
      {
        name: "A",
        find: async () => {
          throw new Error("down");
        },
      },
      { name: "B", find: async () => null },
      { name: "C", find: async () => "The abstract." },
    );
    expect(await findAbstractForItem(h.deps, makeItem(), "10.1/x")).toBe(
      "The abstract.",
    );
  });

  it("returns null when nothing answers", async () => {
    const h = makeHarness();
    h.lookups.abstracts.push({ name: "A", find: async () => null });
    expect(await findAbstractForItem(h.deps, makeItem(), "10.1/x")).toBeNull();
  });

  it("does not look when the item already has an abstract", async () => {
    const h = makeHarness();
    const find = vi.fn(async () => "x");
    h.lookups.abstracts.push({ name: "A", find });
    const item = makeItem({ fields: { abstractNote: "Have one" } });
    expect(await findAbstractForItem(h.deps, item, "10.1/x")).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });
});

describe("itemsToProcess", () => {
  it("keeps regular items that miss a DOI or an abstract", () => {
    const complete = makeItem({
      id: 1,
      fields: { DOI: "10.1/a", abstractNote: "x" },
    });
    const noDOI = makeItem({ id: 2, fields: { abstractNote: "x" } });
    const noAbstract = makeItem({ id: 3, fields: { DOI: "10.1/b" } });
    const attachment = makeItem({ id: 4, regular: false });
    const kept = itemsToProcess([complete, noDOI, noAbstract, attachment]);
    expect(kept.map((i) => i.id)).toEqual([2, 3]);
  });
});

describe("DOI action", () => {
  async function run(items: ReturnType<typeof makeItem>[], h = makeHarness()) {
    const action = createDOIAction(h.deps, "library");
    const result = await action.process(items, h.cancel);
    return { h, result, message: action.message(result) };
  }

  it("saves a found DOI and its bundled abstract once, and clears the tag", async () => {
    const h = makeHarness();
    h.lookups.doiCascade.push(doiSource("A", found("10.1/a", "Bundled.")));
    const abstractFinder = vi.fn(async () => "Other");
    h.lookups.abstracts.push({ name: "X", find: abstractFinder });
    const item = makeItem({ fields: { title }, tags: [TAG_NO_DOI] });
    const { result, message } = await run([item], h);
    expect(item.fields).toMatchObject({
      DOI: "10.1/a",
      abstractNote: "Bundled.",
    });
    expect(item.saves).toBe(1);
    expect(item.hasTag(TAG_NO_DOI)).toBe(false);
    expect(abstractFinder).not.toHaveBeenCalled();
    expect(result).toMatchObject({ foundDOIs: 1, foundAbstracts: 1 });
    expect(message).toBe("Checked 1 item. Added 1 DOI and 1 abstract.");
  });

  it("looks the abstract up for an item that has a DOI", async () => {
    const h = makeHarness();
    h.lookups.abstracts.push({ name: "X", find: async () => "Found." });
    const item = makeItem({ fields: { title, DOI: "10.1/a" } });
    const { result, message } = await run([item], h);
    expect(item.fields.abstractNote).toBe("Found.");
    expect(item.saves).toBe(1);
    expect(result.foundDOIs).toBe(0);
    expect(message).toContain("Added 1 abstract. No new DOIs were found.");
  });

  it("does not save an item it did not change", async () => {
    const h = makeHarness();
    h.lookups.abstracts.push({ name: "X", find: async () => null });
    const item = makeItem({ fields: { title, DOI: "10.1/a" } });
    await run([item], h);
    expect(item.saves).toBe(0);
  });

  it("clears a stale tag from an item that now has a DOI", async () => {
    const h = makeHarness();
    h.lookups.abstracts.push({ name: "X", find: async () => null });
    const item = makeItem({
      fields: { title, DOI: "10.1/a", abstractNote: "x" },
      tags: [TAG_NO_DOI],
    });
    await run([item], h);
    expect(item.hasTag(TAG_NO_DOI)).toBe(false);
    expect(item.saves).toBe(1);
  });

  it("tags an item no source has a DOI for", async () => {
    const h = makeHarness();
    h.lookups.doiCascade.push(doiSource("A", null));
    const item = makeItem({ fields: { title } });
    const { result, message } = await run([item], h);
    expect(item.hasTag(TAG_NO_DOI)).toBe(true);
    expect(result.taggedNoDOI).toBe(1);
    expect(message).toContain(`It now carries the tag "${TAG_NO_DOI}"`);
  });

  it("leaves an unchecked item untagged and names the failing sources", async () => {
    const h = makeHarness();
    h.lookups.doiCascade.push(doiSource("CrossRef", new Error("429")));
    const item = makeItem({ fields: { title } });
    const { result, message } = await run([item], h);
    expect(item.hasTag(TAG_NO_DOI)).toBe(false);
    expect(result.skipped).toBe(1);
    expect(message).toContain("1 item could not be checked.");
    expect(message).toContain("CrossRef (1)");
  });

  it("counts a worker that throws and goes on", async () => {
    const h = makeHarness();
    h.lookups.doiCascade.push(doiSource("A", found("10.1/a")));
    const broken = makeItem({
      id: 1,
      fields: { title },
      saveError: new Error("db locked"),
    });
    const fine = makeItem({ id: 2, fields: { title } });
    const { result } = await run([broken, fine], h);
    expect(result.hadApiErrors).toBe(true);
    expect(result.processed).toBe(2);
    expect(fine.fields.DOI).toBe("10.1/a");
  });

  it("ends between batches when cancelled", async () => {
    const h = makeHarness();
    h.deps.batchSize = () => 1;
    h.lookups.doiCascade.push({
      name: "A",
      find: async () => {
        h.cancel.cancel();
        return found("10.1/a");
      },
    });
    const items = [1, 2, 3].map((id) => makeItem({ id, fields: { title } }));
    const { result, message } = await run(items, h);
    expect(result.cancelled).toBe(true);
    expect(result.processed).toBe(1);
    expect(message).toContain("Stopped after 1 item.");
  });

  it("reports progress and closes the panel", async () => {
    const h = makeHarness();
    h.lookups.abstracts.push({ name: "X", find: async () => null });
    const items = [1, 2].map((id) =>
      makeItem({ id, fields: { title, DOI: "10.1/a" } }),
    );
    await run(items, h);
    expect(h.panel.update).toHaveBeenCalledTimes(2);
    expect(h.panel.update.mock.calls[1][1]).toContain("Item 2 of 2 (100%)");
    expect(h.panel.close).toHaveBeenCalled();
  });

  it("closes the progress panel even when the run throws", async () => {
    const h = makeHarness();
    h.deps.batchSize = () => {
      throw new Error("bad preference");
    };
    const action = createDOIAction(h.deps, "library");
    await expect(
      action.process([makeItem({ fields: { title } })], h.cancel),
    ).rejects.toThrow("bad preference");
    expect(h.panel.close).toHaveBeenCalled();
  });

  it("does not report a DOI whose save failed", async () => {
    const h = makeHarness();
    h.lookups.doiCascade.push(doiSource("A", found("10.1/a")));
    const item = makeItem({
      fields: { title },
      saveError: new Error("locked"),
    });
    const action = createDOIAction(h.deps, "library");
    const result = await action.process([item], h.cancel);
    expect(result).toMatchObject({ foundDOIs: 0, hadApiErrors: true });
  });

  it("chooses the empty message by scope", () => {
    const h = makeHarness();
    expect(createDOIAction(h.deps, "library").emptyKey).toBe(
      "find-doi-all-have-data",
    );
    expect(createDOIAction(h.deps, "selection").emptyKey).toBe(
      "find-doi-all-selected-have-data",
    );
  });
});
