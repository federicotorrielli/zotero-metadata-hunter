import { firstAuthorLastName } from "../domain/creators";
import { isPublishedDOI, isPublishedVenue } from "../domain/preprint";
import { cleanTitleForQuery, isTitleMatch } from "../match/title";
import type { Http } from "../net/http";
import type { DOIResult, PublishedRef, ZoteroItem } from "../types";

// dblp.org, dblp.dagstuhl.de and dblp.uni-trier.de are three separate machines
// serving the same index, and they go down one at a time. While this was
// written, dblp.uni-trier.de returned HTTP 500 for every search while the other
// two worked. The host to use is therefore chosen at run time.
export const PUBLIC_HOSTS = [
  "https://dblp.org",
  "https://dblp.dagstuhl.de",
  "https://dblp.uni-trier.de",
];

// The maintainer's own mirror. It is checked alone before the public hosts.
export const DEFAULT_HOST = "https://dblp.federicotorrielli.me";

// Short on purpose. The public hosts are checked at once, so the slowest one sets
// the delay before the first lookup of the session.
const CHECK_TIMEOUT_MS = 5_000;

// How long DBLP is skipped once every host has failed. Without it, a library run
// would spend one timeout per host per item on a service that is down.
export const RETRY_PAUSE_MS = 60_000;

const searchURL = (host: string, query: string, hits: number): string =>
  `${host}/search/publ/api?q=${encodeURIComponent(query)}&format=json&h=${hits}&c=0`;

export interface DblpDeps {
  http: Http;
  // The host typed in the preferences pane, or null. Read on every lookup, so an
  // edit takes effect without a restart.
  readUserHost: () => string | null;
  now: () => number;
  log: (message: string) => void;
}

export interface DblpPool {
  search(query: string): Promise<any>;
}

// The health check is a real search. The Trier fault was in the search backend
// while its front page kept answering 200, so a HEAD request on the root would
// have picked the one host unable to serve a lookup. A host that answers its
// HTML error page under a 200 fails on the JSON parse, which is the intent.
async function checkHost(http: Http, host: string): Promise<string> {
  const data = await http.getJson(searchURL(host, "dblp", 1), CHECK_TIMEOUT_MS);
  if (!data.result) throw new Error(`${host} replied without a result block`);
  return host;
}

// Holds the session state: the chosen host, the hosts set aside, the shared health
// check and the pause. A batch costs one check and not one per item. A host that
// throws on a real query is set aside for the session. That is safe because the
// hosts serve the same index, so losing a healthy one costs nothing, while staying
// on a dead one costs every remaining item.
class DblpHostPool implements DblpPool {
  private host: string | null = null;
  private check: Promise<string> | null = null;
  private userHost: string | null = null;
  private pausedUntil = 0;
  private readonly failed = new Set<string>();

  constructor(private readonly deps: DblpDeps) {}

  async search(query: string): Promise<any> {
    for (;;) {
      const chosen = await this.resolveHost();
      try {
        return await this.deps.http.getJson(searchURL(chosen, query, 5));
      } catch (error) {
        this.strike(chosen, "failed", error);
        if (this.host === chosen) this.host = null;
      }
    }
  }

  private strike(host: string, why: string, error: unknown): void {
    this.deps.log(`Metadata Hunter: DBLP host ${host} ${why}: ${error}`);
    this.failed.add(host);
  }

  private async resolveHost(): Promise<string> {
    this.resetOnPreferenceChange();
    if (this.host) return this.host;
    if (this.deps.now() < this.pausedUntil) {
      throw new Error("DBLP is unreachable, waiting before the next attempt");
    }
    return this.check ?? this.startCheck();
  }

  private resetOnPreferenceChange(): void {
    const current = this.deps.readUserHost();
    if (current === this.userHost) return;
    this.userHost = current;
    this.host = null;
    this.check = null;
    this.failed.clear();
    this.pausedUntil = 0;
  }

