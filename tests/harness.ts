import { readFileSync } from "node:fs";
import { FluentBundle, FluentResource } from "@fluent/bundle";
import { vi } from "vitest";
import { CancelToken } from "../src/core/cancel";
import type { Clock } from "../src/core/batch";
import type { FlowDeps } from "../src/flows/shared";
import type { Lookups } from "../src/sources/lookups";
import type { AttachmentState, ZoteroApi, ZoteroItem } from "../src/types";
import type { Translate } from "../src/utils/locale";
import { makeItem, typeName, TYPE_IDS, type FakeItem } from "./helpers";

const FTL = "addon/locale/en-US/metadatahunter.ftl";

// Translates through the real FTL file, so a test fails when a message id or a
// variable is wrong.
export function realTranslate(): Translate {
  const bundle = new FluentBundle("en-US", { useIsolating: false });
  bundle.addResource(new FluentResource(readFileSync(FTL, "utf8")));
  return (key, params) => {
    const message = bundle.getMessage(`metadatahunter-${key}`);
    if (!message?.value) throw new Error(`missing string ${key}`);
    const errors: Error[] = [];
    const text = bundle.formatPattern(message.value, params, errors);
    if (errors.length) throw new Error(`${key}: ${errors.map(String)}`);
    return text;
  };
}

export const instantClock = (): Clock => {
  let time = 0;
  return {
    now: () => time++,
    delay: async () => {},
    after: () => () => {},
  };
};

export interface FakeApi extends ZoteroApi {
  erased: number[];
  created: { kind: string; arg: string; collections: number[] }[];
  store: Map<number, ZoteroItem>;
  // The state answered for an attachment id. Unlisted ids are healthy.
  attachmentStates: Map<number, AttachmentState>;
  next: Record<"doi" | "url" | "bibtex", ZoteroItem | Error | null>;
}

export function fakeApi(): FakeApi {
  const api: FakeApi = {
    erased: [],
    created: [],
    store: new Map(),
    attachmentStates: new Map(),
    next: { doi: null, url: null, bibtex: null },
    itemTypeID: (name) => TYPE_IDS[name] ?? null,
    itemTypeName: typeName,
    isFieldValidForType: () => true,
    getItem: async (id) => api.store.get(id) ?? null,
    attachmentState: async (item) =>
      api.attachmentStates.get(item.id) ?? "healthy",
    eraseItem: async (id) => void api.erased.push(id),
    fromDOI: (doi, target) => answer("doi", doi, target.collections),
    fromURL: (url, target) => answer("url", url, target.collections),
    fromBibtex: (text, target) => answer("bibtex", text, target.collections),
  };
  async function answer(
    kind: "doi" | "url" | "bibtex",
    arg: string,
    collections: number[],
  ): Promise<ZoteroItem | null> {
    api.created.push({ kind, arg, collections });
    const value = api.next[kind];
    if (value instanceof Error) throw value;
    return value;
  }
  return api;
}

type Source<F> = { name: string; find: F };

export function emptyLookups(): Lookups {
  return {
    doiCascade: [],
    abstracts: [],
    published: [],
    publishedByArxivId: async () => null,
  };
}

export const doiSource = (
  name: string,
  result: ReturnType<typeof Object> | Error | null,
): Source<any> => ({
  name,
  find: vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  }),
});

export interface Harness {
  deps: FlowDeps;
  api: FakeApi;
  lookups: Lookups;
  panel: { update: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  logs: string[];
  cancel: CancelToken;
}

export function makeHarness(overrides: Partial<FlowDeps> = {}): Harness {
  const api = fakeApi();
  const lookups = emptyLookups();
  const panel = { update: vi.fn(), close: vi.fn() };
  const logs: string[] = [];
  const deps: FlowDeps = {
    api,
    lookups,
    clock: instantClock(),
    t: realTranslate(),
    log: (message) => void logs.push(message),
    batchSize: () => 2,
    createPanel: () => panel,
    ...overrides,
  };
  return { deps, api, lookups, panel, logs, cancel: new CancelToken() };
}

export { makeItem, TYPE_IDS, type FakeItem };
