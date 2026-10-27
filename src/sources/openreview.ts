import { PREPRINT_VENUES } from "../domain/preprint";
import { cleanTitleForQuery, isTitleMatch } from "../match/title";
import type { Http } from "../net/http";
import type { PublishedRef } from "../types";

const UNPUBLISHED_MARKERS = [
  "submitted to",
  "under review",
  "rejected",
  "withdrawn",
  "desk rejected",
  "desk_rejected",
];

const SEARCH_LIMIT = 25;

// api2 wraps every content field as {value: ...}, api1 stores it directly.
function unwrap(note: any, field: string): unknown {
  const raw = note?.content?.[field];
  return raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw
    ? raw.value
    : raw;
}

export function contentValue(note: any, field: string): string {
  const value = unwrap(note, field);
  return typeof value === "string" ? value.trim() : "";
}

// The non-empty trimmed string entries of a list field, ignoring other members.
export function contentList(note: any, field: string): string[] {
  const value = unwrap(note, field);
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// A note with a title and no authors yields an item with just the name once the
// translator runs over it. Rejecting those keeps a preprint from being upgraded
// to an authorless record.
function hasAuthors(note: any): boolean {
  return (
    contentList(note, "authors").length > 0 ||
    contentList(note, "authorids").length > 0
  );
}

// DBLP imports thin metadata records into OpenReview for arXiv preprints (venue
// "CoRR YYYY") and for published venues too. Those forums hold no PDF, no
// reviews and no abstract beyond what DBLP had, so the result is a near-empty
// record. The real submission of an accepted paper lives under a separate forum.
// OpenReview marks the DBLP records with invitations starting at
// "DBLP.org/-/Record", and the venueid "dblp.org/..." is a second tell.
function isDblpMirrorNote(note: any): boolean {
  if (contentValue(note, "venueid").toLowerCase().startsWith("dblp.org/")) {
    return true;
  }
  const invitations: unknown = note?.invitations;
  return (
    Array.isArray(invitations) &&
    invitations.some(
      (invitation) =>
        typeof invitation === "string" &&
        invitation.toLowerCase().startsWith("dblp.org/"),
    )
  );
}

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Word boundaries let year suffixes like "CoRR 2023" still match. The exact match
// used elsewhere is too narrow here, because OpenReview always appends the year.
function mentionsPreprintVenue(text: string): boolean {
  return [...PREPRINT_VENUES].some((venue) =>
    new RegExp(`\\b${escapeRegExp(venue)}\\b`, "i").test(text),
  );
}

function isPublishedOpenReviewVenue(venue: string, venueId: string): boolean {
  const combined = `${venue} ${venueId}`.toLowerCase();
  if (!combined.trim()) return false;
  if (UNPUBLISHED_MARKERS.some((marker) => combined.includes(marker))) {
    return false;
  }
  return !mentionsPreprintVenue(combined);
}

function isAcceptedSubmission(note: any, title: string): boolean {
  return (
    isTitleMatch(title, contentValue(note, "title")) &&
    !isDblpMirrorNote(note) &&
    isPublishedOpenReviewVenue(
      contentValue(note, "venue"),
      contentValue(note, "venueid"),
    ) &&
    hasAuthors(note)
  );
}

// The note's own BibTeX is preferred. openreview.net/forum answers non browser
// clients with a 307 to /challenge, so Zotero's web translator would run on the
// anti-bot page. The search response already holds a complete record, so the
// forum page is never fetched. Notes without BibTeX fall back to the URL.
function toPublishedRef(note: any): PublishedRef | null {
  const forum = note.forum || note.id;
  if (!forum) return null;
  const url = `https://openreview.net/forum?id=${encodeURIComponent(forum)}`;
  const bibtex = contentValue(note, "_bibtex");
  return bibtex ? { bibtex, url } : { url };
}

export async function findPublishedRef(
  http: Http,
  title: string,
): Promise<PublishedRef | null> {
  const term = encodeURIComponent(cleanTitleForQuery(title));
  // A limit of 25 because DBLP mirrors often fill the top results and are
  // filtered out, so the real submission can sit further down.
  const data = await http.getJson(
    `https://api2.openreview.net/notes/search?term=${term}&content=title&type=exact&source=forum&limit=${SEARCH_LIMIT}`,
  );
  for (const note of data.notes ?? []) {
    if (!isAcceptedSubmission(note, title)) continue;
    const ref = toPublishedRef(note);
    if (ref) return ref;
  }
  return null;
}
