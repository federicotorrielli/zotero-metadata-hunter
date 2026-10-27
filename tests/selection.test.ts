import { describe, expect, it, vi } from "vitest";
import { resolveTargetItems, uniqueByID } from "../src/selection";
import type { TreeRow, ZoteroItem, ZoteroPane } from "../src/types";
import { makeItem } from "./helpers";

function row(
  items: ZoteroItem[],
  kind: Partial<Record<string, boolean>> = {},
): TreeRow & {
  getItems: ReturnType<typeof vi.fn>;
} {
  return {
    isTrash: () => !!kind.trash,
    isFeedsOrFeed: () => !!kind.feed,
    isBucket: () => !!kind.bucket,
    isShare: () => !!kind.share,
    getItems: vi.fn(async () => items),
  };
}

const pane = (selected: ZoteroItem[], rows: TreeRow[]): ZoteroPane => ({
  getSelectedItems: () => selected,
  getCollectionTreeRows: () => rows,
});

describe("resolveTargetItems", () => {
  it("prefers the explicit item selection", async () => {
    const chosen = makeItem({ id: 1 });
    const r = row([makeItem({ id: 2 })]);
    expect(await resolveTargetItems(pane([chosen], [r]))).toEqual([chosen]);
    expect(r.getItems).not.toHaveBeenCalled();
  });

  it("reads every selected row without search filters", async () => {
    const a = row([makeItem({ id: 1 })]);
    const b = row([makeItem({ id: 2 })]);
    const items = await resolveTargetItems(pane([], [a, b]));
    expect(items.map((i) => i.id)).toEqual([1, 2]);
    expect(a.getItems).toHaveBeenCalledWith({ unfiltered: true });
  });

  it("lists an item once when several rows contain it", async () => {
    const shared = makeItem({ id: 1 });
    const items = await resolveTargetItems(
      pane([], [row([shared]), row([shared, makeItem({ id: 2 })])]),
    );
    expect(items.map((i) => i.id)).toEqual([1, 2]);
  });

  it.each(["trash", "feed", "bucket", "share"])(
    "skips a %s row",
    async (kind) => {
      const skipped = row([makeItem({ id: 9 })], { [kind]: true });
      expect(await resolveTargetItems(pane([], [skipped]))).toEqual([]);
      expect(skipped.getItems).not.toHaveBeenCalled();
    },
  );

  it("returns nothing when no row is selected", async () => {
    expect(await resolveTargetItems(pane([], []))).toEqual([]);
  });
});

describe("uniqueByID", () => {
  it("keeps the last item of an id and the order of first sight", () => {
    const first = makeItem({ id: 1 });
    const again = makeItem({ id: 1 });
    expect(uniqueByID([first, makeItem({ id: 2 }), again])[0]).toBe(again);
  });
});
