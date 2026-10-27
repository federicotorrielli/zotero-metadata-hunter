// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunController } from "../src/core/cancel";
import { runAction, type Action } from "../src/flows/action";
import { newStats, type RunStats } from "../src/flows/shared";
import {
  libraryEntries,
  registerMenus,
  type MenuActions,
} from "../src/modules/menu";
import { createCardHost } from "../src/modules/progress";
import { installShortcuts } from "../src/modules/shortcuts";
import {
  setupWindowToolbar,
  syncToolbarButton,
  teardownWindowToolbar,
  type ToolbarDeps,
} from "../src/modules/toolbar";
import { realTranslate } from "./harness";
import { makeItem } from "./helpers";

const actions = (): MenuActions => ({
  findDOIs: vi.fn(),
  findPublishedVersions: vi.fn(),
  enrichMetadata: vi.fn(),
  findDOIsForSelected: vi.fn(),
  findPublishedVersionsForSelected: vi.fn(),
  enrichMetadataForSelected: vi.fn(),
});

describe("registerMenus", () => {
  function register() {
    const registered: any[] = [];
    const a = actions();
    registerMenus({ registerMenu: (o: any) => registered.push(o) }, "id@x", a);
    return { registered, a };
  }

  it("registers the Tools menu and the item context menu for the plugin", () => {
    const { registered } = register();
    expect(registered.map((r) => [r.menuID, r.target, r.pluginID])).toEqual([
      ["metadatahunter-tools", "main/menubar/tools", "id@x"],
      ["metadatahunter-item", "main/library/item", "id@x"],
    ]);
    expect(registered.every((r) => r.menus.length === 3)).toBe(true);
  });

  it("labels each entry by Fluent id and gives it a Zotero icon", () => {
    const { registered } = register();
    const first = registered[0].menus[0];
    expect(first.l10nID).toBe("metadatahunter-menu-find-doi-library");
    expect(first.icon).toMatch(/^chrome:\/\/zotero\/skin\/16\/universal\//);
    expect(first.menuType).toBe("menuitem");
  });

  it("runs the library action from the Tools menu", () => {
    const { registered, a } = register();
    registered[0].menus.forEach((m: any) => m.onCommand());
    expect(a.findDOIs).toHaveBeenCalledTimes(1);
    expect(a.findPublishedVersions).toHaveBeenCalledTimes(1);
    expect(a.enrichMetadata).toHaveBeenCalledTimes(1);
  });

  it("shows an item entry only when it applies to a selected item", () => {
    const { registered } = register();
    const [doi, preprint, enrich] = registered[1].menus;
    const items = [makeItem({ itemType: "journalArticle" })];
    for (const [entry, visible] of [
      [doi, true],
      [preprint, false],
      [enrich, true],
    ] as const) {
      const context = { items, setVisible: vi.fn() };
      entry.onShowing(new Event("popupshowing"), context);
      expect(context.setVisible).toHaveBeenCalledWith(visible);
    }
  });

  it("hides the DOI entry for an item that has a DOI and an abstract", () => {
    const { registered } = register();
    const complete = makeItem({
      fields: { DOI: "10.1/x", abstractNote: "Done." },
    });
    const missing = makeItem({ fields: { DOI: "10.1/x" } });
    const hidden = { items: [complete], setVisible: vi.fn() };
    const shown = { items: [complete, missing], setVisible: vi.fn() };
    registered[1].menus[0].onShowing(new Event("x"), hidden);
    registered[1].menus[0].onShowing(new Event("x"), shown);
    expect(hidden.setVisible).toHaveBeenCalledWith(false);
    expect(shown.setVisible).toHaveBeenCalledWith(true);
  });

  it("hides the DOI entry when only attachments are selected", () => {
    const { registered } = register();
    const context = {
      items: [makeItem({ regular: false })],
      setVisible: vi.fn(),
    };
    registered[1].menus[0].onShowing(new Event("x"), context);
    expect(context.setVisible).toHaveBeenCalledWith(false);
  });

  it("shares one list of library entries with the toolbar", () => {
    const entries = libraryEntries(actions());
    expect(entries.map((e) => e.l10nKey)).toEqual([
      "menu-find-doi-library",
      "menu-preprint-library",
      "menu-enrich-library",
    ]);
  });
});

describe("toolbar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    delete (globalThis as any).Zotero;
  });

  // Gives jsdom the two XUL calls the code makes.
  function xulWindow() {
    (document as any).createXULElement = (tag: string) =>
      document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    const toolbar = document.createElement("div");
    toolbar.id = "zotero-items-toolbar";
    const anchor = document.createElement("button");
    anchor.id = "zotero-tb-lookup";
    const after = document.createElement("button");
    after.id = "after";
    toolbar.append(anchor, after);
    document.body.append(toolbar);
    const t = realTranslate();
    (globalThis as any).Zotero = {
      ftl: {
        formatValueSync: (id: string, args: any) =>
          t(id.replace("metadatahunter-", ""), args),
      },
    };
    return { win: { document } as unknown as Window, toolbar };
  }

  function deps(processing = false): ToolbarDeps & {
    run: any;
    setProcessing(value: boolean): void;
  } {
    const run = vi.fn();
    let current = processing;
    return {
      run,
      t: realTranslate(),
      entries: libraryEntries(actions()).map((e) => ({ ...e, run })),
      isProcessing: () => current,
      setProcessing: (value) => void (current = value),
      stop: vi.fn(),
    };
  }

  it("adds one dropdown button right after the lookup button", () => {
    const { win, toolbar } = xulWindow();
    const d = deps();
    setupWindowToolbar(win, d);
    setupWindowToolbar(win, d);
    const buttons = toolbar.querySelectorAll("#metadatahunter-button");
    expect(buttons).toHaveLength(1);
    expect(toolbar.children[1].id).toBe("metadatahunter-button");
    expect(buttons[0].getAttribute("type")).toBe("menu");
    expect(buttons[0].getAttribute("title")).toBe(
      "Find DOIs, published versions of preprints, and richer metadata",
    );
  });

  it("lists the three actions each time the menu opens", () => {
    const { win } = xulWindow();
    const d = deps();
    setupWindowToolbar(win, d);
    const popup = document.querySelector("menupopup")!;
    popup.dispatchEvent(new Event("popupshowing"));
    popup.dispatchEvent(new Event("popupshowing"));
    const items = [...popup.querySelectorAll("menuitem")];
    expect(items.map((i) => i.getAttribute("data-l10n-id"))).toEqual([
      "metadatahunter-menu-find-doi-library",
      "metadatahunter-menu-preprint-library",
      "metadatahunter-menu-enrich-library",
    ]);
    items[1].dispatchEvent(new Event("command"));
    expect(d.run).toHaveBeenCalledTimes(1);
  });

  it("offers only Stop during a run", () => {
    const { win } = xulWindow();
    const d = deps(true);
    setupWindowToolbar(win, d);
    const popup = document.querySelector("menupopup")!;
    popup.dispatchEvent(new Event("popupshowing"));
    const items = popup.querySelectorAll("menuitem");
    expect(items).toHaveLength(1);
    expect(items[0].getAttribute("label")).toBe("Stop");
    items[0].dispatchEvent(new Event("command"));
    expect(d.stop).toHaveBeenCalled();
  });

  it("follows the run state in its label and removes cleanly", () => {
    const { win } = xulWindow();
    const d = deps();
    setupWindowToolbar(win, d);
    const button = document.getElementById("metadatahunter-button")!;
    expect(button.getAttribute("label")).toBe("Metadata Hunter");
    d.setProcessing(true);
    syncToolbarButton(win, d);
    expect(button.getAttribute("label")).toBe("Stop");
    expect(button.getAttribute("title")).toBe("Stop the run in progress");
    teardownWindowToolbar(win);
    expect(document.getElementById("metadatahunter-button")).toBeNull();
  });

  it("falls back to the toolbar when the anchor is missing", () => {
    const { win, toolbar } = xulWindow();
    toolbar.querySelector("#zotero-tb-lookup")!.remove();
    setupWindowToolbar(win, deps());
    expect(toolbar.lastElementChild?.id).toBe("metadatahunter-button");
  });
});

