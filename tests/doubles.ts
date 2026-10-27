import { vi } from "vitest";
import type { Http } from "../src/net/http";
import type { SourceDeps } from "../src/sources/deps";

type Route = unknown | ((url: string) => unknown);

// An Http whose answers come from a URL-substring table. A route may be a JSON
// value, a string (XML), null (a 404 for optional calls), or a function that
// returns one of those or throws.
export function fakeHttp(routes: Record<string, Route>): Http & {
  urls: string[];
} {
  const urls: string[] = [];
  const answer = (url: string): unknown => {
    urls.push(url);
    const key = Object.keys(routes).find((fragment) => url.includes(fragment));
    if (key === undefined) throw new Error(`no route for ${url}`);
    const route = routes[key];
    return typeof route === "function" ? route(url) : route;
  };
  return {
    urls,
    get: async (url) => ({ status: 200, responseText: String(answer(url)) }),
    getJson: async (url) => {
      const value = answer(url);
      if (value === null) throw new Error("unexpected null");
      return typeof value === "string" ? JSON.parse(value) : value;
    },
    getOptionalJson: async (url) => {
      const value = answer(url);
      return typeof value === "string" ? JSON.parse(value) : value;
    },
  };
}

export const parseXml = (text: string): Document =>
  new DOMParser().parseFromString(text, "text/xml");

export const sourceDeps = (routes: Record<string, Route>): SourceDeps => ({
  http: fakeHttp(routes),
  parseXml,
});

export const noop = vi.fn();
