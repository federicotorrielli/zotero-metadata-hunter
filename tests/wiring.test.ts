// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realTranslate } from "./harness";

function setup() {
  const t = realTranslate();
  const ftl = {
    addResourceIds: vi.fn(),
    removeResourceIds: vi.fn(),
    formatValueSync: (id: string, args: any) =>
      t(id.replace("metadatahunter-", ""), args),
  };
  const registerMenu = vi.fn();
  const register = vi.fn();
  const insertFTLIfNeeded = vi.fn();
  (document as any).createXULElement = (tag: string) =>
    document.createElementNS("http://www.w3.org/1999/xhtml", tag);
  const toolbar = document.createElement("div");
  toolbar.id = "zotero-items-toolbar";
  document.body.append(toolbar);
  (window as any).MozXULElement = { insertFTLIfNeeded };

  (globalThis as any).Services = {
    prefs: {
      getIntPref: (_n: string, f: number) => f,
      getStringPref: (_n: string, f: string) => f,
    },
  };
  (globalThis as any).Zotero = {
    debug: vi.fn(),
    ftl,
    MenuManager: { registerMenu },
    PreferencePanes: { register },
    getMainWindows: () => [window],
    getMainWindow: () => window,
    getActiveZoteroPane: () => ({
      getSelectedItems: () => [],
      getCollectionTreeRows: () => [],
    }),
    HTTP: { request: vi.fn() },
  };
  return { ftl, registerMenu, register, insertFTLIfNeeded, toolbar };
}

describe("plugin lifecycle", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    document.body.innerHTML = "";
    delete (globalThis as any).Zotero;
    delete (globalThis as any).Services;
  });

  it("registers strings, menus and the preferences pane at startup", async () => {
    const env = setup();
    await import("../src/index");
    const plugin = (globalThis as any).Zotero.MetadataHunter;
    await plugin.startup({ id: "id@x", version: "1", rootURI: "rootURI://" });

    expect(env.ftl.addResourceIds).toHaveBeenCalledWith(["metadatahunter.ftl"]);
    expect(env.registerMenu).toHaveBeenCalledTimes(2);
    expect(env.registerMenu.mock.calls[0][0].pluginID).toBe("id@x");
    expect(env.register).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginID: "id@x",
        src: "rootURI://preferences.xhtml",
        scripts: ["rootURI://preferences.js"],
      }),
    );
    expect(env.insertFTLIfNeeded).toHaveBeenCalledWith("metadatahunter.ftl");
    expect(env.toolbar.querySelector("#metadatahunter-button")).not.toBeNull();
  });

  it("adds the window pieces once when a window is announced two times", async () => {
    const env = setup();
    await import("../src/index");
    const plugin = (globalThis as any).Zotero.MetadataHunter;
    await plugin.startup({ id: "id@x", version: "1", rootURI: "r://" });
    plugin.onMainWindowLoad(window);
    expect(env.toolbar.querySelectorAll("#metadatahunter-button")).toHaveLength(
      1,
    );
    expect(env.insertFTLIfNeeded).toHaveBeenCalledTimes(1);
  });

  it("starts a library run from a keyboard shortcut", async () => {
    setup();
    await import("../src/index");
    const plugin = (globalThis as any).Zotero.MetadataHunter;
    await plugin.startup({ id: "id@x", version: "1", rootURI: "r://" });
    expect(plugin.isProcessing).toBe(false);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "d",
        ctrlKey: true,
        altKey: true,
        cancelable: true,
      }),
    );
    await vi.waitFor(() => {
      const card = document.querySelector(".mh-card");
      expect(card?.textContent).toContain("There is nothing to do");
    });
  });

  it("removes the toolbar button from an unloaded window", async () => {
    const env = setup();
    await import("../src/index");
    const plugin = (globalThis as any).Zotero.MetadataHunter;
    await plugin.startup({ id: "id@x", version: "1", rootURI: "r://" });
    plugin.onMainWindowUnload(window);
    expect(env.toolbar.querySelector("#metadatahunter-button")).toBeNull();
  });

  it("removes the toolbar button and shortcuts at shutdown", async () => {
    const env = setup();
    await import("../src/index");
    const plugin = (globalThis as any).Zotero.MetadataHunter;
    await plugin.startup({ id: "id@x", version: "1", rootURI: "r://" });
    plugin.shutdown();
    expect(env.toolbar.querySelector("#metadatahunter-button")).toBeNull();
    const nothing = vi.spyOn(document, "createElementNS");
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "d", ctrlKey: true, altKey: true }),
    );
    expect(document.querySelector(".mh-card")).toBeNull();
    nothing.mockRestore();
  });

  it("releases its strings at shutdown", async () => {
    const env = setup();
    await import("../src/index");
    const plugin = (globalThis as any).Zotero.MetadataHunter;
    await plugin.startup({ id: "id@x", version: "1", rootURI: "r://" });
    plugin.shutdown();
    expect(env.ftl.removeResourceIds).toHaveBeenCalledWith([
      "metadatahunter.ftl",
    ]);
  });

  it("exposes the actions on the namespace for the console", async () => {
    setup();
    await import("../src/index");
    const plugin = (globalThis as any).Zotero.MetadataHunter;
    await plugin.startup({ id: "id@x", version: "1", rootURI: "r://" });
    for (const name of [
      "findDOIs",
      "findPublishedVersions",
      "enrichMetadata",
      "findDOIsForSelected",
    ]) {
      expect(typeof plugin[name]).toBe("function");
    }
  });
});
