import { firstAuthorLastName } from "../domain/creators";
import { isPublishedDOI, PUBLISHED_CROSSREF_TYPES } from "../domain/preprint";
import { cleanTitleForQuery, isTitleMatch } from "../match/title";
import type { Http } from "../net/http";
import type { DOIResult, ZoteroItem } from "../types";

const ROWS = 10;

const worksURL = (params: string[]): string =>
  `https://api.crossref.org/works?${params.join("&")}&rows=${ROWS}`;

function titleParam(title: string): string {
  return `query.bibliographic=${encodeURIComponent(cleanTitleForQuery(title))}`;
}

async function queryWorks(http: Http, params: string[]): Promise<any[]> {
  const data = await http.getJson(worksURL(params));
  return data.message?.items ?? [];
}

// A narrow query with author and year filters gives precision. When it finds
// nothing, a title only query follows, because author substring matching in
// CrossRef can surface wrong results ("Kirchenbauer" matches "Müller-Kirchenbauer").
function narrowFilters(item: ZoteroItem): string[] {
  const lastName = firstAuthorLastName(item);
  const year = item.getField("date")?.match(/\d{4}/)?.[0];
  return [
    ...(lastName ? [`query.author=${encodeURIComponent(lastName)}`] : []),
    ...(year ? [`filter=from-pub-date:${year},until-pub-date:${year}`] : []),
  ];
}

function firstTitleMatch(works: any[], title: string): DOIResult | null {
  const match = works.find(
    (work) => work.DOI && isTitleMatch(title, work.title?.[0]),
  );
  return match ? { doi: match.DOI as string, abstract: null } : null;
}

export async function findDOI(
  http: Http,
  item: ZoteroItem,
  title: string,
): Promise<DOIResult | null> {
  const filters = narrowFilters(item);
  const narrow = firstTitleMatch(
    await queryWorks(http, [titleParam(title), ...filters]),
    title,
  );
  if (narrow || filters.length === 0) return narrow;
  return firstTitleMatch(await queryWorks(http, [titleParam(title)]), title);
}

export async function findPublishedDOI(
  http: Http,
  item: ZoteroItem,
  title: string,
): Promise<string | null> {
  const lastName = firstAuthorLastName(item);
  const params = [
    titleParam(title),
    ...(lastName ? [`query.author=${encodeURIComponent(lastName)}`] : []),
  ];
  const published = (await queryWorks(http, params)).find(
    (work) =>
      work.DOI &&
      isPublishedDOI(work.DOI) &&
      isTitleMatch(title, work.title?.[0]) &&
      PUBLISHED_CROSSREF_TYPES.has(work.type ?? ""),
  );
  return published ? published.DOI : null;
}
