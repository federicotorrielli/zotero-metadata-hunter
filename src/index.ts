import { config, version } from "../package.json";
import { registerWindowMenus, unregisterWindowMenus } from "./modules/menu";
import { getString } from "./utils/locale";

declare const Zotero: any;
declare const Services: any;

// ── State ──────────────────────────────────────────────────────────────────────

const windowKeyHandlers = new WeakMap<Window, (e: KeyboardEvent) => void>();
let activeCancel: CancelToken | null = null;

// ── Cancel token ───────────────────────────────────────────────────────────────

class CancelToken {
  requested = false;
  cancel() {
    this.requested = true;
  }
}

// ── Plugin namespace ───────────────────────────────────────────────────────────

Zotero.MetadataHunter = {
  async startup(_data: { id: string; version: string; rootURI: string }) {
    Zotero.debug("Metadata Hunter: Startup");
    for (const win of Zotero.getMainWindows()) {
      Zotero.MetadataHunter.onMainWindowLoad(win);
    }
  },

  shutdown() {
    Zotero.debug("Metadata Hunter: Shutdown");
    activeCancel?.cancel();
  },

  onMainWindowLoad(win: Window) {
    registerWindowMenus(win);
    setupWindowToolbar(win);
    setupWindowKeyShortcut(win);
  },

  onMainWindowUnload(win: Window) {
    unregisterWindowMenus(win);
    teardownWindowToolbar(win);
    teardownWindowKeyShortcut(win);
  },

  get isProcessing() {
    return activeCancel !== null;
  },

  findDOIs,
  findDOIsForSelected,
  findPublishedVersions,
  findPublishedVersionsForSelected,
  isPreprint,
};

// ── Window UI ──────────────────────────────────────────────────────────────────

function setupWindowToolbar(win: Window) {
  const doc = (win as any).document;
  const toolbar = doc.getElementById("zotero-tb-advanced-search");
  if (!toolbar || doc.getElementById(`${config.addonRef}-button`)) return;

  const btn = doc.createXULElement("toolbarbutton");
  btn.id = `${config.addonRef}-button`;
  btn.className = "zotero-tb-button";
  btn.setAttribute("image", "chrome://zotero/skin/16/universal/book.svg");
  btn.addEventListener("command", () => {
    if (activeCancel) {
      activeCancel.cancel();
    } else {
      findDOIs();
    }
  });
  toolbar.parentElement?.insertBefore(btn, toolbar.nextSibling);
  syncToolbarButton(win);
}

function teardownWindowToolbar(win: Window) {
  (win as any).document.getElementById(`${config.addonRef}-button`)?.remove();
}

function syncToolbarButton(win: Window) {
  const btn = (win as any).document.getElementById(`${config.addonRef}-button`);
  if (!btn) return;
  const processing = activeCancel !== null;
  btn.setAttribute(
    "title",
    processing
      ? getString("toolbar.cancel.tooltip")
      : getString("toolbar.tooltip"),
  );
  btn.setAttribute(
    "label",
    processing ? getString("toolbar.cancel") : getString("toolbar.label"),
  );
}

function syncAllToolbarButtons() {
  for (const win of Zotero.getMainWindows()) {
    syncToolbarButton(win);
  }
}

function setupWindowKeyShortcut(win: Window) {
  const handler = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey) return;

    const key = e.key.toLowerCase();
    if (key === "d") {
      e.preventDefault();
      if (activeCancel) {
        activeCancel.cancel();
      } else {
        findDOIs();
      }
    } else if (key === "p") {
      e.preventDefault();
      if (activeCancel) {
        activeCancel.cancel();
      } else {
        findPublishedVersions();
      }
    }
  };
  windowKeyHandlers.set(win, handler);
  win.addEventListener("keydown", handler);
}

function teardownWindowKeyShortcut(win: Window) {
  const handler = windowKeyHandlers.get(win);
  if (handler) {
    win.removeEventListener("keydown", handler);
    windowKeyHandlers.delete(win);
  }
}

// ── Promise utilities ──────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// Converts a Promise<T | null> into one that rejects on null,
// enabling Promise.any to skip sources that found nothing.
function withNullAsReject<T>(p: Promise<T | null>): Promise<T> {
  return p.then((v) => {
    if (v === null) throw new Error("not found");
    return v;
  });
}

function formatEta(
  startTime: number,
  processed: number,
  total: number,
): string {
  if (processed < 3) return "";
  const elapsed = Date.now() - startTime;
  const msRemaining = (elapsed / processed) * (total - processed);
  if (msRemaining < 5_000) return "";
  if (msRemaining < 60_000)
    return ` • ~${Math.round(msRemaining / 1_000)}s left`;
  return ` • ~${Math.round(msRemaining / 60_000)}m left`;
}

// ── Title matching ─────────────────────────────────────────────────────────────

