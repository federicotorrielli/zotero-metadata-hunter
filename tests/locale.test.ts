import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@fluent/syntax";
import { describe, expect, it } from "vitest";
import { formatString, l10nID } from "../src/utils/locale";
import { realTranslate } from "./harness";

const FTL = readFileSync("addon/locale/en-US/metadatahunter.ftl", "utf8");
const messages = parse(FTL, {}).body.filter(
  (e) => e.type === "Message",
) as any[];
const ids = messages.map((m) => m.id.name.replace(/^metadatahunter-/, ""));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : [path];
  });
}
const code = [...sources("src"), "addon/preferences.xhtml"]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

describe("formatString", () => {
  const ftl = (text: string | null) => ({
    formatValueSync: () => text,
    addResourceIds: () => {},
    removeResourceIds: () => {},
  });

  it("strips bidi isolation marks", () => {
    expect(formatString(ftl("Added ⁨2⁩ items"), "k")).toBe("Added 2 items");
  });

  it("falls back to the key when the id is missing", () => {
    expect(formatString(ftl(null), "missing-key")).toBe("missing-key");
  });

  it("prefixes ids with the addon reference", () => {
    expect(l10nID("find-doi-found")).toBe("metadatahunter-find-doi-found");
  });
});

describe("the FTL file", () => {
  it("has no junk entries", () => {
    const junk = parse(FTL, {}).body.filter((e) => e.type === "Junk");
    expect(junk).toEqual([]);
  });

  it("prefixes every message", () => {
    expect(messages.every((m) => m.id.name.startsWith("metadatahunter-"))).toBe(
      true,
    );
  });

  it("has no message that nothing uses", () => {
    const unused = ids.filter(
      (id) =>
        !code.includes(`"${id}"`) && !code.includes(`metadatahunter-${id}`),
    );
    expect(unused).toEqual([]);
  });

  it("has every id the code asks for", () => {
    const requested = [
      ...code.matchAll(/(?:t|tail\(t|getString)\(\s*"([a-z0-9-]+)"/g),
    ].map((m) => m[1]);
    const keys = [
      ...code.matchAll(/(?:Key|key|ids?)\w*:\s*"([a-z0-9-]+)"/g),
    ].map((m) => m[1]);
    const missing = [...new Set([...requested, ...keys])].filter(
      (id) =>
        /-/.test(id) &&
        !ids.includes(id) &&
        /^(find|preprint|enrich|common|toolbar|menu|eta|card|prefs)-/.test(id),
    );
    expect(missing).toEqual([]);
  });

  it("writes plurals for one and many", () => {
    const t = realTranslate();
    expect(t("find-doi-none-found", { total: 1 })).toBe(
      "Checked 1 item. No new DOIs or abstracts were found.",
    );
    expect(t("find-doi-none-found", { total: 3 })).toBe(
      "Checked 3 items. No new DOIs or abstracts were found.",
    );
    expect(t("common-skipped-preprints", { count: 1 })).toContain(
      "It was left untagged",
    );
    expect(t("common-skipped-preprints", { count: 2 })).toContain(
      "They were left untagged",
    );
    expect(t("eta-minutes", { count: 1 })).toBe("About 1 minute left.");
  });

  it("renders every message with only the variables it names", () => {
    const t = realTranslate();
    for (const message of messages) {
      if (!message.value) continue;
      const source = FTL.slice(message.span.start, message.span.end);
      const names = [...source.matchAll(/\$(\w+)/g)].map((m) => m[1]);
      const args = Object.fromEntries(names.map((name) => [name, 2]));
      const id = message.id.name.replace(/^metadatahunter-/, "");
      expect(() => t(id, args), id).not.toThrow();
    }
  });

  it("keeps the house style: no em dashes", () => {
    expect(FTL).not.toContain("—");
  });
});

describe("preferences pane", () => {
  const pane = readFileSync("addon/preferences.xhtml", "utf8");

  it("only uses ids the FTL file defines", () => {
    const used = [
      ...pane.matchAll(/data-l10n-id="metadatahunter-([\w-]+)"/g),
    ].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((id) => !ids.includes(id))).toEqual([]);
  });

  it("loads the same FTL file as the code", () => {
    expect(pane).toContain('href="metadatahunter.ftl"');
  });
});
