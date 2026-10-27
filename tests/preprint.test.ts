import { describe, expect, it } from "vitest";
import {
  extractArxivId,
  getDOI,
  hasDOI,
  isPreprint,
  isPublishedDOI,
  isPublishedVenue,
} from "../src/domain/preprint";
import { makeItem } from "./helpers";

describe("extractArxivId", () => {
  it("reads an abs URL", () => {
    const item = makeItem({
      fields: { url: "https://arxiv.org/abs/2502.01534v2" },
    });
    expect(extractArxivId(item)).toBe("2502.01534");
  });

  it("reads an arXiv DOI in any case", () => {
    const item = makeItem({ fields: { DOI: "10.48550/ARXIV.2502.01534" } });
    expect(extractArxivId(item)).toBe("2502.01534");
  });

  it("reads Extra without regard to case", () => {
    const item = makeItem({ fields: { extra: "arxiv:1706.03762" } });
    expect(extractArxivId(item)).toBe("1706.03762");
  });

  it("reads an old style identifier", () => {
    const item = makeItem({
      fields: { url: "https://arxiv.org/abs/hep-th/9901001" },
    });
    expect(extractArxivId(item)).toBe("hep-th/9901001");
  });

  it("returns null without any source", () => {
    expect(extractArxivId(makeItem())).toBeNull();
  });
});

describe("isPreprint", () => {
  it("accepts the preprint item type", () => {
    expect(isPreprint(makeItem({ itemType: "preprint" }))).toBe(true);
  });

  it("counts CoRR as a preprint whatever the type", () => {
    const item = makeItem({ fields: { publicationTitle: "CoRR" } });
    expect(isPreprint(item)).toBe(true);
  });

  it("finds CoRR in the proceedings title when the publication title is empty", () => {
    const item = makeItem({
      itemType: "conferencePaper",
      fields: { publicationTitle: "", proceedingsTitle: "CoRR" },
    });
    expect(isPreprint(item)).toBe(true);
  });

  it("keeps a published type with an arXiv URL as published", () => {
    const item = makeItem({
      itemType: "conferencePaper",
      fields: { url: "https://arxiv.org/abs/2502.01534" },
    });
    expect(isPreprint(item)).toBe(false);
  });

  it("detects a document with an arXiv URL", () => {
    const item = makeItem({
      itemType: "document",
      fields: { url: "https://arxiv.org/abs/2502.01534" },
    });
    expect(isPreprint(item)).toBe(true);
  });

  it("ignores items that are not regular", () => {
    expect(isPreprint(makeItem({ itemType: "preprint", regular: false }))).toBe(
      false,
    );
  });
});

describe("DOI helpers", () => {
  it("reads empty and the dash as no DOI", () => {
    expect(getDOI(makeItem({ fields: { DOI: " - " } }))).toBeNull();
    expect(hasDOI(makeItem())).toBe(false);
  });

  it("returns the trimmed DOI", () => {
    expect(getDOI(makeItem({ fields: { DOI: " 10.1/x " } }))).toBe("10.1/x");
  });

  it("recognizes arXiv DOIs and preprint venues", () => {
    expect(isPublishedDOI("10.48550/arXiv.2502.01534")).toBe(false);
    expect(isPublishedDOI("10.1145/3292500")).toBe(true);
    expect(isPublishedVenue("arXiv")).toBe(false);
    expect(isPublishedVenue("")).toBe(false);
    expect(isPublishedVenue("NeurIPS")).toBe(true);
  });
});