function cleanTitleForQuery(title: string): string {
  // Decode common HTML entities Zotero may store verbatim
  const decoded = title
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, " ");

  // Drop subtitle (after colon or em-dash) only when the pre-colon fragment is long
  // enough to be a meaningful standalone query (≥4 words). Short main titles like
  // "Machine generated text: a comprehensive survey..." or "BERT: Pre-training of..."
  // rely on their subtitle for distinctiveness — stripping them yields a generic phrase
  // that returns unrelated results from every API.
  const colonIdx = decoded.search(/\s*[:\u2014]/);
  const fragment =
    colonIdx !== -1 ? decoded.slice(0, colonIdx).trim() : decoded;
  const wordCount = fragment.split(/\s+/).filter(Boolean).length;
  const noSubtitle = colonIdx !== -1 && wordCount >= 4 ? fragment : decoded;

  // Truncate at a word boundary around 100 chars
  if (noSubtitle.length <= 100) return noSubtitle;
  return noSubtitle
    .slice(0, 100)
    .replace(/\s\S*$/, "")
    .trim();
}

function isTitleMatch(title1: string, title2: string): boolean {
  if (!title1 || !title2) return false;

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const n1 = normalize(title1);
  const n2 = normalize(title2);

  if (n1 === n2) return true;

  // Gate ALL fuzzy checks behind the length ratio. A short string being a substring
  // of a long one (e.g. "Large Language Models" inside "A Watermark for Large Language
  // Models") does not mean they are the same paper — apply the same ≤15% length
  // difference requirement before both the substring and Levenshtein checks.
  const longer = Math.max(n1.length, n2.length);
  const shorter = Math.min(n1.length, n2.length);
  if (longer > 0 && (longer - shorter) / longer > 0.15) return false;

  if (n1.includes(n2) || n2.includes(n1)) return true;
  return calculateSimilarity(n1, n2) > 0.85;
}

function calculateSimilarity(s1: string, s2: string): number {
  const longer = s1.length >= s2.length ? s1 : s2;
  const shorter = s1.length >= s2.length ? s2 : s1;
  if (longer.length === 0) return 1.0;
  return (longer.length - levenshteinDistance(longer, shorter)) / longer.length;
}

function levenshteinDistance(s1: string, s2: string): number {
  const matrix: number[][] = Array.from({ length: s2.length + 1 }, (_, i) => [
    i,
  ]);
  for (let j = 0; j <= s1.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      matrix[i][j] =
        s2[i - 1] === s1[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(
              matrix[i - 1][j - 1] + 1,
              matrix[i][j - 1] + 1,
              matrix[i - 1][j] + 1,
            );
    }
  }
  return matrix[s2.length][s1.length];
}

// ── DOI finding ────────────────────────────────────────────────────────────────

// Semantic Scholar can return both the DOI and abstract in a single title-match
// request, so we carry an optional abstract to avoid a redundant second lookup.
interface DOIResult {
  doi: string;
  abstract: string | null;
}

async function findDOIFromCrossRef(
  item: any,
  title: string,
): Promise<DOIResult | null> {
  const creators = item.getCreators();
  const lastName = creators.length > 0 ? creators[0].lastName : null;
  const year = item.getField("date")?.match(/\d{4}/)?.[0];
  const titleParam = `query.bibliographic=${encodeURIComponent(cleanTitleForQuery(title))}`;

  // Helper: run one CrossRef query and return the first title-matching result.
  const queryCrossRef = async (
    extraParams: string[],
  ): Promise<DOIResult | null> => {
    const params = [titleParam, ...extraParams].join("&");
    const url = `https://api.crossref.org/works?${params}&rows=10`;
    const response: any = await withTimeout(
      Zotero.HTTP.request("GET", url, {
        headers: { "User-Agent": `Zotero Metadata Hunter/${version}` },
      }),
      10_000,
    );
    const data = JSON.parse(response.responseText);
    for (const crossrefItem of data.message?.items ?? []) {
      if (crossrefItem.DOI && isTitleMatch(title, crossrefItem.title?.[0])) {
        return { doi: crossrefItem.DOI as string, abstract: null };
      }
    }
    return null;
  };

  try {
    // First attempt: narrow query with author + year filter for precision.
    const narrowParams: string[] = [];
    if (lastName)
      narrowParams.push(`query.author=${encodeURIComponent(lastName)}`);
    if (year)
      narrowParams.push(`filter=from-pub-date:${year},until-pub-date:${year}`);

    const narrow = await queryCrossRef(narrowParams);
    if (narrow) return narrow;

    // Fallback: title-only query. Author substring matching in CrossRef can surface
    // wrong results (e.g. "Kirchenbauer" matching "Müller-Kirchenbauer"), so if the
    // narrowed query found nothing we retry without author/year constraints.
    if (narrowParams.length > 0) return await queryCrossRef([]);
  } catch (e) {
    Zotero.debug(`Metadata Hunter: CrossRef request failed: ${e}`);
  }

  return null;
}

