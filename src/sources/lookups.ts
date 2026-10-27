import type { DOIResult, PublishedRef, ZoteroItem } from "../types";
import * as arxiv from "./arxiv";
import * as crossref from "./crossref";
import * as dblp from "./dblp";
import type { SourceDeps } from "./deps";
import * as openalex from "./openalex";
import * as openreview from "./openreview";
import * as pubmed from "./pubmed";
import * as semanticScholar from "./semanticScholar";

export interface NamedSource<Find> {
  name: string;
  find: Find;
}

// The lookups the flows use, as data. A flow does not know which sources exist,
// so a test can swap in doubles and a new source is one more entry.
export interface Lookups {
  // Tried in this order until one finds a DOI.
  doiCascade: NamedSource<
    (item: ZoteroItem, title: string) => Promise<DOIResult | null>
  >[];
  // Raced. The first to return something wins.
  abstracts: NamedSource<(doi: string) => Promise<string | null>>[];
  published: NamedSource<
    (item: ZoteroItem, title: string) => Promise<PublishedRef | null>
  >[];
  publishedByArxivId(arxivId: string): Promise<string | null>;
}

type Deps = SourceDeps & { dblp: dblp.DblpPool };

function doiCascade({ http, dblp: pool, ...xml }: Deps): Lookups["doiCascade"] {
  return [
    {
      name: "CrossRef",
      find: (item, title) => crossref.findDOI(http, item, title),
    },
    { name: "DBLP", find: (item, title) => dblp.findDOI(pool, item, title) },
    {
      name: "Semantic Scholar",
      find: (_item, title) => semanticScholar.findDOI(http, title),
    },
    {
      name: "arXiv",
      find: (item, title) => arxiv.findDOI({ http, ...xml }, item, title),
    },
  ];
}

function abstractSources(deps: Deps): Lookups["abstracts"] {
  const { http } = deps;
  return [
    {
      name: "Semantic Scholar",
      find: (doi) => semanticScholar.findAbstract(http, doi),
    },
    { name: "PubMed", find: (doi) => pubmed.findAbstract(deps, doi) },
    { name: "OpenAlex", find: (doi) => openalex.findAbstract(http, doi) },
  ];
}

function publishedSources({ http, dblp: pool }: Deps): Lookups["published"] {
  const asRef = (doi: string | null): PublishedRef | null =>
    doi ? { doi } : null;
  return [
    {
      name: "Semantic Scholar",
      find: async (_item, title) =>
        asRef(await semanticScholar.findPublishedDOI(http, title)),
    },
    {
      name: "CrossRef",
      find: async (item, title) =>
        asRef(await crossref.findPublishedDOI(http, item, title)),
    },
    {
      name: "DBLP",
      find: (item, title) => dblp.findPublishedRef(pool, item, title),
    },
    {
      name: "OpenReview",
      find: (_item, title) => openreview.findPublishedRef(http, title),
    },
  ];
}

export function createLookups(deps: Deps): Lookups {
  return {
    doiCascade: doiCascade(deps),
    abstracts: abstractSources(deps),
    published: publishedSources(deps),
    publishedByArxivId: (arxivId) => arxiv.findPublishedDOIById(deps, arxivId),
  };
}
