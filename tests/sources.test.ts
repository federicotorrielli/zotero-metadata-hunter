// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as arxiv from "../src/sources/arxiv";
import * as crossref from "../src/sources/crossref";
import * as dblp from "../src/sources/dblp";
import * as openalex from "../src/sources/openalex";
import * as openreview from "../src/sources/openreview";
import * as pubmed from "../src/sources/pubmed";
import * as semanticScholar from "../src/sources/semanticScholar";
import { fakeHttp, sourceDeps } from "./doubles";
import { makeItem } from "./helpers";

const item = makeItem({
  creators: [{ lastName: "Kirchenbauer", firstName: "J" }],
  fields: { date: "2023-06-01" },
});
const title = "A Watermark for Large Language Models";

describe("crossref", () => {
  it("keeps the narrow query when it matches", async () => {
    const http = fakeHttp({
      "query.author": {
        message: { items: [{ DOI: "10.1/a", title: [title] }] },
      },
    });
    expect(await crossref.findDOI(http, item, title)).toEqual({
      doi: "10.1/a",
      abstract: null,
    });
    expect(http.urls).toHaveLength(1);
    expect(http.urls[0]).toContain("from-pub-date:2023");
  });

  it("falls back to a title only query", async () => {
    const http = fakeHttp({
      "query.author": { message: { items: [] } },
      "query.bibliographic": {
        message: { items: [{ DOI: "10.1/b", title: [title] }] },
      },
    });
    expect((await crossref.findDOI(http, item, title))?.doi).toBe("10.1/b");
    expect(http.urls).toHaveLength(2);
    expect(http.urls[1]).not.toContain("query.author");
  });

  it("does not repeat the query when there were no filters", async () => {
    const http = fakeHttp({ works: { message: { items: [] } } });
    expect(await crossref.findDOI(http, makeItem(), title)).toBeNull();
    expect(http.urls).toHaveLength(1);
  });

  it("accepts only published types and non-arXiv DOIs", async () => {
    const http = fakeHttp({
      works: {
        message: {
          items: [
            {
              DOI: "10.48550/arXiv.1",
              title: [title],
              type: "journal-article",
            },
            { DOI: "10.1/posted", title: [title], type: "posted-content" },
            { DOI: "10.1/ok", title: [title], type: "proceedings-article" },
          ],
        },
      },
    });
    expect(await crossref.findPublishedDOI(http, item, title)).toBe("10.1/ok");
  });
});

describe("semanticScholar", () => {
  it("returns the DOI with the bundled abstract", async () => {
    const http = fakeHttp({
      "search/match": {
        data: [{ title, externalIds: { DOI: "10.1/s" }, abstract: "Abs" }],
      },
    });
    expect(await semanticScholar.findDOI(http, title)).toEqual({
      doi: "10.1/s",
      abstract: "Abs",
    });
  });

  it("reads a 404 as no record", async () => {
    const http = fakeHttp({ "search/match": null });
    expect(await semanticScholar.findDOI(http, title)).toBeNull();
    expect(
      await semanticScholar.findAbstract(fakeHttp({ paper: null }), "10.1/x"),
    ).toBeNull();
  });

  it("rejects a preprint venue for the published lookup", async () => {
    const http = fakeHttp({
      "search/match": {
        data: [{ title, externalIds: { DOI: "10.1/s" }, venue: "arXiv" }],
      },
    });
    expect(await semanticScholar.findPublishedDOI(http, title)).toBeNull();
  });

  it("accepts a published venue", async () => {
    const http = fakeHttp({
      "search/match": {
        data: [
          {
            title,
            externalIds: { DOI: "10.1/s" },
            publicationVenue: { name: "ICML" },
          },
        ],
      },
    });
    expect(await semanticScholar.findPublishedDOI(http, title)).toBe("10.1/s");
  });
});

describe("arxiv", () => {
  const atom = (
    doiElement: string,
  ) => `<feed xmlns="http://www.w3.org/2005/Atom"
    xmlns:arxiv="http://arxiv.org/schemas/atom"><entry>
    <title>  A Watermark for Large
      Language Models </title>${doiElement}</entry></feed>`;

  it("reads arxiv:doi for a title search", async () => {
    const deps = sourceDeps({
      search_query: atom("<arxiv:doi>10.1/ax</arxiv:doi>"),
    });
    expect(await arxiv.findDOI(deps, item, title)).toEqual({
      doi: "10.1/ax",
      abstract: null,
    });
  });

  it("reads the doi link when arxiv:doi is missing", async () => {
    const deps = sourceDeps({
      search_query: atom(
        '<link title="doi" href="http://dx.doi.org/10.1/ly"/>',
      ),
    });
    expect((await arxiv.findDOI(deps, item, title))?.doi).toBe("10.1/ly");
  });

  it("returns null for an entry with another title", async () => {
    const deps = sourceDeps({
      search_query: atom("<arxiv:doi>10.1/ax</arxiv:doi>"),
    });
    expect(
      await arxiv.findDOI(deps, item, "A completely different paper"),
    ).toBeNull();
  });

  it("rejects an arXiv DOI in the id lookup", async () => {
    const deps = sourceDeps({
      id_list: atom("<arxiv:doi>10.48550/arXiv.2301.10226</arxiv:doi>"),
    });
    expect(await arxiv.findPublishedDOIById(deps, "2301.10226")).toBeNull();
  });
});

