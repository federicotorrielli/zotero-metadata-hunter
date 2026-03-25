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

Zotero.DOIFinder = {
  async startup(_data: { id: string; version: string; rootURI: string }) {
    Zotero.debug("DOI Finder: Startup");
    for (const win of Zotero.getMainWindows()) {
      Zotero.DOIFinder.onMainWindowLoad(win);
    }
  },

  shutdown() {
    Zotero.debug("DOI Finder: Shutdown");
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
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      if (activeCancel) {
        activeCancel.cancel();
      } else {
        findDOIs();
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

  // Drop subtitle (after colon or em-dash) — CrossRef ranks shorter, focused queries higher
  const noSubtitle = decoded.replace(/\s*[:\u2014].*$/, "").trim();

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

  if (n1 === n2 || n1.includes(n2) || n2.includes(n1)) return true;

  // If the length difference alone rules out ≥0.85 similarity, skip the O(n²) matrix
  const longer = Math.max(n1.length, n2.length);
  const shorter = Math.min(n1.length, n2.length);
  if (longer > 0 && (longer - shorter) / longer > 0.15) return false;

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
  const queryParts = [
    `query.bibliographic=${encodeURIComponent(cleanTitleForQuery(title))}`,
  ];

  const creators = item.getCreators();
  if (creators.length > 0 && creators[0].lastName) {
    queryParts.push(`query.author=${encodeURIComponent(creators[0].lastName)}`);
  }

  const year = item.getField("date")?.match(/\d{4}/)?.[0];
  if (year) {
    queryParts.push(`filter=from-pub-date:${year},until-pub-date:${year}`);
  }

  const url = `https://api.crossref.org/works?${queryParts.join("&")}&rows=5`;

  try {
    const response: any = await withTimeout(
      Zotero.HTTP.request("GET", url, {
        headers: { "User-Agent": `Zotero DOI Finder/${version}` },
      }),
      10_000,
    );
    const data = JSON.parse(response.responseText);
    for (const crossrefItem of data.message?.items ?? []) {
      if (crossrefItem.DOI && isTitleMatch(title, crossrefItem.title?.[0])) {
        return { doi: crossrefItem.DOI as string, abstract: null };
      }
    }
  } catch (e) {
    Zotero.debug(`DOI Finder: CrossRef request failed: ${e}`);
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
        headers: { "User-Agent": `Zotero DOI Finder/${version}` },
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
    Zotero.debug(`DOI Finder: DBLP request failed: ${e}`);
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
        headers: { "User-Agent": `Zotero DOI Finder/${version}` },
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

      // <arxiv:doi> element (namespace: http://arxiv.org/schemas/atom)
      const doiEl = entry.getElementsByTagNameNS(
        "http://arxiv.org/schemas/atom",
        "doi",
      )[0];
      if (doiEl?.textContent?.trim())
        return { doi: doiEl.textContent.trim(), abstract: null };

      // Fallback: <link rel="related" title="doi" href="https://dx.doi.org/10.xxx/yyy"/>
      for (const link of entry.querySelectorAll('link[title="doi"]')) {
        const href = link.getAttribute("href") ?? "";
        const match = href.match(/doi\.org\/(.+)$/);
        if (match) return { doi: match[1], abstract: null };
      }
    }
  } catch (e) {
    Zotero.debug(`DOI Finder: arXiv request failed: ${e}`);
  }

  return null;
}

// Semantic Scholar: title match + DOI + abstract in a single request.
// Uses /paper/search/match which is designed for exact title lookup and returns
// the single best-scoring result directly, avoiding the need to pick from a list.
async function findDOIFromSemanticScholar(
  item: any,
  title: string,
): Promise<DOIResult | null> {
  const creators = item.getCreators();
  const authorPart =
    creators.length > 0 && creators[0].lastName
      ? `+${encodeURIComponent(creators[0].lastName)}`
      : "";

  const query = encodeURIComponent(cleanTitleForQuery(title)) + authorPart;
  const url = `https://api.semanticscholar.org/graph/v1/paper/search/match?query=${query}&fields=externalIds,title,abstract`;

  try {
    const response: any = await withTimeout(
      Zotero.HTTP.request("GET", url, {
        headers: { "User-Agent": `Zotero DOI Finder/${version}` },
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
    Zotero.debug(`DOI Finder: Semantic Scholar title search failed: ${e}`);
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
      { headers: { "User-Agent": `Zotero DOI Finder/${version}` } },
    );
    return JSON.parse(response.responseText).abstract ?? null;
  } catch (e) {
    Zotero.debug(`DOI Finder: Semantic Scholar failed: ${e}`);
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
    Zotero.debug(`DOI Finder: PubMed failed: ${e}`);
    return null;
  }
}

async function findAbstractFromOpenAlex(doi: string): Promise<string | null> {
  try {
    const response = await Zotero.HTTP.request(
      "GET",
      `https://api.openalex.org/works/doi:${doi}`,
      { headers: { "User-Agent": `Zotero DOI Finder/${version}` } },
    );
    const data = JSON.parse(response.responseText);
    if (data.abstract_inverted_index) {
      return reconstructAbstract(data.abstract_inverted_index);
    }
  } catch (e) {
    Zotero.debug(`DOI Finder: OpenAlex failed: ${e}`);
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
          Zotero.debug(`DOI Finder: Error processing item ${item.id}: ${e}`);
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