// DBLP covers CS conference and journal papers comprehensively.
// The `hit` field may be a single object or an array depending on result count.
async function findDOIFromDBLP(
  item: any,
  title: string,
): Promise<DOIResult | null> {
  const queryWords = cleanTitleForQuery(title).replace(/\s+/g, " ").trim();
  const creators = item.getCreators();
  const authorSuffix =
    creators.length > 0 && creators[0].lastName
      ? ` ${creators[0].lastName}`
      : "";

  const q = encodeURIComponent(queryWords + authorSuffix);
  const url = `https://dblp.org/search/publ/api?q=${q}&format=json&h=5&c=0`;

  try {
    const response: any = await withTimeout(
      Zotero.HTTP.request("GET", url, {
        headers: { "User-Agent": `Zotero Metadata Hunter/${version}` },
      }),
      10_000,
    );
    const data = JSON.parse(response.responseText);
    const rawHits = data.result?.hits?.hit;
    if (!rawHits) return null;

    const hits: any[] = Array.isArray(rawHits) ? rawHits : [rawHits];

    for (const hit of hits) {
      const info = hit.info;
      if (!info || !isTitleMatch(title, info.title)) continue;

      // Direct DOI field (most reliable)
      if (info.doi) return { doi: info.doi as string, abstract: null };

      // Fallback: strip DOI out of the electronic edition URL
      if (info.ee) {
        const ee: string = Array.isArray(info.ee) ? info.ee[0] : info.ee;
        const match = ee.match(/doi\.org\/(.+)$/);
        if (match) return { doi: match[1], abstract: null };
      }
    }
  } catch (e) {
    Zotero.debug(`Metadata Hunter: DBLP request failed: ${e}`);
  }

  return null;
}

// Extracts a DOI from a single arXiv Atom <entry> element.
// Tries <arxiv:doi> first, then falls back to <link title="doi"> href.
function extractDoiFromArxivEntry(entry: Element): string | null {
  const doiEl = entry.getElementsByTagNameNS(
    "http://arxiv.org/schemas/atom",
    "doi",
  )[0];
  if (doiEl?.textContent?.trim()) return doiEl.textContent.trim();

  for (const link of entry.querySelectorAll('link[title="doi"]')) {
    const href = link.getAttribute("href") ?? "";
    const match = href.match(/doi\.org\/(.+)$/);
    if (match) return match[1];
  }
  return null;
}

// arXiv stores the published journal DOI in <arxiv:doi> when the author provided one.
// Many preprints won't have this, but it covers papers that are on arXiv AND published.
async function findDOIFromArXiv(
  item: any,
  title: string,
): Promise<DOIResult | null> {
  const cleanTitle = cleanTitleForQuery(title).replace(/\s+/g, "+");
  const creators = item.getCreators();
  const authorPart =
    creators.length > 0 && creators[0].lastName
      ? `+AND+au:${encodeURIComponent(creators[0].lastName)}`
      : "";

  const url = `https://export.arxiv.org/api/query?search_query=ti:${cleanTitle}${authorPart}&max_results=5&sortBy=relevance`;

  try {
    const response: any = await withTimeout(
      Zotero.HTTP.request("GET", url, {
        headers: { "User-Agent": `Zotero Metadata Hunter/${version}` },
      }),
      10_000,
    );
    const xmlDoc = new DOMParser().parseFromString(
      response.responseText,
      "text/xml",
    );

    for (const entry of xmlDoc.querySelectorAll("entry")) {
      const entryTitle = entry
        .querySelector("title")
        ?.textContent?.trim()
        .replace(/\s+/g, " ");
      if (!entryTitle || !isTitleMatch(title, entryTitle)) continue;

      const doi = extractDoiFromArxivEntry(entry);
      if (doi) return { doi, abstract: null };
    }
  } catch (e) {
    Zotero.debug(`Metadata Hunter: arXiv request failed: ${e}`);
  }

  return null;
}

