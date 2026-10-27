import { describe, expect, it } from "vitest";
import {
  calculateSimilarity,
  cleanTitleForQuery,
  isTitleMatch,
  levenshteinDistance,
} from "../src/match/title";

describe("isTitleMatch", () => {
  it("ignores case and punctuation", () => {
    expect(isTitleMatch("BERT: Pre-Training!", "bert pre training")).toBe(true);
  });

  it("keeps non-ASCII letters", () => {
    expect(isTitleMatch("Über die Maschine", "über die maschine")).toBe(true);
    expect(isTitleMatch("Über die Maschine", "Uber die Maschine")).toBe(true);
    expect(isTitleMatch("Müller on Ärzte", "Muller on Arzte")).toBe(true);
  });

  it("rejects a short title inside a long one", () => {
    expect(
      isTitleMatch(
        "Large Language Models",
        "A Watermark for Large Language Models",
      ),
    ).toBe(false);
  });

  it("accepts a title with one small edit", () => {
    expect(
      isTitleMatch(
        "Attention is all you need for sequence models",
        "Attention is all you need for sequence model",
      ),
    ).toBe(true);
  });

  it("rejects empty input", () => {
    expect(isTitleMatch("", "anything")).toBe(false);
    expect(isTitleMatch("anything", "")).toBe(false);
  });
});

describe("levenshteinDistance", () => {
  it.each([
    ["kitten", "mitten", 1],
    ["", "abc", 3],
    ["abc", "", 3],
    ["same", "same", 0],
  ])("%s vs %s is %i", (a, b, expected) => {
    expect(levenshteinDistance(a, b)).toBe(expected);
  });

  it("is symmetric", () => {
    expect(levenshteinDistance("flaw", "lawn")).toBe(
      levenshteinDistance("lawn", "flaw"),
    );
  });

  it("gives similarity 1 for two empty strings", () => {
    expect(calculateSimilarity("", "")).toBe(1);
  });
});

describe("cleanTitleForQuery", () => {
  it("keeps the subtitle of a short main title", () => {
    expect(cleanTitleForQuery("BERT: Pre-training of deep transformers")).toBe(
      "BERT: Pre-training of deep transformers",
    );
  });

  it("removes the subtitle of a main title with four words", () => {
    expect(cleanTitleForQuery("Scaling laws for neural models: a survey")).toBe(
      "Scaling laws for neural models",
    );
  });

  it("replaces entities", () => {
    expect(cleanTitleForQuery("Q&amp;A &lt;systems&gt;")).toBe("Q&A <systems>");
  });

  it("truncates at a word boundary", () => {
    const long = "word ".repeat(40).trim();
    const cleaned = cleanTitleForQuery(long);
    expect(cleaned.length).toBeLessThanOrEqual(100);
    expect(cleaned.endsWith("word")).toBe(true);
  });
});
