import { isPublishedDOI, isPublishedVenue } from "../domain/preprint";
import { cleanTitleForQuery, isTitleMatch } from "../match/title";
import type { Http } from "../net/http";
import type { DOIResult } from "../types";

const API = "https://api.semanticscholar.org/graph/v1";

// /paper/search/match is a pure title matcher that returns the single best result.
// Author terms are left out on purpose, because extra terms break its scoring.
async function matchTitle(
  http: Http,
  title: string,
  fields: string,
): Promise<any | null> {
  const query = encodeURIComponent(cleanTitleForQuery(title));
  const data = await http.getOptionalJson(
    `${API}/paper/search/match?query=${query}&fields=${fields}`,
  );
  const paper = data?.data?.[0];
  return paper && isTitleMatch(title, paper.title) ? paper : null;
}

// Title match, DOI and abstract in one request.
export async function findDOI(
  http: Http,
  title: string,
): Promise<DOIResult | null> {
  const paper = await matchTitle(http, title, "externalIds,title,abstract");
  const doi = paper?.externalIds?.DOI;
  return doi ? { doi, abstract: paper.abstract ?? null } : null;
}

function venueOf(paper: any): string {
  return (
    paper.publicationVenue?.name ??
    paper.publicationVenue?.alternate_names?.[0] ??
    paper.venue ??
    ""
  );
}

export async function findPublishedDOI(
  http: Http,
  title: string,
): Promise<string | null> {
  const paper = await matchTitle(
    http,
    title,
    "externalIds,title,venue,publicationVenue",
  );
  const doi = paper?.externalIds?.DOI;
  if (!doi || !isPublishedDOI(doi)) return null;
  return isPublishedVenue(venueOf(paper)) ? doi : null;
}

export async function findAbstract(
  http: Http,
  doi: string,
): Promise<string | null> {
  const data = await http.getOptionalJson(
    `${API}/paper/DOI:${doi}?fields=abstract`,
  );
  return data?.abstract ?? null;
}
