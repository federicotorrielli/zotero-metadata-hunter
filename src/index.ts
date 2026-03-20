import { config } from "../package.json";
import { registerWindowMenus, unregisterWindowMenus } from "./modules/menu";
import { getString } from "./utils/locale";

declare const Zotero: any;
declare const Services: any;

const windowKeyHandlers = new WeakMap<Window, (e: KeyboardEvent) => void>();

// Set up the plugin namespace immediately when the script is loaded.
Zotero.DOIFinder = {
  async startup(_data: { id: string; version: string; rootURI: string }) {
    Zotero.debug("DOI Finder: Startup");
  },

  shutdown() {
    Zotero.debug("DOI Finder: Shutdown");
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

  findDOIs,
  findDOIsForSelected,
};

// ── Window UI ─────────────────────────────────────────────────────────────────

function setupWindowToolbar(win: Window) {
  const doc = (win as any).document;
  const toolbar = doc.getElementById("zotero-tb-advanced-search");
  if (!toolbar || doc.getElementById(`${config.addonRef}-button`)) return;

  const btn = doc.createXULElement("toolbarbutton");
  btn.id = `${config.addonRef}-button`;
  btn.className = "zotero-tb-button";
  btn.setAttribute("title", getString("toolbar.tooltip"));
  btn.setAttribute("label", getString("toolbar.label"));
  btn.setAttribute("image", "chrome://zotero/skin/16/universal/book.svg");
  btn.addEventListener("command", () => findDOIs());
  toolbar.parentElement?.insertBefore(btn, toolbar.nextSibling);
}

function teardownWindowToolbar(win: Window) {
  (win as any).document.getElementById(`${config.addonRef}-button`)?.remove();
}

function setupWindowKeyShortcut(win: Window) {
  const handler = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === "d") {
      findDOIs();
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

// ── DOI finding ───────────────────────────────────────────────────────────────

function hasValidDOI(item: any): boolean {
  const doi = item.getField("DOI");
  return doi && doi.trim() !== "" && doi.trim() !== "-";
}

async function findDOIForItem(item: any): Promise<string | null> {
  if (!item.isRegularItem() || hasValidDOI(item)) return null;

  const title = item.getField("title");
  if (!title) return null;

  const queryParts = [`query.bibliographic=${encodeURIComponent(title)}`];

  const creators = item.getCreators();
  if (creators.length > 0 && creators[0].lastName) {
    queryParts.push(`query.author=${encodeURIComponent(creators[0].lastName)}`);
  }

  const year = item.getField("date")?.match(/\d{4}/)?.[0];
  if (year) {
    queryParts.push(`filter=from-pub-date:${year},until-pub-date:${year}`);
  }

  const url = `https://api.crossref.org/works?${queryParts.join("&")}&rows=5`;
  Zotero.debug(`DOI Finder: Querying CrossRef: ${url}`);

  try {
    const response = await Zotero.HTTP.request("GET", url, {
      headers: { "User-Agent": `Zotero DOI Finder/${Zotero.DOIFinder.version ?? "0.0.1"}` },
    });
    const data = JSON.parse(response.responseText);
    for (const crossrefItem of data.message?.items ?? []) {
      if (crossrefItem.DOI && isTitleMatch(title, crossrefItem.title?.[0])) {
        Zotero.debug(`DOI Finder: Found DOI: ${crossrefItem.DOI}`);
        return crossrefItem.DOI;
      }
    }
  } catch (e) {
    Zotero.debug(`DOI Finder: CrossRef request failed: ${e}`);
  }

  return null;
}

function isTitleMatch(title1: string, title2: string): boolean {
  if (!title1 || !title2) return false;

  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();

  const n1 = normalize(title1);
  const n2 = normalize(title2);

  if (n1 === n2 || n1.includes(n2) || n2.includes(n1)) return true;
  return calculateSimilarity(n1, n2) > 0.85;
}

function calculateSimilarity(s1: string, s2: string): number {
  const longer = s1.length >= s2.length ? s1 : s2;
  const shorter = s1.length >= s2.length ? s2 : s1;
  if (longer.length === 0) return 1.0;
  return (longer.length - levenshteinDistance(longer, shorter)) / longer.length;
}

function levenshteinDistance(s1: string, s2: string): number {
  const matrix: number[][] = Array.from({ length: s2.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= s1.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      matrix[i][j] =
        s2[i - 1] === s1[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[s2.length][s1.length];
}

// ── Abstract finding ──────────────────────────────────────────────────────────

async function findAbstractFromSemanticScholar(doi: string): Promise<string | null> {
  try {
    const response = await Zotero.HTTP.request(
      "GET",
      `https://api.semanticscholar.org/graph/v1/paper/DOI:${doi}?fields=abstract`,
      { headers: { "User-Agent": "Zotero DOI Finder/0.0.1" } }
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
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(doi)}&retmode=json`
    );
    const ids = JSON.parse(searchResponse.responseText).esearchresult?.idlist;
    if (!ids?.length) return null;

    const fetchResponse = await Zotero.HTTP.request(
      "GET",
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids[0]}&retmode=xml`
    );
    const xmlDoc = new DOMParser().parseFromString(fetchResponse.responseText, "text/xml");
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
      { headers: { "User-Agent": "Zotero DOI Finder/0.0.1" } }
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

async function findAbstractForItem(item: any, doi: string): Promise<string | null> {
  const existing = item.getField("abstractNote");
  if (existing?.trim()) return null;

  Zotero.debug(`DOI Finder: Searching for abstract with DOI: ${doi}`);

  return (
    (await findAbstractFromSemanticScholar(doi)) ??
    (await findAbstractFromPubMed(doi)) ??
    (await findAbstractFromOpenAlex(doi))
  );
}

// ── Batch processing ──────────────────────────────────────────────────────────

async function processItems(
  items: any[],
  stats: { withDOI: number; withAbstract: number; totalRegular: number }
): Promise<{ foundDOIs: number; foundAbstracts: number; total: number }> {
  const progressWin = new Zotero.ProgressWindow({ closeOnClick: false });
  progressWin.changeHeadline(getString("findDOI.progress.title"));
  progressWin.addLines(
    `Processing ${items.length} items (${stats.withDOI}/${stats.totalRegular} have DOIs, ${stats.withAbstract} have abstracts)`,
    "chrome://zotero/skin/16/universal/book.svg"
  );
  progressWin.show();

  let foundDOIs = 0;
  let foundAbstracts = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const percent = Math.round(((i + 1) / items.length) * 100);
    progressWin.changeHeadline(
      getString("findDOI.progress.item", { current: i + 1, total: items.length, percent })
    );

    try {
      let doi = item.getField("DOI")?.trim();
      if (!doi || doi === "-") {
        doi = await findDOIForItem(item);
        if (doi) {
          item.setField("DOI", doi);
          await item.saveTx();
          foundDOIs++;
        }
      }

      if (doi) {
        const abstract = await findAbstractForItem(item, doi);
        if (abstract) {
          item.setField("abstractNote", abstract);
          await item.saveTx();
          foundAbstracts++;
        }
      }
    } catch (e) {
      Zotero.debug(`DOI Finder: Error processing item ${item.id}: ${e}`);
    }

    await Zotero.Promise.delay(300);
  }

  progressWin.close();
  return { foundDOIs, foundAbstracts, total: items.length };
}

function countItemStats(items: any[]) {
  let totalRegular = 0, withDOI = 0, withAbstract = 0;
  for (const item of items) {
    if (!item.isRegularItem()) continue;
    totalRegular++;
    const doi = item.getField("DOI");
    if (doi && doi.trim() !== "" && doi.trim() !== "-") withDOI++;
    if (item.getField("abstractNote")?.trim()) withAbstract++;
  }
  return { totalRegular, withDOI, withAbstract };
}

function needsProcessing(item: any): boolean {
  if (!item.isRegularItem()) return false;
  const doi = item.getField("DOI");
  const needsDOI = !doi || doi.trim() === "" || doi.trim() === "-";
  const needsAbstract = !item.getField("abstractNote")?.trim();
  return needsDOI || needsAbstract;
}

function buildResultMessage(foundDOIs: number, foundAbstracts: number, total: number): string {
  if (foundDOIs === 0 && foundAbstracts === 0) return "No new DOIs or abstracts were found.";
  if (foundDOIs === 0) return `Found ${foundAbstracts} new abstracts. No new DOIs were found.`;
  if (foundAbstracts === 0) return `Found ${foundDOIs} new DOIs. No abstracts were found.`;
  return `Found ${foundDOIs} new DOIs and ${foundAbstracts} abstracts for ${total} items processed.`;
}

// ── Entry points ──────────────────────────────────────────────────────────────

async function findDOIs(): Promise<void> {
  const ZP = Zotero.getActiveZoteroPane();
  let items: any[] = ZP.getSelectedItems();

  if (items.length === 0) {
    const collection = ZP.getSelectedCollection();
    const libraryID = collection ? collection.libraryID : ZP.getSelectedLibraryID();
    items = collection ? collection.getChildItems() : await Zotero.Items.getAll(libraryID);
  }

  const itemsToProcess = items.filter(needsProcessing);
  if (itemsToProcess.length === 0) {
    Services.prompt.alert(null, getString("findDOI.title"), "All items already have DOIs and abstracts.");
    return;
  }

  const result = await processItems(itemsToProcess, countItemStats(items));
  Services.prompt.alert(null, getString("findDOI.title"), buildResultMessage(result.foundDOIs, result.foundAbstracts, result.total));
}

async function findDOIsForSelected(): Promise<void> {
  const ZP = Zotero.getActiveZoteroPane();
  const items = ZP.getSelectedItems();
  const itemsToProcess = items.filter(needsProcessing);

  if (itemsToProcess.length === 0) {
    Services.prompt.alert(null, getString("findDOI.title"), "All selected items already have DOIs and abstracts.");
    return;
  }

  const result = await processItems(itemsToProcess, countItemStats(items));
  Services.prompt.alert(null, getString("findDOI.title"), buildResultMessage(result.foundDOIs, result.foundAbstracts, result.total));
}

export default {};
