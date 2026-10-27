import { config } from "../../package.json";
import { ICONS } from "../utils/icons";
import { l10nID, type Translate } from "../utils/locale";
import type { LibraryEntry } from "./menu";

const BUTTON_ID = `${config.addonRef}-button`;

export interface ToolbarDeps {
  t: Translate;
  entries: LibraryEntry[];
  isProcessing(): boolean;
  stop(): void;
}

function createMenuItem(doc: any, entry: LibraryEntry): any {
  const item = doc.createXULElement("menuitem");
  item.className = "menuitem-iconic";
  item.setAttribute("data-l10n-id", l10nID(entry.l10nKey));
  item.setAttribute("image", entry.icon);
  item.addEventListener("command", entry.run);
  return item;
}

function createStopItem(doc: any, deps: ToolbarDeps): any {
  const item = doc.createXULElement("menuitem");
  item.setAttribute("label", deps.t("toolbar-cancel"));
  item.addEventListener("command", deps.stop);
  return item;
}

// While a run is active the only useful action is to stop it.
function createMenu(doc: any, deps: ToolbarDeps): any {
  const popup = doc.createXULElement("menupopup");
  popup.addEventListener("popupshowing", () => {
    popup.replaceChildren(
      ...(deps.isProcessing()
        ? [createStopItem(doc, deps)]
        : deps.entries.map((entry) => createMenuItem(doc, entry))),
    );
  });
  return popup;
}

function createButton(doc: any, deps: ToolbarDeps): any {
  const btn = doc.createXULElement("toolbarbutton");
  btn.id = BUTTON_ID;
  btn.className = "zotero-tb-button";
  // Zotero draws every toolbar icon at 20x20, so the toolbar uses the 20px set.
  btn.setAttribute("image", ICONS.toolbar);
  // Zotero colours toolbar icons through -moz-context-properties, which its
  // generic `toolbarbutton` rule already enables. The matching
  // `fill: currentColor` is applied per built-in button id, so our button has
  // to set it itself. Without it the icon paints black and vanishes into a
  // dark toolbar.
  btn.style.fill = "currentColor";
  btn.setAttribute("type", "menu");
  btn.setAttribute("wantdropmarker", "true");
  btn.appendChild(createMenu(doc, deps));
  return btn;
}

// The button is placed after "Add Item by Identifier", the closest built-in
// action. It previously anchored to "zotero-tb-advanced-search", an element
// that does not exist in Zotero 10, so the button never rendered.
// The toolbar itself is the fallback in case the anchor is removed later.
function insertButton(doc: any, btn: any): void {
  const anchor = doc.getElementById("zotero-tb-lookup");
  if (anchor?.parentElement) {
    anchor.parentElement.insertBefore(btn, anchor.nextSibling);
  } else {
    doc.getElementById("zotero-items-toolbar")?.appendChild(btn);
  }
}

export function setupWindowToolbar(win: Window, deps: ToolbarDeps): void {
  const doc = (win as any).document;
  if (doc.getElementById(BUTTON_ID)) return;
  insertButton(doc, createButton(doc, deps));
  syncToolbarButton(win, deps);
}

export function teardownWindowToolbar(win: Window): void {
  (win as any).document.getElementById(BUTTON_ID)?.remove();
}

export function syncToolbarButton(win: Window, deps: ToolbarDeps): void {
  const btn = (win as any).document.getElementById(BUTTON_ID);
  if (!btn) return;
  const processing = deps.isProcessing();
  btn.setAttribute(
    "title",
    deps.t(processing ? "toolbar-cancel-tooltip" : "toolbar-tooltip"),
  );
  btn.setAttribute(
    "label",
    deps.t(processing ? "toolbar-cancel" : "toolbar-label"),
  );
}
