// Title cleaning and fuzzy matching for bibliographic lookups.

const MAX_QUERY_LENGTH = 100;

// A title may differ in length by at most this share before it cannot match.
const MAX_LENGTH_GAP = 0.15;
const MIN_SIMILARITY = 0.85;

// A fragment before a colon needs this many words to stand alone as a query.
const MIN_MAIN_TITLE_WORDS = 4;

const HTML_ENTITIES: [RegExp, string][] = [
  [/&amp;/g, "&"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&[a-z]+;/gi, " "],
];

function decodeEntities(title: string): string {
  return HTML_ENTITIES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    title,
  );
}

// Removes the subtitle only when the main title is long enough to be a distinctive
// query. Short main titles like "BERT: ..." rely on their subtitle, because the
// bare main title returns unrelated results from every API.
function dropSubtitle(title: string): string {
  const colonIdx = title.search(/\s*[:—]/);
  if (colonIdx === -1) return title;
  const fragment = title.slice(0, colonIdx).trim();
  const words = fragment.split(/\s+/).filter(Boolean).length;
  return words >= MIN_MAIN_TITLE_WORDS ? fragment : title;
}

function truncateAtWord(text: string): string {
  if (text.length <= MAX_QUERY_LENGTH) return text;
  return text
    .slice(0, MAX_QUERY_LENGTH)
    .replace(/\s\S*$/, "")
    .trim();
}

export function cleanTitleForQuery(title: string): string {
  return truncateAtWord(dropSubtitle(decodeEntities(title)));
}

// NFKD splits accented letters into base plus mark, and removing the marks makes
// "Über" equal "Uber". Keeping letters and numbers by Unicode class means
// "Über die Maschine" is not reduced to "ber die maschine".
function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Edit distance with two rows, so memory scales with one title and not both.
export function levenshteinDistance(a: string, b: string): number {
  let previous = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    const current = [j];
    for (let i = 1; i <= a.length; i++) {
      current[i] =
        a[i - 1] === b[j - 1]
          ? previous[i - 1]
          : 1 + Math.min(previous[i - 1], previous[i], current[i - 1]);
    }
    previous = current;
  }
  return previous[a.length];
}

export function calculateSimilarity(a: string, b: string): number {
  const longer = Math.max(a.length, b.length);
  if (longer === 0) return 1;
  return (longer - levenshteinDistance(a, b)) / longer;
}

// The length gate comes first for every fuzzy check. A short title inside a long
// one ("Large Language Models" in "A Watermark for Large Language Models") is not
// the same paper.
function lengthsAreClose(a: string, b: string): boolean {
  const longer = Math.max(a.length, b.length);
  const shorter = Math.min(a.length, b.length);
  return longer === 0 || (longer - shorter) / longer <= MAX_LENGTH_GAP;
}

export function isTitleMatch(first: string, second: string): boolean {
  if (!first || !second) return false;
  const a = normalizeTitle(first);
  const b = normalizeTitle(second);
  if (a === b) return true;
  if (!lengthsAreClose(a, b)) return false;
  if (a.includes(b) || b.includes(a)) return true;
  return calculateSimilarity(a, b) > MIN_SIMILARITY;
}
