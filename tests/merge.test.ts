import { describe, expect, it, vi } from "vitest";
import {
  enrichItemFromMetadata,
  shouldReplaceCreators,
  type NormalizedRecord,
} from "../src/domain/merge";
import { makeItem, TYPE_IDS } from "./helpers";

function env(invalid: string[] = []) {
  return {
    api: {
      itemTypeID: (name: string) => TYPE_IDS[name] ?? null,
      isFieldValidForType: (field: string) => !invalid.includes(field),
    },
    log: vi.fn(),
  };
}

const record = (over: Partial<NormalizedRecord> = {}): NormalizedRecord => ({
  itemType: "conferencePaper",
  fields: {},
  creators: [],
  ...over,
});

describe("shouldReplaceCreators", () => {
  const a = { lastName: "Ada" };
  const b = { lastName: "Bell" };
  const c = { lastName: "Cole" };

  it("never replaces with an empty list", () => {
    expect(shouldReplaceCreators([a], [])).toBe(false);
  });

  it("replaces a truncated list with a longer one, even an unrelated one", () => {
    expect(shouldReplaceCreators([a], [b, c])).toBe(true);
    expect(shouldReplaceCreators([], [a])).toBe(true);
  });

  it("keeps a single creator when the record has no more to add", () => {
    expect(shouldReplaceCreators([a], [a])).toBe(false);
    expect(shouldReplaceCreators([a], [b])).toBe(false);
  });

  it("replaces a short list only when a surname is shared", () => {
    expect(shouldReplaceCreators([a, b], [a, b, c])).toBe(true);
    expect(
      shouldReplaceCreators(
        [a, b],
        [c, { lastName: "Dee" }, { lastName: "Eve" }],
      ),
    ).toBe(false);
  });

  it("keeps the list when the hydrated one is not longer", () => {
    expect(shouldReplaceCreators([a, b], [a, b])).toBe(false);
  });

  it("matches institutional creators by name", () => {
    const org = { name: "WHO", fieldMode: 1 };
    expect(shouldReplaceCreators([org, org], [org, org, org])).toBe(true);
  });
});

describe("enrichItemFromMetadata", () => {
  it("fills only the empty fields", () => {
    const item = makeItem({ fields: { title: "T", pages: "" } });
    const changed = enrichItemFromMetadata(
      env(),
      item,
      record({ fields: { title: "Other", pages: "1-9", volume: "4" } }),
    );
    expect(item.fields).toMatchObject({
      title: "T",
      pages: "1-9",
      volume: "4",
    });
    expect(changed).toEqual(expect.arrayContaining(["pages", "volume"]));
    expect(changed).not.toContain("title");
  });

  it("skips a field the item type rejects", () => {
    const item = makeItem();
    enrichItemFromMetadata(
      env(["volume"]),
      item,
      record({ fields: { volume: "4" } }),
    );
    expect(item.fields.volume).toBeUndefined();
  });

  it("changes the item type first", () => {
    const item = makeItem({ itemType: "journalArticle" });
    const changed = enrichItemFromMetadata(env(), item, record());
    expect(item.itemType).toBe("conferencePaper");
    expect(changed[0]).toBe("itemType");
  });

  it("logs a type change that fails and carries on", () => {
    const item = makeItem({ itemType: "journalArticle" });
    item.setType = () => {
      throw new Error("no");
    };
    const e = env();
    const changed = enrichItemFromMetadata(
      e,
      item,
      record({ fields: { pages: "1" } }),
    );
    expect(changed).toEqual(["pages"]);
    expect(e.log).toHaveBeenCalled();
  });

  it("upgrades a bare year to a full date and keeps a full one", () => {
    const bare = makeItem({ fields: { date: "2023" } });
    enrichItemFromMetadata(
      env(),
      bare,
      record({ itemType: "journalArticle", fields: { date: "2023-06-01" } }),
    );
    expect(bare.fields.date).toBe("2023-06-01");

    const withDay = makeItem({ fields: { date: "2023-01-05" } });
    enrichItemFromMetadata(
      env(),
      withDay,
      record({ itemType: "journalArticle", fields: { date: "2023-06-01" } }),
    );
    expect(withDay.fields.date).toBe("2023-01-05");
  });

  it("fills a date when there is no year", () => {
    const item = makeItem({ fields: { date: "n.d." } });
    enrichItemFromMetadata(
      env(),
      item,
      record({ itemType: "journalArticle", fields: { date: "2020" } }),
    );
    expect(item.fields.date).toBe("2020");
  });

  it("replaces an empty or short abstract and keeps a long one", () => {
    const long = "x".repeat(250);
    const empty = makeItem();
    const short = makeItem({ fields: { abstractNote: "Short." } });
    const kept = makeItem({ fields: { abstractNote: long } });
    const incoming = record({
      itemType: "journalArticle",
      fields: { abstractNote: "A fuller abstract." },
    });
    enrichItemFromMetadata(env(), empty, incoming);
    enrichItemFromMetadata(env(), short, incoming);
    enrichItemFromMetadata(env(), kept, incoming);
    expect(empty.fields.abstractNote).toBe("A fuller abstract.");
    expect(short.fields.abstractNote).toBe("A fuller abstract.");
    expect(kept.fields.abstractNote).toBe(long);
  });

  it("does not replace a short abstract with a shorter one", () => {
    const item = makeItem({ fields: { abstractNote: "Medium length." } });
    enrichItemFromMetadata(
      env(),
      item,
      record({ itemType: "journalArticle", fields: { abstractNote: "Tiny" } }),
    );
    expect(item.fields.abstractNote).toBe("Medium length.");
  });

  it("replaces creators by the policy", () => {
    const item = makeItem({ creators: [{ lastName: "Ada" }] });
    const changed = enrichItemFromMetadata(
      env(),
      item,
      record({
        itemType: "journalArticle",
        creators: [{ lastName: "Ada" }, { lastName: "Bell" }],
      }),
    );
    expect(item.getCreators()).toHaveLength(2);
    expect(changed).toContain("creators");
  });

  it("leaves a single author paper alone when the record has the same author", () => {
    const item = makeItem({
      itemType: "journalArticle",
      creators: [{ lastName: "Turing", firstName: "A" }],
    });
    const changed = enrichItemFromMetadata(
      env(),
      item,
      record({
        itemType: "journalArticle",
        creators: [{ lastName: "Turing", firstName: "Alan" }],
      }),
    );
    expect(changed).toEqual([]);
    expect(item.getCreators()[0].firstName).toBe("A");
  });

  it("reports nothing when there is nothing to add", () => {
    const item = makeItem({
      itemType: "conferencePaper",
      fields: { title: "T" },
    });
    expect(
      enrichItemFromMetadata(env(), item, record({ fields: { title: "T" } })),
    ).toEqual([]);
  });
});
