import { config } from "../../package.json";

declare const Zotero: any;

export const FTL_FILE = `${config.addonRef}.ftl`;

export type Params = Record<string, string | number>;

export type Translate = (key: string, params?: Params) => string;

interface Localization {
  formatValueSync(id: string, args?: Params): string | null;
  addResourceIds(ids: string[]): void;
  removeResourceIds(ids: string[]): void;
}

// Fluent ids are shared by every plugin, so each one has the addon prefix.
export const l10nID = (key: string): string => `${config.addonRef}-${key}`;

// Fluent wraps arguments in bidi isolation marks, which plain text shows as boxes.
const BIDI_ISOLATES = /[\u2068\u2069]/g;

export function formatString(
  ftl: Localization,
  key: string,
  params?: Params,
): string {
  const text = ftl.formatValueSync(l10nID(key), params);
  return text ? text.replace(BIDI_ISOLATES, "") : key;
}

// The one binding to the live Zotero localization. Everything else takes it as a parameter.
export const getString = (key: string, params?: Params): string =>
  formatString(Zotero.ftl, key, params);

export function registerStrings(ftl: Localization): void {
  ftl.addResourceIds([FTL_FILE]);
}

export function unregisterStrings(ftl: Localization): void {
  ftl.removeResourceIds([FTL_FILE]);
}

// Menu labels are resolved by the window's own l10n, so each window loads the file.
export function loadWindowStrings(win: Window): void {
  (win as any).MozXULElement.insertFTLIfNeeded(FTL_FILE);
}

export function unloadWindowStrings(win: Window): void {
  (win as any).document
    .querySelector(`link[rel="localization"][href="${FTL_FILE}"]`)
    ?.remove();
}
