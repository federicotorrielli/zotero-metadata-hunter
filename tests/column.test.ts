import { describe, expect, it, vi } from "vitest";
import { abstractMark, registerAbstractColumn } from "../src/modules/column";
import { makeItem } from "./helpers";

describe("abstract column", () => {
  it("marks a regular item that has an abstract", () => {
    expect(abstractMark(makeItem({ fields: { abstractNote: "Text." } }))).toBe(
      "✓",
    );
  });

  it("leaves an empty or blank abstract and a non regular item unmarked", () => {
    expect(abstractMark(makeItem())).toBe("");
    expect(abstractMark(makeItem({ fields: { abstractNote: " \n" } }))).toBe(
      "",
    );
    const note = makeItem({ regular: false, fields: { abstractNote: "x" } });
    expect(abstractMark(note)).toBe("");
  });

  it("registers one column owned by the plugin", () => {
    const registerColumn = vi.fn(() => "key");
    registerAbstractColumn({ registerColumn }, "plugin@id", "Abstract?");
    expect(registerColumn).toHaveBeenCalledWith({
      dataKey: "hasAbstract",
      label: "Abstract?",
      pluginID: "plugin@id",
      dataProvider: abstractMark,
      zoteroPersist: ["width"],
    });
  });
});