// Semantic Scholar: title match + DOI + abstract in a single request.
// Uses /paper/search/match which is designed for exact title lookup and returns
// the single best-scoring result directly. Author is intentionally excluded —
// this endpoint is a pure title matcher and extra terms break its scoring.
async function findDOIFromSemanticScholar(
  _item: any,
  title: string,
): Promise<DOIResult | null> {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search/match?query=${encodeURIComponent(cleanTitleForQuery(title))}&fields=externalIds,title,abstract`;

  try {
    const response: any = await withTimeout(
      Zotero.HTTP.request("GET", url, {
        headers: { "User-Agent": `Zotero Metadata Hunter/${version}` },
      }),
      10_000,
    );
    const data = JSON.parse(response.responseText);
    const paper = data.data?.[0];
    if (!paper || !isTitleMatch(title, paper.title)) return null;

    const doi = paper.externalIds?.DOI;
    if (!doi) return null;

    return { doi, abstract: paper.abstract ?? null };
  } catch (e) {
    Zotero.debug(`Metadata Hunter: Semantic Scholar title search failed: ${e}`);
    return null;
  }
}

// Try sources in priority order: CrossRef → DBLP → Semantic Scholar → arXiv.
async function findDOIForItem(item: any): Promise<DOIResult | null> {
  const doi = item.getField("DOI")?.trim();
  if (!item.isRegularItem() || (doi && doi !== "-")) return null;

  const title = item.getField("title");
  if (!title) return null;

  return (
    (await findDOIFromCrossRef(item, title)) ??
    (await findDOIFromDBLP(item, title)) ??
    (await findDOIFromSemanticScholar(item, title)) ??
    (await findDOIFromArXiv(item, title))
  );
}

// ── Abstract finding ───────────────────────────────────────────────────────────

async function findAbstractFromSemanticScholar(
  doi: string,
): Promise<string | null> {
  try {
    const response = await Zotero.HTTP.request(
      "GET",
      `https://api.semanticscholar.org/graph/v1/paper/DOI:${doi}?fields=abstract`,
      { headers: { "User-Agent": `Zotero Metadata Hunter/${version}` } },
    );
    return JSON.parse(response.responseText).abstract ?? null;
  } catch (e) {
    Zotero.debug(`Metadata Hunter: Semantic Scholar failed: ${e}`);
    return null;
  }
}

async function findAbstractFromPubMed(doi: string): Promise<string | null> {
  try {
    const searchResponse = await Zotero.HTTP.request(
      "GET",
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(doi)}&retmode=json`,
    );
    const ids = JSON.parse(searchResponse.responseText).esearchresult?.idlist;
    if (!ids?.length) return null;

    const fetchResponse = await Zotero.HTTP.request(
      "GET",
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids[0]}&retmode=xml`,
    );
    const xmlDoc = new DOMParser().parseFromString(
      fetchResponse.responseText,
      "text/xml",
    );
    return xmlDoc.querySelector("AbstractText")?.textContent ?? null;
  } catch (e) {
    Zotero.debug(`Metadata Hunter: PubMed failed: ${e}`);
    return null;
  }
}

async function findAbstractFromOpenAlex(doi: string): Promise<string | null> {
  try {
    const response = await Zotero.HTTP.request(
      "GET",
      `https://api.openalex.org/works/doi:${doi}`,
      { headers: { "User-Agent": `Zotero Metadata Hunter/${version}` } },
    );
    const data = JSON.parse(response.responseText);
    if (data.abstract_inverted_index) {
      return reconstructAbstract(data.abstract_inverted_index);
    }
  } catch (e) {
    Zotero.debug(`Metadata Hunter: OpenAlex failed: ${e}`);
  }
  return null;
}

function reconstructAbstract(invertedIndex: Record<string, number[]>): string {
  const words: string[] = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words[pos] = word;
    }
  }
  return words.join(" ");
}

// Race all three abstract sources simultaneously. The first to return a non-null
// value wins; if all fail or return null, we return null.
async function findAbstractForItem(
  item: any,
  doi: string,
): Promise<string | null> {
  if (item.getField("abstractNote")?.trim()) return null;

  try {
    return await Promise.any([
      withNullAsReject(
        withTimeout(findAbstractFromSemanticScholar(doi), 8_000),
      ),
      withNullAsReject(withTimeout(findAbstractFromPubMed(doi), 8_000)),
      withNullAsReject(withTimeout(findAbstractFromOpenAlex(doi), 8_000)),
    ]);
  } catch {
    // AggregateError: every source returned null or timed out
    return null;
  }
}

// ── Item analysis ──────────────────────────────────────────────────────────────

interface ItemStats {
  totalRegular: number;
  withDOI: number;
  withAbstract: number;
}

// Single pass: collect stats and filter items that need processing.
function analyzeItems(items: any[]): { toProcess: any[]; stats: ItemStats } {
  let totalRegular = 0,
    withDOI = 0,
    withAbstract = 0;
  const toProcess: any[] = [];

  for (const item of items) {
    if (!item.isRegularItem()) continue;
    totalRegular++;

    const doi = item.getField("DOI")?.trim();
    const hasDOI = doi && doi !== "-";
    if (hasDOI) withDOI++;

    const hasAbstract = !!item.getField("abstractNote")?.trim();
    if (hasAbstract) withAbstract++;

    if (!hasDOI || !hasAbstract) toProcess.push(item);
  }

  return { toProcess, stats: { totalRegular, withDOI, withAbstract } };
}

