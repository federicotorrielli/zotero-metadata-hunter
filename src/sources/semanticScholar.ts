import { isPublishedDOI, isPublishedVenue } from "../domain/preprint";
import { cleanTitleForQuery, isTitleMatch } from "../match/title";
import type { Http, RequestOptions } from "../net/http";
import { NamedFailure } from "../net/tally";
import type { Throttle } from "../net/throttle";
import type { DOIResult } from "../types";

const API = "https://api.semanticscholar.org/graph/v1";

// A personal key is limited to "1 RPS on all endpoints". Requests without a key
// share a pool of 1000 per second. One item can query Semantic Scholar three
// times. Moreover, the batches run in parallel. Therefore the requests with a
// key are spaced on one shared schedule. Without the spacing, a key would cause
// more 429 answers than no key at all.
export const KEY_INTERVAL_MS = 1_000;

// The source name that SourceTally records for an invalid key. The result panel
// looks for it.
export const INVALID_KEY = "Semantic Scholar API key";

export interface SemanticScholarHttpDeps {
  http: Http;
  // The key typed in the preferences pane, or null. It is read on every
  // request. Therefore an edit takes effect without a restart.
  readKey: () => string | null;
  throttle: Throttle;
}

// Zotero.HTTP throws an UnexpectedStatusException with the status in it.
const isInvalidKey = (error: unknown): boolean =>
  [401, 403].includes((error as { status?: number })?.status ?? 0);

function rethrowInvalidKey(error: unknown): never {
  if (isInvalidKey(error)) {
    throw new NamedFailure(INVALID_KEY, `key not accepted: ${error}`);
  }
  throw error;
}

// The Http that Semantic Scholar lookups use. Without a key it is the plain one.
// With a key it adds the x-api-key header and keeps to the rate of the key. It
// also gives an invalid key its own source name. In this way the user can tell
// an invalid key from a rate limit or from a service that is down.
export function createSemanticScholarHttp({
  http,
  readKey,
  throttle,
}: SemanticScholarHttpDeps): Http {
  const call = <T>(
    send: (options?: RequestOptions) => Promise<T>,
    options: RequestOptions = {},
  ): Promise<T> => {
    const key = readKey();
    if (!key) return send(options);
    const headers = { ...options.headers, "x-api-key": key };
    return throttle(() => send({ ...options, headers })).catch(
      rethrowInvalidKey,
    );
  };
  return {
    get: (url, options) => call((o) => http.get(url, o), options),
    getJson: (url, options) => call((o) => http.getJson(url, o), options),
    getOptionalJson: (url, options) =>
      call((o) => http.getOptionalJson(url, o), options),
  };
}

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
