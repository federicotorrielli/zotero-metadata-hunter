import type { Http } from "../net/http";

// What every source needs from the outside: HTTP, and an XML parser, because the
// parser is a browser global that Zotero provides and tests supply themselves.
export interface SourceDeps {
  http: Http;
  parseXml(text: string): Document;
}