// ── Batch processing ───────────────────────────────────────────────────────────

interface ProcessResult {
  foundDOIs: number;
  foundAbstracts: number;
  processed: number;
  cancelled: boolean;
  hadApiErrors: boolean;
}

const BATCH_SIZE = 5;
// Minimum time between batch starts. If a batch resolves faster than this
// (all items cached / already processed), we pad to avoid hammering APIs.
const BATCH_MIN_INTERVAL_MS = 300;

async function processItems(
  items: any[],
  cancel: CancelToken,
): Promise<ProcessResult> {
  const result: ProcessResult = {
    foundDOIs: 0,
    foundAbstracts: 0,
    processed: 0,
    cancelled: false,
    hadApiErrors: false,
  };

  const progressWin = new Zotero.ProgressWindow({ closeOnClick: false });
  progressWin.changeHeadline(getString("findDOI.progress.title"));
  progressWin.addLines(
    getString("findDOI.progress.hint"),
    "chrome://zotero/skin/16/universal/book.svg",
  );
  progressWin.show();

  const startTime = Date.now();
  const total = items.length;

  const updateProgress = () => {
    progressWin.changeHeadline(
      getString("findDOI.progress.item", {
        current: result.processed,
        total,
        percent: Math.round((result.processed / total) * 100),
        dois: result.foundDOIs,
        abstracts: result.foundAbstracts,
        eta: formatEta(startTime, result.processed, total),
      }),
    );
  };

  for (let batchStart = 0; batchStart < total; batchStart += BATCH_SIZE) {
    if (cancel.requested) {
      result.cancelled = true;
      break;
    }

    const batch = items.slice(batchStart, batchStart + BATCH_SIZE);
    const batchStartTime = Date.now();

    await Promise.all(
      batch.map(async (item) => {
        if (cancel.requested) return;
        try {
          let doi = item.getField("DOI")?.trim();
          const hadDOI = doi && doi !== "-";

          let bundledAbstract: string | null = null;

          if (!hadDOI) {
            const found = await findDOIForItem(item);
            if (found) {
              doi = found.doi;
              bundledAbstract = found.abstract; // may be non-null when SS won the race
              item.setField("DOI", doi);
              await item.saveTx();
              result.foundDOIs++;
            }
          }

          if (doi && doi !== "-") {
            // Use the abstract that came bundled with the DOI result (SS only),
            // otherwise fall back to the dedicated abstract lookup.
            const abstract =
              bundledAbstract && !item.getField("abstractNote")?.trim()
                ? bundledAbstract
                : await findAbstractForItem(item, doi);
            if (abstract) {
              item.setField("abstractNote", abstract);
              await item.saveTx();
              result.foundAbstracts++;
            }
          }
        } catch (e) {
          Zotero.debug(
            `Metadata Hunter: Error processing item ${item.id}: ${e}`,
          );
          result.hadApiErrors = true;
        }

        result.processed++;
        updateProgress();
      }),
    );

    // Pad to BATCH_MIN_INTERVAL_MS only if there are more items coming,
    // so we never delay after the final batch.
    const isLastBatch = batchStart + BATCH_SIZE >= total;
    if (!isLastBatch && !cancel.requested) {
      const elapsed = Date.now() - batchStartTime;
      const pad = BATCH_MIN_INTERVAL_MS - elapsed;
      if (pad > 0) await Zotero.Promise.delay(pad);
    }
  }

  progressWin.close();
  return result;
}

// ── Result message ─────────────────────────────────────────────────────────────

function buildResultMessage(r: ProcessResult): string {
  let msg: string;

  if (r.cancelled) {
    msg = getString("findDOI.cancelled", {
      processed: r.processed,
      dois: r.foundDOIs,
      abstracts: r.foundAbstracts,
    });
  } else if (r.foundDOIs === 0 && r.foundAbstracts === 0) {
    msg = getString("findDOI.noneFound");
  } else if (r.foundDOIs === 0) {
    msg = getString("findDOI.foundAbstractsOnly", {
      abstracts: r.foundAbstracts,
    });
  } else if (r.foundAbstracts === 0) {
    msg = getString("findDOI.foundDOIsOnly", { dois: r.foundDOIs });
  } else {
    msg = getString("findDOI.found", {
      dois: r.foundDOIs,
      abstracts: r.foundAbstracts,
      total: r.processed,
    });
  }

  if (r.hadApiErrors) msg += getString("findDOI.apiWarning");
  return msg;
}

// ── Preprint detection & published version finding ──────────────────────────────

// Known preprint server venues to exclude from "published" results.
const PUBLISHED_CROSSREF_TYPES = new Set([
  "journal-article",
  "proceedings-article",
  "book-chapter",
]);