describe("pubmed", () => {
  const search = { esearchresult: { idlist: ["123"] } };

  it("joins every section of a structured abstract", async () => {
    const deps = sourceDeps({
      esearch: search,
      efetch: `<PubmedArticleSet><PubmedArticle><Article><Abstract>
        <AbstractText Label="BACKGROUND">Why.</AbstractText>
        <AbstractText Label="METHODS">How.</AbstractText>
        </Abstract></Article></PubmedArticle></PubmedArticleSet>`,
    });
    expect(await pubmed.findAbstract(deps, "10.1/p")).toBe(
      "BACKGROUND: Why.\nMETHODS: How.",
    );
  });

  it("returns a plain abstract unchanged and ignores translations", async () => {
    const deps = sourceDeps({
      esearch: search,
      efetch: `<PubmedArticleSet><PubmedArticle><Article><Abstract>
        <AbstractText>Plain.</AbstractText></Abstract></Article>
        <OtherAbstract><AbstractText>Texto.</AbstractText></OtherAbstract>
        </PubmedArticle></PubmedArticleSet>`,
    });
    expect(await pubmed.findAbstract(deps, "10.1/p")).toBe("Plain.");
  });

  it("returns null when the search finds nothing", async () => {
    const deps = sourceDeps({ esearch: { esearchresult: { idlist: [] } } });
    expect(await pubmed.findAbstract(deps, "10.1/p")).toBeNull();
  });
});

describe("openalex", () => {
  it("rebuilds the abstract from the inverted index", () => {
    expect(
      openalex.reconstructAbstract({ We: [0], test: [2], this: [1] }),
    ).toBe("We this test");
  });

  it("returns null on 404 or without an index", async () => {
    expect(
      await openalex.findAbstract(fakeHttp({ works: null }), "10.1/o"),
    ).toBeNull();
    expect(
      await openalex.findAbstract(fakeHttp({ works: {} }), "10.1/o"),
    ).toBeNull();
  });
});

describe("openreview", () => {
  const note = (over: Record<string, unknown> = {}) => ({
    id: "n1",
    forum: "f1",
    content: {
      title: { value: title },
      venue: { value: "ICLR 2024 Poster" },
      venueid: { value: "ICLR.cc/2024/Conference" },
      authors: { value: ["A"] },
      _bibtex: { value: "@inproceedings{x}" },
    },
    ...over,
  });
  const search = (notes: unknown[]) => fakeHttp({ "notes/search": { notes } });

  it("returns the BibTeX with the forum URL", async () => {
    expect(await openreview.findPublishedRef(search([note()]), title)).toEqual({
      bibtex: "@inproceedings{x}",
      url: "https://openreview.net/forum?id=f1",
    });
  });

  it("falls back to the URL when there is no BibTeX", async () => {
    const bare = note();
    delete (bare.content as any)._bibtex;
    expect(await openreview.findPublishedRef(search([bare]), title)).toEqual({
      url: "https://openreview.net/forum?id=f1",
    });
  });

  it("skips DBLP mirrors, unpublished and authorless notes", async () => {
    const mirror = note({ invitations: ["DBLP.org/-/Record"] });
    const review = note();
    (review.content as any).venue = { value: "Submitted to ICLR 2025" };
    const anonymous = note();
    (anonymous.content as any).authors = { value: [] };
    const corr = note();
    (corr.content as any).venue = { value: "CoRR 2023" };
    expect(
      await openreview.findPublishedRef(
        search([mirror, review, anonymous, corr]),
        title,
      ),
    ).toBeNull();
  });

  it("reads api1 style fields stored without a value wrapper", () => {
    expect(
      openreview.contentValue({ content: { title: " T " } }, "title"),
    ).toBe("T");
    expect(
      openreview.contentList({ content: { a: ["x", 3, " y "] } }, "a"),
    ).toEqual(["x", "y"]);
  });
});

describe("dblp lookups", () => {
  const hit = (info: Record<string, unknown>) => ({
    result: { hits: { hit: info.__many ? info.__many : { info } } },
  });
  const pool = (data: unknown) => ({ search: async () => data });

  it("reads a single hit object", async () => {
    const data = hit({ title, doi: "10.1/d" });
    expect(await dblp.findDOI(pool(data), item, title)).toEqual({
      doi: "10.1/d",
      abstract: null,
    });
  });

  it("reads an array of hits and strips the DOI from the ee URL", async () => {
    const data = hit({
      __many: [
        { info: { title: "Other" } },
        { info: { title, ee: ["https://doi.org/10.1/e"] } },
      ],
    });
    expect((await dblp.findDOI(pool(data), item, title))?.doi).toBe("10.1/e");
  });

  it("returns a venue URL for a published record without a DOI", async () => {
    const data = hit({
      title,
      venue: "ICLR",
      ee: ["https://arxiv.org/abs/1", "https://openreview.net/forum?id=z"],
    });
    expect(await dblp.findPublishedRef(pool(data), item, title)).toEqual({
      url: "https://openreview.net/forum?id=z",
    });
  });

  it("skips CoRR records", async () => {
    const data = hit({ title, venue: "CoRR", doi: "10.48550/arXiv.1" });
    expect(await dblp.findPublishedRef(pool(data), item, title)).toBeNull();
  });
});
