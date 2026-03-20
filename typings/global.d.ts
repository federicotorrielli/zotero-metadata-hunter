declare const Zotero: _ZoteroTypes.Zotero;
declare const ZoteroPane: _ZoteroTypes.ZoteroPane;
declare const rootURI: string;
declare const window: Window;
declare const document: Document;

declare module "*.json" {
  const value: any;
  export default value;
}