const PREPRINT_VENUES = new Set([
  "arxiv",
  "corr",
  "ssrn",
  "biorxiv",
  "medrxiv",
  "preprints.org",
  "research square",
  "techrxiv",
]);

function extractArxivId(item: any): string | null {
  const url: string = item.getField("url") ?? "";
  const urlMatch = url.match(/arxiv\.org\/abs\/(\d{4}\.\d{4,5})/);
  if (urlMatch) return urlMatch[1];

  const doi: string = item.getField("DOI") ?? "";
  const doiMatch = doi.match(/10\.48550\/arXiv\.(\d{4}\.\d{4,5})/);
  if (doiMatch) return doiMatch[1];

  const extra: string = item.getField("extra") ?? "";
  const extraMatch = extra.match(/arXiv:(\d{4}\.\d{4,5})/);
  if (extraMatch) return extraMatch[1];

  return null;
}

function isPreprint(item: any): boolean {
  if (!item.isRegularItem()) return false;
  if (item.itemType === "preprint") return true;
  const url: string = item.getField("url") ?? "";
  if (url.includes("arxiv.org")) return true;
  // Items imported from DBLP as CoRR entries (arXiv CS preprints)
  const pub: string = (
    item.getField("publicationTitle") ??
    item.getField("proceedingsTitle") ??
    ""
  ).toLowerCase();
  if (pub === "corr") return true;
  return extractArxivId(item) !== null;
}

function identifyPreprints(items: any[]): any[] {
  return items.filter(isPreprint);
}

function isPublishedDOI(doi: string): boolean {
  return !doi.startsWith("10.48550/arXiv.");
}

function isPublishedVenue(venue: string): boolean {
  if (!venue || !venue.trim()) return false;
  return !PREPRINT_VENUES.has(venue.toLowerCase().trim());
}

// Direct arXiv ID lookup — extracts the journal DOI the author reported on arXiv.
// NOT a title search; fetches metadata for the specific arXiv entry only.
async function findPublishedDOIFromArxivById(
  arxivId: string,
): Promise<string | null> {
  const url = `https://export.arxiv.org/api/query?id_list=${arxivId}&max_results=1`;
  try {
    const response: any = await withTimeout(
      Zotero.HTTP.request("GET", url, {
        headers: { "User-Agent": `Zotero Metadata Hunter/${version}` },
      }),
      10_000,
    );
    const xmlDoc = new DOMParser().parseFromString(
      response.responseText,
      "text/xml",
    );
    const entry = xmlDoc.querySelector("entry");
    if (!entry) return null;

    const doi = extractDoiFromArxivEntry(entry);
    if (doi && isPublishedDOI(doi)) return doi;
  } catch (e) {
    Zotero.debug(`Metadata Hunter: arXiv ID lookup failed: ${e}`);
  }
  return null;
}

async function findPublishedDOIFromSemanticScholar(
  title: string,
): Promise<string | null> {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search/match?query=${encodeURIComponent(cleanTitleForQuery(title))}&fields=externalIds,title,venue,publicationVenue`;
  try {
    const response: any = await withTimeout(
      Zotero.HTTP.request("GET", url, {
        headers: { "User-Agent": `Zotero Metadata Hunter/${version}` },
      }),
      10_000,
    );
    const data = JSON.parse(response.responseText);
    const paper = data.data?.[0];
    if (!paper || !isTitleMatch(title, paper.title)) return null;

    const doi = paper.externalIds?.DOI;
    if (!doi || !isPublishedDOI(doi)) return null;

    const venue =
      paper.publicationVenue?.name ??
      paper.publicationVenue?.alternate_names?.[0] ??
      paper.venue ??
      "";
    if (!isPublishedVenue(venue)) return null;

    return doi;
  } catch (e) {
    Zotero.debug(
      `Metadata Hunter: Semantic Scholar preprint lookup failed: ${e}`,
    );
    return null;
  }
}

async function findPublishedDOIFromCrossRef(
  item: any,
  title: string,
): Promise<string | null> {
  const creators = item.getCreators();
  const lastName = creators.length > 0 ? creators[0].lastName : null;
  const titleParam = `query.bibliographic=${encodeURIComponent(cleanTitleForQuery(title))}`;
  const params = [titleParam];
  if (lastName) params.push(`query.author=${encodeURIComponent(lastName)}`);

  const url = `https://api.crossref.org/works?${params.join("&")}&rows=10`;
  try {
    const response: any = await withTimeout(
      Zotero.HTTP.request("GET", url, {
        headers: { "User-Agent": `Zotero Metadata Hunter/${version}` },
      }),
      10_000,
    );
    const data = JSON.parse(response.responseText);
    for (const crItem of data.message?.items ?? []) {
      if (!crItem.DOI || !isPublishedDOI(crItem.DOI)) continue;
      if (!isTitleMatch(title, crItem.title?.[0])) continue;
      if (PUBLISHED_CROSSREF_TYPES.has(crItem.type ?? "")) return crItem.DOI;
    }
  } catch (e) {
    Zotero.debug(`Metadata Hunter: CrossRef preprint lookup failed: ${e}`);
  }
  return null;
}

