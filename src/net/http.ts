import type { Clock } from "../core/batch";
import { withTimeout } from "./tally";

export interface HttpResponse {
  status: number;
  responseText: string;
}

type Request = (
  method: string,
  url: string,
  options: Record<string, unknown>,
) => Promise<HttpResponse>;

export interface HttpDeps {
  request: Request;
  userAgent: string;
  clock: Pick<Clock, "after">;
}

export interface RequestOptions {
  timeoutMs?: number;
  // Added to the User-Agent, e.g. an API key.
  headers?: Record<string, string>;
}

export interface Http {
  get(url: string, options?: RequestOptions): Promise<HttpResponse>;
  getJson(url: string, options?: RequestOptions): Promise<any>;
  getOptionalJson(url: string, options?: RequestOptions): Promise<any | null>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

// Every request the plugin makes goes through here.
//
// errorDelayMax: 0 switches off Zotero's own 429 and 5xx retry. That retry backs
// off for up to an hour by default, far beyond the timeout, so leaving it on
// meant a throttled request was killed by our own timeout and then reported as
// "nothing found". Seeing the failure at once lets the caller tell a rate limit
// from a paper that genuinely has no DOI.
//
// CrossRef routes requests that carry a contact into its "polite pool", which
// has much higher rate limits than the anonymous one. The other APIs ignore the
// extra text.
export function createHttp({ request, userAgent, clock }: HttpDeps): Http {
  const send = (
    url: string,
    { timeoutMs = DEFAULT_TIMEOUT_MS, headers }: RequestOptions = {},
    successCodes?: number[],
  ) =>
    withTimeout(
      request("GET", url, {
        headers: { "User-Agent": userAgent, ...headers },
        errorDelayMax: 0,
        ...(successCodes && { successCodes }),
      }),
      timeoutMs,
      clock,
    );

  return {
    get: (url, options) => send(url, options),

    async getJson(url, options) {
      return JSON.parse((await send(url, options)).responseText);
    },

    // For endpoints whose 404 means "no such record" and not "I could not
    // answer". Semantic Scholar answers 404 {"error":"Title match not found"}
    // for an unmatched title, and both it and OpenAlex answer 404 for a DOI they
    // do not hold. Counting those as failures would suppress the "no DOI" tag
    // for every paper a source simply does not know. Resolves to null on 404.
    async getOptionalJson(url, options) {
      const response = await send(url, options, [200, 404]);
      return response.status === 404 ? null : JSON.parse(response.responseText);
    },
  };
}