describe("installShortcuts", () => {
  const key = (init: KeyboardEventInit) =>
    new KeyboardEvent("keydown", { cancelable: true, ...init });

  it("runs the binding for Ctrl+Alt+letter and blocks the default", () => {
    const run = vi.fn();
    installShortcuts(window, { d: run });
    const event = key({ key: "D", ctrlKey: true, altKey: true });
    window.dispatchEvent(event);
    expect(run).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("accepts Cmd on macOS", () => {
    const run = vi.fn();
    const remove = installShortcuts(window, { p: run });
    window.dispatchEvent(key({ key: "p", metaKey: true, altKey: true }));
    expect(run).toHaveBeenCalledTimes(1);
    remove();
  });

  it("ignores other keys and missing modifiers, and can be removed", () => {
    const run = vi.fn();
    const remove = installShortcuts(window, { m: run });
    window.dispatchEvent(key({ key: "m", ctrlKey: true }));
    window.dispatchEvent(key({ key: "x", ctrlKey: true, altKey: true }));
    expect(run).not.toHaveBeenCalled();
    remove();
    window.dispatchEvent(key({ key: "m", ctrlKey: true, altKey: true }));
    expect(run).not.toHaveBeenCalled();
  });
});

describe("runAction", () => {
  const t = realTranslate();
  function setup(over: Partial<Action<RunStats>> = {}) {
    const showResult = vi.fn();
    const controller = new RunController(() => {});
    const action: Action<RunStats> = {
      titleKey: "find-doi-title",
      emptyKey: "find-doi-all-have-data",
      select: (items) => items,
      process: vi.fn(async () => ({ ...newStats(), processed: 1 })),
      message: () => "done",
      ...over,
    };
    return {
      showResult,
      controller,
      action,
      deps: { controller, t, showResult, log: vi.fn() },
    };
  }

  it("reports that there is nothing to do when nothing is selected", async () => {
    const { deps, action, showResult } = setup({ select: () => [] });
    await runAction(deps, action, async () => [makeItem()]);
    expect(showResult).toHaveBeenCalledWith(
      "Find DOIs and Abstracts",
      "Every item already has a DOI and an abstract. There is nothing to do.",
      false,
    );
    expect(action.process).not.toHaveBeenCalled();
  });

  it("shows the result and flags a run that needs attention", async () => {
    const { deps, action, showResult } = setup({
      process: async () => ({ ...newStats(), processed: 1, skipped: 1 }),
    });
    await runAction(deps, action, async () => [makeItem()]);
    expect(showResult).toHaveBeenCalledWith(
      "Find DOIs and Abstracts",
      "done",
      true,
    );
  });

  it("shows an error card when the run throws, and lets the next run start", async () => {
    const { deps, action, controller, showResult } = setup({
      process: async () => {
        throw new Error("translator crashed");
      },
    });
    await runAction(deps, action, async () => [makeItem()]);
    expect(showResult).toHaveBeenCalledWith(
      "Find DOIs and Abstracts",
      "The run stopped because of an error: Error: translator crashed",
      true,
    );
    expect(controller.isProcessing).toBe(false);
  });

  it("shows an error card when the items cannot be read", async () => {
    const { deps, action, showResult } = setup();
    await runAction(deps, action, async () => {
      throw new Error("no pane");
    });
    expect(showResult.mock.calls[0][2]).toBe(true);
    expect(action.process).not.toHaveBeenCalled();
  });

  it("does nothing while another run is active", async () => {
    const { deps, action, controller, showResult } = setup();
    let release!: () => void;
    const first = controller.run(() => new Promise<void>((r) => (release = r)));
    await runAction(deps, action, async () => [makeItem()]);
    expect(showResult).not.toHaveBeenCalled();
    release();
    await first;
  });
});

describe("card host", () => {
  const host = (win: any) => createCardHost(() => win, "Dismiss");

  it("mounts a progress card, updates it and removes it", () => {
    const panel = host(window).createProgressPanel("Title", "Hint");
    const card = document.querySelector(".mh-card")!;
    expect(card.textContent).toContain("Hint");
    panel.update(40, "Item 2 of 5");
    expect(
      (document.querySelector(".mh-progress-fill") as HTMLElement).style.width,
    ).toBe("40%");
    expect(card.textContent).toContain("Item 2 of 5");
    expect(card.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Dismiss",
    );
    panel.close();
    expect(document.querySelector(".mh-card")).toBeNull();
  });

  it("replaces the progress card with a result card and marks errors", () => {
    const cards = host(window);
    cards.createProgressPanel("Title", "Hint");
    cards.showResult("Done", "All fine");
    expect(document.querySelectorAll(".mh-card")).toHaveLength(1);
    expect(document.querySelector(".mh-card")?.getAttribute("role")).toBe(
      "status",
    );
    cards.showResult("Done", "Trouble", true);
    expect(document.querySelector(".mh-card")?.getAttribute("role")).toBe(
      "alert",
    );
  });

  it("does nothing without a window", () => {
    const cards = host(null);
    expect(() =>
      cards.createProgressPanel("T", "H").update(1, "x"),
    ).not.toThrow();
    expect(() => cards.showResult("T", "M")).not.toThrow();
  });
});
