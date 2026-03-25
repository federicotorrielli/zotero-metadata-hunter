import { config } from "../../package.json";
import { getString } from "../utils/locale";

declare const Zotero: any;

const itemMenuListeners = new WeakMap<Window, () => void>();

export function registerWindowMenus(win: Window) {
  const doc = (win as any).document;

  const toolsMenu = doc.getElementById("menu_ToolsPopup");
  if (toolsMenu && !doc.getElementById(`${config.addonRef}-tools-menu`)) {
    const menuitem = doc.createXULElement("menuitem");
    menuitem.id = `${config.addonRef}-tools-menu`;
    menuitem.setAttribute("label", getString("menu.findDOILibrary"));
    menuitem.addEventListener("command", () => Zotero.DOIFinder.findDOIs());
    toolsMenu.appendChild(menuitem);
  }

  const itemMenu = doc.getElementById("zotero-itemmenu");
  if (itemMenu && !doc.getElementById(`${config.addonRef}-item-menu`)) {
    const menuitem = doc.createXULElement("menuitem");
    menuitem.id = `${config.addonRef}-item-menu`;
    menuitem.setAttribute("label", getString("menu.findDOI"));
    menuitem.addEventListener("command", () => Zotero.DOIFinder.findDOIsForSelected());

    // Show the item only when at least one regular (non-note, non-attachment) item is selected
    const onShowing = () => {
      const ZP = Zotero.getActiveZoteroPane();
      const selected: any[] = ZP?.getSelectedItems() ?? [];
      menuitem.hidden = !selected.some((item: any) => item.isRegularItem());
    };
    itemMenu.addEventListener("popupshowing", onShowing);
    itemMenuListeners.set(win, onShowing);

    itemMenu.appendChild(menuitem);
  }
}

export function unregisterWindowMenus(win: Window) {
  const doc = (win as any).document;
  doc.getElementById(`${config.addonRef}-tools-menu`)?.remove();
  doc.getElementById(`${config.addonRef}-item-menu`)?.remove();

  const listener = itemMenuListeners.get(win);
  if (listener) {
    doc.getElementById("zotero-itemmenu")?.removeEventListener("popupshowing", listener);
    itemMenuListeners.delete(win);
  }
}
