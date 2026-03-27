import { config } from "../../package.json";
import { getString } from "../utils/locale";

declare const Zotero: any;

const itemMenuListeners = new WeakMap<Window, () => void>();

export function registerWindowMenus(win: Window) {
  const doc = (win as any).document;

  const toolsMenu = doc.getElementById("menu_ToolsPopup");
  if (toolsMenu) {
    if (!doc.getElementById(`${config.addonRef}-tools-menu`)) {
      const menuitem = doc.createXULElement("menuitem");
      menuitem.id = `${config.addonRef}-tools-menu`;
      menuitem.setAttribute("label", getString("menu.findDOILibrary"));
      menuitem.addEventListener("command", () =>
        Zotero.MetadataHunter.findDOIs(),
      );
      toolsMenu.appendChild(menuitem);
    }

    if (!doc.getElementById(`${config.addonRef}-tools-menu-preprint`)) {
      const menuitem = doc.createXULElement("menuitem");
      menuitem.id = `${config.addonRef}-tools-menu-preprint`;
      menuitem.setAttribute("label", getString("preprint.menu.library"));
      menuitem.addEventListener("command", () =>
        Zotero.MetadataHunter.findPublishedVersions(),
      );
      toolsMenu.appendChild(menuitem);
    }
  }

  const itemMenu = doc.getElementById("zotero-itemmenu");
  if (itemMenu) {
    let doiItem: any = doc.getElementById(`${config.addonRef}-item-menu`);
    if (!doiItem) {
      doiItem = doc.createXULElement("menuitem");
      doiItem.id = `${config.addonRef}-item-menu`;
      doiItem.setAttribute("label", getString("menu.findDOI"));
      doiItem.addEventListener("command", () =>
        Zotero.MetadataHunter.findDOIsForSelected(),
      );
      itemMenu.appendChild(doiItem);
    }

    let preprintItem: any = doc.getElementById(
      `${config.addonRef}-item-menu-preprint`,
    );
    if (!preprintItem) {
      preprintItem = doc.createXULElement("menuitem");
      preprintItem.id = `${config.addonRef}-item-menu-preprint`;
      preprintItem.setAttribute("label", getString("preprint.menu.selected"));
      preprintItem.addEventListener("command", () =>
        Zotero.MetadataHunter.findPublishedVersionsForSelected(),
      );
      itemMenu.appendChild(preprintItem);
    }

    const onShowing = () => {
      const ZP = Zotero.getActiveZoteroPane();
      const selected: any[] = ZP?.getSelectedItems() ?? [];
      doiItem.hidden = !selected.some((item: any) => item.isRegularItem());
      preprintItem.hidden = !selected.some((item: any) =>
        Zotero.MetadataHunter.isPreprint(item),
      );
    };
    itemMenu.addEventListener("popupshowing", onShowing);
    itemMenuListeners.set(win, onShowing);
  }
}

export function unregisterWindowMenus(win: Window) {
  const doc = (win as any).document;
  doc.getElementById(`${config.addonRef}-tools-menu`)?.remove();
  doc.getElementById(`${config.addonRef}-tools-menu-preprint`)?.remove();
  doc.getElementById(`${config.addonRef}-item-menu`)?.remove();
  doc.getElementById(`${config.addonRef}-item-menu-preprint`)?.remove();

  const listener = itemMenuListeners.get(win);
  if (listener) {
    doc
      .getElementById("zotero-itemmenu")
      ?.removeEventListener("popupshowing", listener);
    itemMenuListeners.delete(win);
  }
}