async function findPublishedDOIFromDBLP(
  item: any,
  title: string,
): Promise<string | null> {
  const queryWords = cleanTitleForQuery(title).replace(/\s+/g, " ").trim();
  const creators = item.getCreators();
  const authorSuffix =
    creators.length > 0 && creators[0].lastName
      ? ` ${creators[0].lastName}`
      : "";

  const q = encodeURIComponent(queryWords + authorSuffix);
  const url = `https://dblp.org/search/publ/api?q=${q}&format=json&h=5&c=0`;

  try {
    const response: any = await withTimeout(
      Zotero.HTTP.request("GET", url, {
        headers: { "User-Agent": `Zotero Metadata Hunter/${version}` },
      }),
      10_000,
    );
    const data = JSON.parse(response.responseText);
    const rawHits = data.result?.hits?.hit;
    if (!rawHits) return null;

    const hits: any[] = Array.isArray(rawHits) ? rawHits : [rawHits];

    for (const hit of hits) {
      const info = hit.info;
      if (!info || !isTitleMatch(title, info.title)) continue;
      if (!isPublishedVenue(info.venue ?? "")) continue;

      if (info.doi && isPublishedDOI(info.doi)) return info.doi as string;

      if (info.ee) {
        const ee: string = Array.isArray(info.ee) ? info.ee[0] : info.ee;
        const match = ee.match(/doi\.org\/(.+)$/);
        if (match && isPublishedDOI(match[1])) return match[1];
      }
    }
  } catch (e) {
    Zotero.debug(`Metadata Hunter: DBLP preprint lookup failed: ${e}`);
  }
  return null;
}

async function findPublishedDOI(item: any): Promise<string | null> {
  const title = item.getField("title");
  if (!title) return null;

  const arxivId = extractArxivId(item);
  if (arxivId) {
    const doi = await findPublishedDOIFromArxivById(arxivId);
    if (doi) return doi;
  }

  // Race all three fallback sources — first non-null result wins,
  // same pattern as findAbstractForItem.
  try {
    return await Promise.any([
      withNullAsReject(
        withTimeout(findPublishedDOIFromSemanticScholar(title), 10_000),
      ),
      withNullAsReject(
        withTimeout(findPublishedDOIFromCrossRef(item, title), 10_000),
      ),
      withNullAsReject(
        withTimeout(findPublishedDOIFromDBLP(item, title), 10_000),
      ),
    ]);
  } catch {
    return null;
  }
}

// Use Zotero's Translate.Search API — same mechanism as "Add Item by Identifier".
async function createItemFromDOI(
  doi: string,
  sourceItem: any,
): Promise<boolean> {
  try {
    const translate = new Zotero.Translate.Search();
    translate.setIdentifier({ DOI: doi });
    const translators = await translate.getTranslators();
    if (!translators.length) return false;
    translate.setTranslator(translators);
    const newItems = await translate.translate({
      libraryID: sourceItem.libraryID,
      collections: sourceItem.getCollections(),
      saveAttachments: false,
    });
    return newItems && newItems.length > 0;
  } catch (e) {
    Zotero.debug(
      `Metadata Hunter: Failed to create item from DOI ${doi}: ${e}`,
    );
    return false;
  }
}

interface PreprintResult {
  found: number;
  checked: number;
  cancelled: boolean;
  hadApiErrors: boolean;
}

async function processPreprints(
  items: any[],
  cancel: CancelToken,
): Promise<PreprintResult> {
  const result: PreprintResult = {
    found: 0,
    checked: 0,
    cancelled: false,
    hadApiErrors: false,
  };

  const progressWin = new Zotero.ProgressWindow({ closeOnClick: false });
  progressWin.changeHeadline(getString("preprint.progress.title"));
  progressWin.addLines(
    getString("preprint.progress.hint"),
    "chrome://zotero/skin/16/universal/book.svg",
  );
  progressWin.show();

  const startTime = Date.now();
  const total = items.length;

  const updateProgress = () => {
    progressWin.changeHeadline(
      getString("preprint.progress.item", {
        current: result.checked,
        total,
        percent: Math.round((result.checked / total) * 100),
        found: result.found,
        eta: formatEta(startTime, result.checked, total),
      }),
    );
  };

  for (let batchStart = 0; batchStart < total; batchStart += BATCH_SIZE) {
    if (cancel.requested) {
      result.cancelled = true;
      break;
    }

    const batch = items.slice(batchStart, batchStart + BATCH_SIZE);
    const batchStartTime = Date.now();

    await Promise.all(
      batch.map(async (item) => {
        if (cancel.requested) return;
        try {
          const doi = await findPublishedDOI(item);
          if (doi) {
            const created = await createItemFromDOI(doi, item);
            if (created) {
              item.deleted = true;
              await item.saveTx();
              result.found++;
            }
          }
        } catch (e) {
          Zotero.debug(
            `Metadata Hunter: Error checking preprint ${item.id}: ${e}`,
          );
          result.hadApiErrors = true;
        }

        result.checked++;
        updateProgress();
      }),
    );

    const isLastBatch = batchStart + BATCH_SIZE >= total;
    if (!isLastBatch && !cancel.requested) {
      const elapsed = Date.now() - batchStartTime;
      const pad = BATCH_MIN_INTERVAL_MS - elapsed;
      if (pad > 0) await Zotero.Promise.delay(pad);
    }
  }

  progressWin.close();
  return result;
}

