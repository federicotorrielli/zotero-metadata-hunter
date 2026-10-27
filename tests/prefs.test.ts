import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BATCH_PREF,
  DBLP_HOST_PREF,
  DEFAULT_BATCH,
  MAX_BATCH,
  MIN_BATCH,
  normalizeHost,
  readBatchSize,
  readUserDblpHost,
  type Prefs,
} from "../src/prefs";

const prefsWith = (values: Record<string, unknown>): Prefs => ({
  getInt: (name, fallback) => (values[name] as number) ?? fallback,
  getString: (name, fallback) => (values[name] as string) ?? fallback,
});

const throwing: Prefs = {
  getInt: () => {
    throw new Error("no prefs");
  },
  getString: () => {
    throw new Error("no prefs");
  },
};

describe("readBatchSize", () => {
  it("defaults, clamps and survives an unreadable preference", () => {
    expect(readBatchSize(prefsWith({}))).toBe(DEFAULT_BATCH);
    expect(readBatchSize(prefsWith({ [BATCH_PREF]: 99 }))).toBe(MAX_BATCH);
    expect(readBatchSize(prefsWith({ [BATCH_PREF]: -4 }))).toBe(MIN_BATCH);
    expect(readBatchSize(prefsWith({ [BATCH_PREF]: 5 }))).toBe(5);
    expect(readBatchSize(throwing)).toBe(DEFAULT_BATCH);
  });
});

describe("DBLP host preference", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["dblp.example.org", "https://dblp.example.org"],
    ["dblp.example.org/", "https://dblp.example.org"],
    ["http://localhost:8080//", "http://localhost:8080"],
    ["  HTTPS://dblp.example.org  ", "HTTPS://dblp.example.org"],
  ])("normalizes %j", (raw, expected) => {
    expect(normalizeHost(raw)).toBe(expected);
  });

  it("reads through the preference store and survives an error", () => {
    expect(readUserDblpHost(prefsWith({ [DBLP_HOST_PREF]: "a.org/" }))).toBe(
      "https://a.org",
    );
    expect(readUserDblpHost(throwing)).toBeNull();
  });
});

// addon/preferences.js is plain script that the bundle does not include, so its
// copies of these values are checked here.
describe("preferences.js parity", () => {
  const script = readFileSync("addon/preferences.js", "utf8");
  const read = (name: string) =>
    script.match(new RegExp(`const ${name} = ([^;]+);`))?.[1].replace(/"/g, "");

  it("uses the same names and bounds", () => {
    expect(read("BATCH_PREF")).toBe(BATCH_PREF);
    expect(read("DBLP_HOST_PREF")).toBe(DBLP_HOST_PREF);
    expect(Number(read("DEFAULT"))).toBe(DEFAULT_BATCH);
    expect(Number(read("MIN"))).toBe(MIN_BATCH);
    expect(Number(read("MAX"))).toBe(MAX_BATCH);
  });
});