  // The result of a check that no longer matches the settings is ignored, which
  // is the case when a preferences edit cleared `check` meanwhile.
  private startCheck(): Promise<string> {
    const running: Promise<string> = this.pickHost()
      .then((picked) => {
        if (this.check === running) this.host = picked;
        return picked;
      })
      .finally(() => {
        if (this.check === running) this.check = null;
      });
    this.check = running;
    return running;
  }

  // The user host and the default host are checked one at a time, so a working
  // one always wins. The public hosts are then raced and the first to reply is
  // kept, because any of them serves the same data.
  private async pickHost(): Promise<string> {
    const preferred = await this.firstHealthy(
      [...new Set([this.userHost, DEFAULT_HOST])].filter(
        (host): host is string => !!host,
      ),
    );
    if (preferred) return preferred;

    const remaining = PUBLIC_HOSTS.filter((host) => !this.failed.has(host));
    try {
      if (remaining.length > 0) {
        return await Promise.any(
          remaining.map((host) => checkHost(this.deps.http, host)),
        );
      }
    } catch (error) {
      this.deps.log(
        `Metadata Hunter: no DBLP host passed its health check: ${error}`,
      );
    }
    this.failed.clear();
    this.pausedUntil = this.deps.now() + RETRY_PAUSE_MS;
    throw new Error("no DBLP host is reachable");
  }

  private async firstHealthy(candidates: string[]): Promise<string | null> {
    for (const host of candidates.filter((c) => !this.failed.has(c))) {
      try {
        return await checkHost(this.deps.http, host);
      } catch (error) {
        this.strike(host, "failed its health check", error);
      }
    }
    return null;
  }
}

export const createDblpPool = (deps: DblpDeps): DblpPool =>
  new DblpHostPool(deps);

// `hit` is a single object when there is one result and an array otherwise.
function hitInfos(data: any): any[] {
  const raw = data.result?.hits?.hit;
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).map((hit) => hit.info);
}

const asList = (value: unknown): string[] =>
  value ? ((Array.isArray(value) ? value : [value]) as string[]) : [];

const doiFromUrl = (url: string): string | null =>
  url.match(/doi\.org\/(.+)$/)?.[1] ?? null;

function queryFor(item: ZoteroItem, title: string): string {
  const words = cleanTitleForQuery(title).replace(/\s+/g, " ").trim();
  const lastName = firstAuthorLastName(item);
  return lastName ? `${words} ${lastName}` : words;
}

export async function findDOI(
  pool: DblpPool,
  item: ZoteroItem,
  title: string,
): Promise<DOIResult | null> {
  const infos = hitInfos(await pool.search(queryFor(item, title)));
  for (const info of infos) {
    if (!info || !isTitleMatch(title, info.title)) continue;
    // The DOI field is the most reliable. Failing that, one is stripped from the
    // electronic edition URL.
    const doi = info.doi || doiFromUrl(asList(info.ee)[0] ?? "");
    if (doi) return { doi: doi as string, abstract: null };
  }
  return null;
}

// A DOI first, then one embedded in an ee URL, then the first non-arXiv venue
// URL (e.g. OpenReview, PMLR).
function refFromInfo(info: any): PublishedRef | null {
  if (info.doi && isPublishedDOI(info.doi)) return { doi: info.doi as string };
  const urls = asList(info.ee);
  for (const url of urls) {
    const doi = doiFromUrl(url);
    if (doi && isPublishedDOI(doi)) return { doi };
  }
  const venueUrl = urls.find((url) => !url.includes("arxiv.org"));
  return venueUrl ? { url: venueUrl } : null;
}

export async function findPublishedRef(
  pool: DblpPool,
  item: ZoteroItem,
  title: string,
): Promise<PublishedRef | null> {
  for (const info of hitInfos(await pool.search(queryFor(item, title)))) {
    if (!info || !isTitleMatch(title, info.title)) continue;
    if (!isPublishedVenue(info.venue ?? "")) continue;
    const ref = refFromInfo(info);
    if (ref) return ref;
  }
  return null;
}