function buildPreprintResultMessage(r: PreprintResult): string {
  let msg: string;

  if (r.cancelled) {
    msg = getString("preprint.cancelled", {
      checked: r.checked,
      found: r.found,
    });
  } else if (r.found === 0) {
    msg = getString("preprint.noPublished", { total: r.checked });
  } else {
    msg = getString("preprint.found", {
      found: r.found,
      total: r.checked,
    });
  }

  if (r.hadApiErrors) msg += getString("preprint.apiWarning");
  return msg;
}

async function runFindPublishedVersions(
  preprints: any[],
  noneFoundKey: string,
): Promise<void> {
  if (activeCancel) return;

  if (preprints.length === 0) {
    Services.prompt.alert(
      null,
      getString("preprint.title"),
      getString(noneFoundKey),
    );
    return;
  }

  const cancel = new CancelToken();
  activeCancel = cancel;
  syncAllToolbarButtons();

  try {
    const result = await processPreprints(preprints, cancel);
    Services.prompt.alert(
      null,
      getString("preprint.title"),
      buildPreprintResultMessage(result),
    );
  } finally {
    activeCancel = null;
    syncAllToolbarButtons();
  }
}

async function findPublishedVersions(): Promise<void> {
  const ZP = Zotero.getActiveZoteroPane();
  let items: any[] = ZP.getSelectedItems();

  if (items.length === 0) {
    const collection = ZP.getSelectedCollection();
    const libraryID = collection
      ? collection.libraryID
      : ZP.getSelectedLibraryID();
    items = collection
      ? collection.getChildItems()
      : await Zotero.Items.getAll(libraryID);
  }

  await runFindPublishedVersions(
    identifyPreprints(items),
    "preprint.noneFound",
  );
}

async function findPublishedVersionsForSelected(): Promise<void> {
  const ZP = Zotero.getActiveZoteroPane();
  await runFindPublishedVersions(
    identifyPreprints(ZP.getSelectedItems()),
    "preprint.noneFoundSelected",
  );
}

// ── Entry points ───────────────────────────────────────────────────────────────

async function findDOIs(): Promise<void> {
  if (activeCancel) return; // already running

  const ZP = Zotero.getActiveZoteroPane();
  let items: any[] = ZP.getSelectedItems();

  if (items.length === 0) {
    const collection = ZP.getSelectedCollection();
    const libraryID = collection
      ? collection.libraryID
      : ZP.getSelectedLibraryID();
    items = collection
      ? collection.getChildItems()
      : await Zotero.Items.getAll(libraryID);
  }

  const { toProcess } = analyzeItems(items);
  if (toProcess.length === 0) {
    Services.prompt.alert(
      null,
      getString("findDOI.title"),
      getString("findDOI.allHaveData"),
    );
    return;
  }

  const cancel = new CancelToken();
  activeCancel = cancel;
  syncAllToolbarButtons();

  try {
    const result = await processItems(toProcess, cancel);
    Services.prompt.alert(
      null,
      getString("findDOI.title"),
      buildResultMessage(result),
    );
  } finally {
    activeCancel = null;
    syncAllToolbarButtons();
  }
}

async function findDOIsForSelected(): Promise<void> {
  if (activeCancel) return; // already running

  const ZP = Zotero.getActiveZoteroPane();
  const { toProcess } = analyzeItems(ZP.getSelectedItems());

  if (toProcess.length === 0) {
    Services.prompt.alert(
      null,
      getString("findDOI.title"),
      getString("findDOI.allSelectedHaveData"),
    );
    return;
  }

  const cancel = new CancelToken();
  activeCancel = cancel;
  syncAllToolbarButtons();

  try {
    const result = await processItems(toProcess, cancel);
    Services.prompt.alert(
      null,
      getString("findDOI.title"),
      buildResultMessage(result),
    );
  } finally {
    activeCancel = null;
    syncAllToolbarButtons();
  }
}

export default {};
