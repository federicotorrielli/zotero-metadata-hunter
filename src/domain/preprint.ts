// What makes an item a preprint, and what counts as a published record.
import type { ZoteroItem } from "../types";

export const PUBLISHED_CROSSREF_TYPES = new Set([
  "journal-article",
  "proceedings-article",
  "book-chapter",
]);

const PUBLISHED_ITEM_TYPES = new Set([
  "journalArticle",
  "conferencePaper",
  "bookSection",
  "book",
  "thesis",
  "report",
]);

export const PREPRINT_VENUES = new Set([
  "arxiv",
  "corr",
  "ssrn",
  "biorxiv",
  "medrxiv",
  "preprints.org",
  "research square",
  "techrxiv",
]);

const ARXIV_DOI_PREFIX = "10.48550/arxiv.";

// New identifiers (2502.01534) and old ones (hep-th/9901001, math.GT/0309136).
const ARXIV_ID = String.raw`(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})`;

const ARXIV_ID_SOURCES: RegExp[] = [
  new RegExp(String.raw`arxiv\.org\/abs\/${ARXIV_ID}`, "i"),
  new RegExp(String.raw`doi\.org\/10\.48550\/arxiv\.${ARXIV_ID}`, "i"),
];

const ARXIV_DOI_PATTERN = new RegExp(
  String.raw`10\.48550\/arxiv\.${ARXIV_ID}`,
  "i",
);
const ARXIV_EXTRA_PATTERN = new RegExp(String.raw`arxiv:${ARXIV_ID}`, "i");

// The DOI stored on an item, or null when it is empty or the "-" placeholder.
export function getDOI(item: ZoteroItem): string | null {
  const doi = item.getField("DOI")?.trim();
  return doi && doi !== "-" ? doi : null;
}

export const hasDOI = (item: ZoteroItem): boolean => getDOI(item) !== null;

const hasAbstract = (item: ZoteroItem): boolean =>
  !!item.getField("abstractNote")?.trim();

// A regular item without a DOI or without an abstract, which is what the DOI and
// abstract action can fill.
export const lacksDOIOrAbstract = (item: ZoteroItem): boolean =>
  item.isRegularItem() && !(hasDOI(item) && hasAbstract(item));

export function extractArxivId(item: ZoteroItem): string | null {
  const url = item.getField("url") ?? "";
  for (const pattern of ARXIV_ID_SOURCES) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  const fromDoi = (item.getField("DOI") ?? "").match(ARXIV_DOI_PATTERN);
  if (fromDoi) return fromDoi[1];
  const fromExtra = (item.getField("extra") ?? "").match(ARXIV_EXTRA_PATTERN);
  return fromExtra ? fromExtra[1] : null;
}

function venueOf(item: ZoteroItem): string {
  // getField answers "" for an empty field, so the fallback needs || and not ??.
  return (
    item.getField("publicationTitle") ||
    item.getField("proceedingsTitle") ||
    ""
  ).toLowerCase();
}

export function isPreprint(item: ZoteroItem): boolean {
  if (!item.isRegularItem()) return false;
  if (item.itemType === "preprint") return true;
  // CoRR is DBLP's label for arXiv. Zotero stores such entries as journalArticle,
  // so this check has to come before the published-type gate.
  if (venueOf(item) === "corr") return true;
  if (PUBLISHED_ITEM_TYPES.has(item.itemType)) return false;
  const url = item.getField("url") ?? "";
  return url.includes("arxiv.org") || extractArxivId(item) !== null;
}

export function isPublishedDOI(doi: string): boolean {
  return !doi.toLowerCase().startsWith(ARXIV_DOI_PREFIX);
}

export function isPublishedVenue(venue: string): boolean {
  if (!venue?.trim()) return false;
  return !PREPRINT_VENUES.has(venue.toLowerCase().trim());
}

// A regular, non preprint item. Preprints have their own flow.
export const isEnrichable = (item: ZoteroItem): boolean =>
  item.isRegularItem() && !isPreprint(item);
