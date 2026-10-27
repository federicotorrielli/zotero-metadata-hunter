import { config } from "../../package.json";
import {
  isEnrichable,
  isPreprint,
  lacksDOIOrAbstract,
} from "../domain/preprint";
import { ICONS } from "../utils/icons";
import { l10nID } from "../utils/locale";

export interface MenuActions {
  findDOIs(): void;
  findPublishedVersions(): void;
  enrichMetadata(): void;
  findDOIsForSelected(): void;
  findPublishedVersionsForSelected(): void;
  enrichMetadataForSelected(): void;
}

// One library-wide action, shared by the Tools menu and the toolbar dropdown.
export interface LibraryEntry {
  l10nKey: string;
  icon: string;
  run: () => void;
}

export function libraryEntries(actions: MenuActions): LibraryEntry[] {
  return [
    {
      l10nKey: "menu-find-doi-library",
      icon: ICONS.findDOI,
      run: () => actions.findDOIs(),
    },
    {
      l10nKey: "menu-preprint-library",
      icon: ICONS.findPublished,
      run: () => actions.findPublishedVersions(),
    },
    {
      l10nKey: "menu-enrich-library",
      icon: ICONS.enrich,
      run: () => actions.enrichMetadata(),
    },
  ];
}

// A right-click entry shows only when `appliesTo` is true for a selected item.
interface SelectionEntry extends LibraryEntry {
  appliesTo: (item: any) => boolean;
}

function selectionEntries(actions: MenuActions): SelectionEntry[] {
  return [
    {
      l10nKey: "menu-find-doi",
      icon: ICONS.findDOI,
      run: () => actions.findDOIsForSelected(),
      appliesTo: lacksDOIOrAbstract,
    },
    {
      l10nKey: "menu-preprint",
      icon: ICONS.findPublished,
      run: () => actions.findPublishedVersionsForSelected(),
      appliesTo: isPreprint,
    },
    {
      l10nKey: "menu-enrich",
      icon: ICONS.enrich,
      run: () => actions.enrichMetadataForSelected(),
      appliesTo: isEnrichable,
    },
  ];
}

function toMenuItem({ l10nKey, icon, run }: LibraryEntry) {
  return {
    menuType: "menuitem",
    l10nID: l10nID(l10nKey),
    icon,
    onCommand: run,
  };
}

function toSelectionMenuItem(entry: SelectionEntry) {
  return {
    ...toMenuItem(entry),
    onShowing: (_event: Event, context: any) =>
      context.setVisible(context.items.some(entry.appliesTo)),
  };
}

// Zotero adds the entries to every window and removes them when the plugin is disabled.
export function registerMenus(
  menuManager: any,
  pluginID: string,
  actions: MenuActions,
): void {
  menuManager.registerMenu({
    menuID: `${config.addonRef}-tools`,
    pluginID,
    target: "main/menubar/tools",
    menus: libraryEntries(actions).map(toMenuItem),
  });
  menuManager.registerMenu({
    menuID: `${config.addonRef}-item`,
    pluginID,
    target: "main/library/item",
    menus: selectionEntries(actions).map(toSelectionMenuItem),
  });
}
