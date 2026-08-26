// OpenReview item creation from API notes.
//
// OpenReview serves openreview.net/forum?id=... behind a /challenge redirect
// for non-browser clients (the request is bounced to
// openreview.net/challenge?redirect=...), so Zotero's web translators run on
// the challenge page and fail with "No suitable translators found". The
// published-version discovery step already fetches the note from
// api2.openreview.net, which returns full structured metadata (and often a
// BibTeX blob), so we build the Zotero item directly from that note instead
// of opening the forum page. This removes the dependency on the anti-bot
// challenge page and on a site-specific OpenReview web translator.

declare const Zotero: any;

interface OpenReviewCreator {
  firstName?: string;
  lastName?: string;
  name?: string;
  creatorType: string;
}

// OpenReview notes expose authors either as a structured array of
// {firstName, lastName} objects or, depending on the API version, as a single
// semicolon/comma separated string. Normalise both into Zotero creator rows.
export function openReviewCreators(note: any): OpenReviewCreator[] {
  const content = note?.content ?? {};
  let raw: any[];

  if (Array.isArray(content.authors)) {
    raw = content.authors;
  } else if (typeof content.author === "string") {
    raw = content.author.split(/\s*[;,\n]\s*/);
  } else {
    raw = [];
  }

  return raw
    .map((entry: any): OpenReviewCreator | null => {
      const creator: OpenReviewCreator = { creatorType: "author" };

      if (entry && typeof entry === "object") {
        const first =
          (entry.firstName ?? entry.first_name ?? "").toString().trim();
        const last = (entry.lastName ?? entry.last_name ?? "").toString().trim();
        if (first || last) {
          creator.firstName = first;
          creator.lastName = last;
        } else if (entry.name) {
          creator.name = String(entry.name).trim();
        } else {
          return null;
        }
        return creator;
      }

      const clean = String(entry).trim();
      if (!clean) return null;
      const idx = clean.lastIndexOf(" ");
      if (idx <= 0) {
        creator.firstName = clean;
      } else {
        creator.lastName = clean.slice(0, idx);
        creator.firstName = clean.slice(idx + 1);
      }
      return creator;
    })
    .filter((c): c is OpenReviewCreator => c !== null);
}

// Pull a DOI out of an OpenReview _bibtex blob, e.g.
//   doi = {10.1234/...}
export function doiFromBibtex(bibtex: string): string | null {
  const m = bibtex.match(/doi\s*=\s*\{([^}]+)\}/i);
  return m ? m[1].trim() : null;
}

// Build and persist a Zotero item directly from an OpenReview API note,
// bypassing the openreview.net/forum page (and its /challenge redirect)
// entirely. Returns the saved item.
export async function createOpenReviewItem(
  note: any,
  forumUrl: string,
): Promise<any> {
  const content = note?.content ?? {};
  const item = new Zotero.Item("conferencePaper");

  if (content.title) item.setField("title", String(content.title));

  const creators = openReviewCreators(note);
  if (creators.length) item.setCreators(creators);

  if (content.abstract) {
    item.setField("abstractNote", String(content.abstract));
  }

  if (content.venue) {
    item.setField("proceedingsTitle", String(content.venue));
  }

  const rawDate = content.date ?? content.word_date ?? content.year;
  if (rawDate != null) item.setField("date", String(rawDate));

  let doi = typeof content.doi === "string" ? content.doi.trim() : "";
  if (!doi && typeof content._bibtex === "string") {
    doi = doiFromBibtex(content._bibtex) ?? "";
  }
  if (doi) item.setField("doi", doi);

  // Keep the forum URL so the user can still reach the OpenReview page from a
  // browser (where the challenge redirect does not apply).
  item.setField("url", forumUrl);

  await item.saveTx();
  return item;
}
