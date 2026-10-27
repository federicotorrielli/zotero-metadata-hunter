import { firstAuthorLastName } from "../domain/creators";
import { isPublishedDOI } from "../domain/preprint";
import { cleanTitleForQuery, isTitleMatch } from "../match/title";
import type { DOIResult, ZoteroItem } from "../types";
import type { SourceDeps } from "./deps";

const API = "https://export.arxiv.org/api/query";
const ARXIV_NAMESPACE = "http://arxiv.org/schemas/atom";

// <arxiv:doi> first, then the <link title="doi"> href.
function extractDoiFromEntry(entry: Element): string | null {
  const element = entry.getElementsByTagNameNS(ARXIV_NAMESPACE, "doi")[0];
  const text = element?.textContent?.trim();
  if (text) return text;

  for (const link of entry.querySelectorAll('link[title="doi"]')) {
    const match = (link.getAttribute("href") ?? "").match(/doi\.org\/(.+)$/);
    if (match) return match[1];
  }
  return null;
}

const entryTitle = (entry: Element): string | undefined =>
  entry.querySelector("title")?.textContent?.trim().replace(/\s+/g, " ");

// arXiv stores the published DOI in <arxiv:doi> when the author supplied one.
// Many preprints lack it, so this covers only papers on arXiv that are published.
export async function findDOI(
  { http, parseXml }: SourceDeps,
  item: ZoteroItem,
  title: string,
): Promise<DOIResult | null> {
  const queryTitle = cleanTitleForQuery(title).replace(/\s+/g, "+");
  const lastName = firstAuthorLastName(item);
  const author = lastName ? `+AND+au:${encodeURIComponent(lastName)}` : "";
  const url = `${API}?search_query=ti:${queryTitle}${author}&max_results=5&sortBy=relevance`;

  const xml = parseXml((await http.get(url)).responseText);
  for (const entry of xml.querySelectorAll("entry")) {
    const found = entryTitle(entry);
    if (!found || !isTitleMatch(title, found)) continue;
    const doi = extractDoiFromEntry(entry);
    if (doi) return { doi, abstract: null };
  }
  return null;
}

// Direct lookup of one arXiv entry. Not a title search.
export async function findPublishedDOIById(
  { http, parseXml }: SourceDeps,
  arxivId: string,
): Promise<string | null> {
  const url = `${API}?id_list=${arxivId}&max_results=1`;
  const entry = parseXml((await http.get(url)).responseText).querySelector(
    "entry",
  );
  const doi = entry ? extractDoiFromEntry(entry) : null;
  return doi && isPublishedDOI(doi) ? doi : null;
}
