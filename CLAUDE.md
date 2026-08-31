# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zotero Metadata Hunter is a Zotero plugin (addon ID: `metadatahunter@federicotorrielli.github.io`) that automatically finds missing DOIs and abstracts for items in a Zotero library, checks whether preprints have a published conference/journal version, and enriches sparse already-published items (e.g. Google Scholar BibTeX imports) with full metadata pulled from Zotero's own translators. It queries CrossRef, DBLP, Semantic Scholar, arXiv, PubMed, and OpenAlex.

## Commands

```bash
pnpm run build       # TypeScript check + esbuild + XPI creation (production)
pnpm run lint         # Prettier formatting + ESLint fixing (flat config in eslint.config.mjs)
```

There are no tests configured in this project, and there is no watch mode. To run from source, point a Zotero extension proxy file at `build/addon` (see the README) and restart Zotero after each build.

## Releasing

Bump `version` in `package.json`, commit, tag, and push — the GitHub Action builds the XPI, publishes the GitHub Release, and commits the updated `update.json` back to main:

```bash
# edit package.json version first
git commit -am "chore: bump version to X.Y.Z"
git tag vX.Y.Z
git push origin main vX.Y.Z
```

The CI reads the version from `package.json`. Always bump it before tagging — a tag on an old version produces a misnamed release.

## Architecture

The plugin is TypeScript bundled via esbuild into an IIFE (Firefox 128 target). The XPI must have `bootstrap.js` and `manifest.json` at its root.

**Entry point**: `addon/bootstrap.js` — loaded by Zotero, waits for `Zotero.initializationPromise`, loads the compiled bundle (`content/scripts/index.js`) via `Services.scriptloader.loadSubScript`, and delegates all lifecycle calls (`startup`, `shutdown`, `onMainWindowLoad`, `onMainWindowUnload`) to `Zotero.MetadataHunter.*`.

**Core logic** (`src/index.ts`):

- Sets up `Zotero.MetadataHunter` on the global namespace with lifecycle methods; `bootstrap.js` deletes it on shutdown
- `onMainWindowLoad` registers menus, toolbar button, and keyboard shortcuts (Ctrl/Cmd+Alt+D, Ctrl/Cmd+Alt+P, and Ctrl/Cmd+Alt+M) per window; `onMainWindowUnload` removes them (required to avoid memory leaks)
- `findDOIForItem()` tries four sources in order: **CrossRef → DBLP → Semantic Scholar → arXiv**
- `findAbstractForItem()` races all three abstract sources simultaneously with `Promise.any`: **Semantic Scholar → PubMed → OpenAlex**
- `processItems()` runs items in parallel batches of 2 by default (`DEFAULT_BATCH`, 1 to 12 from the preferences pane) with a `CancelToken`; a 300ms minimum inter-batch delay rate-limits API calls
- `findPublishedDOI()` checks for a published version of a preprint: arXiv direct ID first, then Semantic Scholar + CrossRef + DBLP + OpenReview raced with `Promise.any`. It returns a `PublishedRef`, which is one of `{doi}`, `{url}`, or `{bibtex, url}`; `createItemFromPublished()` dispatches to `createItemFromDOI`, `createItemFromURL`, or `createItemFromBibtex` accordingly
- **OpenReview must not be fetched as a web page.** `openreview.net/forum?id=...` answers non-browser clients with a 307 to `/challenge`, so `Zotero.HTTP.processDocuments` hands the translator an anti-bot page and item creation fails. `api2.openreview.net/notes/search` is not gated and its response already contains `content._bibtex.value`, a complete record. `findPublishedRefFromOpenReview` therefore returns `{bibtex, url}` and `createItemFromBibtex` imports it with Zotero's bundled BibTeX translator (`9cb70025-a888-4a29-a210-93ec52da40d4`), which derives the item type from the entry type. Do not rebuild those fields by hand: `api2` wraps every `content` field as `{value: ...}`, and the `openReviewContentValue`/`openReviewContentList` helpers exist to unwrap them
- `processPreprints()` same batch/cancel/progress pattern as `processItems()`; on success creates a new item via `Zotero.Translate.Search`, **re-parents child attachments and notes from the source preprint onto the new item before trashing the source** (Zotero trashes children with their parent, so skipping this step silently loses annotated PDFs once Trash is emptied). When no published version replaces the source (no match, or item creation failed) and the source is Zotero's generic `document` type, `promoteDocumentToPreprint()` converts it in place to the proper `preprint` type. Bare imports (Scholar BibTeX, RIS, manual entry) often land arXiv preprints as `document`; the type-change remaps base fields so no metadata is lost. Non-preprint `document` items are re-typed instead by the enrichment flow, which sets item type from the translator's choice.
- All HTTP calls use `Zotero.HTTP.request()` (async, respects Zotero proxy settings)
- `resolveTargetItems()` is the single entry point for "what should this run act on": explicit item selection, else the selected collections, else the selected libraries, de-duplicated by id. All three library-wide actions go through it

**Failure tags** (`TAG_NO_DOI`, `TAG_NO_PUBLISHED`, `TAG_UPDATE_FAILED`, `TAG_NO_RICHER_RECORD` at the top of `src/index.ts`): items that can't be resolved get a persistent Zotero tag so users can filter/retry. Tags are cleared automatically on a subsequent successful run — any code path that resolves an item must call the tag-removal helper, or stale failure tags will accumulate.

**A failure tag is a claim about the paper, never about the network.** One source answering "I hold no record of this" is evidence, so it justifies the tag. The tag is withheld only when _no_ source gave a verdict (`SourceTally.answered === 0`). An earlier version withheld it whenever any source threw, which on a real 12 item run suppressed 8 of them, because with four sources something throws most of the time. Do not tighten this back up without measuring it against a real library.

`findDOIForItem` and `findPublishedDOI` return `{result/ref, unchecked, failedSources}`. Callers tag only when `unchecked` is false, and they fold `failedSources` into a run-wide `Map<string, number>` that the panel prints as "Semantic Scholar (3), CrossRef (2)". Naming the source matters, because "a source did not answer" leaves the user unable to tell a rate limit from an outage. Separately, `Zotero.HTTP.request` retries 429 and 5xx internally with a backoff that runs up to an hour by default, far past our own timeout, so a rate limit used to arrive as a plain `null` and get recorded as "this paper has no DOI". `httpGet` passes `errorDelayMax: 0` to surface the throttle immediately instead, and sends a User-Agent carrying the repository URL, which puts CrossRef requests in its higher-limit polite pool.

Outcomes are tallied through `runSource` (sequential cascades) and `trackSource` (raced lookups) into a `SourceTally` of `{answered, failed[]}`; source functions themselves no longer catch, so a new source needs no error handling of its own. Wrap `trackSource` _inside_ `withNullAsReject`, never outside, or a source that legitimately found nothing is recorded as a failure instead of an answer. Read the tally only after every source has settled, which for `Promise.any` means only in the rejection path.

**404 does not always mean failure.** Semantic Scholar's `/paper/search/match` answers 404 with `{"error":"Title match not found"}` for a title it cannot match, and both Semantic Scholar and OpenAlex answer 404 for a DOI they do not hold. Those four call sites use `httpGetOptional`, which adds 404 to `successCodes` and returns `null`. Treating them as failures would suppress `TAG_NO_DOI` for every paper those sources do not know.

**Metadata enrichment** (`enrichItemMetadata`, `processEnrichments`, `enrichMetadata`, `enrichMetadataForSelected` in `src/index.ts`): for non-preprint regular items with sparse fields, pulls the canonical record by DOI through `Zotero.Translate.Search` (same machinery as "Add Item by Identifier") and merges fields onto the existing item in place. If the item has no DOI, runs `findDOIForItem` first. Per-field merge policy lives in `enrichItemFromMetadata`: scalar fields like venue/volume/pages/ISSN are fill-missing-only with `Zotero.ItemFields.isValidForType` gating; abstract is replaced when existing is empty or suspiciously short (< 200 chars); creator list is replaced when existing has fewer than 2 entries or is strictly shorter than hydrated with a shared surname; item type is set directly from the translator's choice. `analyzeItemsForEnrichment` filters library-wide runs to items missing at least one of `{publicationTitle, proceedingsTitle, abstractNote, pages, volume}`; right-click runs respect the user's selection but still skip preprints.

**Critical pitfall**: `Zotero.Translate.Search.translate({...})` in `fetchRichRecordByDOI` persists the new item to the user's library (same behavior `processPreprints` relies on). The enrichment path does NOT want a duplicate, so `fetchRichRecordByDOI` runs the translator with `collections: []`, snapshots the scratch's hydrated data into a plain `NormalizedRecord` via `normalizeScratch`, and erases the scratch via `Zotero.Items.erase(scratch.id)` inside `finally` (notifier event NOT suppressed: `translate.translate()` fires `add` events, so the matching `delete` must fire too or the Zotero pane keeps a stale row visible until manual refresh). The order is load-bearing in two ways: (1) the snapshot must run on the live scratch, before the erase, so it relies on the JS semantics that `return normalizeScratch(scratch)` evaluates before `finally` runs; (2) the erase must run before the function returns to the caller, so a duplicate never reaches the user's library. Skipping the erase silently doubles the library; skipping the normalization step (i.e. returning the live scratch and reading from it later) makes the merge depend on undocumented post-erase cache survival.

**DOI source details** (all in `src/index.ts`):

- `findDOIFromCrossRef`: narrow query (title + author + year), falls back to title-only if no match — prevents author substring false positives (e.g. "Kirchenbauer" matching "Müller-Kirchenbauer")
- `findDOIFromDBLP`: title + author concatenated into DBLP's full-text index; handles `hit` being object or array
- `findDOIFromSemanticScholar`: uses `/paper/search/match` with title only (no author — extra terms break this endpoint's scoring); fetches `externalIds,title,abstract` so a single call can provide both DOI and abstract, skipping the abstract lookup when SS wins
- `findDOIFromArXiv`: extracts `<arxiv:doi>` (namespace `http://arxiv.org/schemas/atom`) or `<link title="doi">` href from Atom XML

**DBLP host selection** (`DBLP_HOSTS`, `checkDblpHost`, `pickDblpHost`, `resolveDblpHost`, `dblpSearch`): dblp.org, dblp.dagstuhl.de, and dblp.uni-trier.de are three separate machines serving the same index, and they go down one at a time. Neither `findDOIFromDBLP` nor `findPublishedRefFromDBLP` builds a URL any more. Both call `dblpSearch`, which resolves a host on first use, keeps it for the session, and moves to another one as soon as it throws.

The health check is a real search request (`/search/publ/api?q=dblp&h=1`) whose response has to parse as JSON with a `result` block. A HEAD request on the root would not do: while this was written, `dblp.uni-trier.de` served its front page with a 200 and returned 500 for every search, so the lighter check would have selected the one host unable to serve a lookup. Checking is lazy, so a Zotero session that never runs the plugin makes no DBLP request, and the running check is shared through `dblpHostCheck`, so a batch costs one check instead of one per item.

A host that throws on a real query is added to `dblpFailedHosts` and left there for the session. Striking a host on a single failure is intentional and safe: the hosts serve the same index, so the cost of losing a healthy one is zero, while the cost of staying on a dead one is every remaining item. When nothing is left, `pickDblpHost` clears the set and sets `dblpPausedUntil` to a minute out, which keeps a library-wide run from spending one timeout per host per item on a service that is clearly down. The pause makes DBLP throw, which `runSource` and `trackSource` already record as a failed source in the result panel.

`DBLP_HOST_PREF` (`extensions.zotero.metadatahunter.dblpHost`) stores an optional self-hosted DBLP. It is checked on its own before the public hosts, so a working one always takes precedence, and it falls back to them when it does not respond. `resolveDblpHost` checks the pref on every lookup and clears the cached host when the value changed, so an edit in the preferences pane takes effect without a restart.

**Title matching** (`isTitleMatch`):

- Normalises both strings (lowercase, strip punctuation)
- Length gate applied first to ALL checks: if `(longer − shorter) / longer > 0.15`, reject immediately — this prevents short strings (e.g. "Large Language Models") from falsely matching longer ones via substring
- Then: exact → substring → Levenshtein similarity > 0.85

**Query cleaning** (`cleanTitleForQuery`):

- Strips HTML entities, truncates to 100 chars
- Only strips subtitle (after `:` or `—`) when the pre-colon fragment has ≥ 4 words — short main titles like "BERT: …" or "Machine generated text: …" need their subtitle to produce a distinctive query

**Preprint detection** (`isPreprint`): item type `preprint`, URL containing `arxiv.org`, DOI starting with `10.48550/arXiv.`, or `arXiv:` in the Extra field. `extractArxivId()` parses the ID from those same fields and is reused by both `isPreprint` and `findPublishedDOI`.

**Published venue validation**: results are only accepted if the DOI doesn't start with `10.48550/arXiv.` and the venue is not in the `PREPRINT_VENUES` blocklist (arXiv, CoRR, SSRN, bioRxiv, medRxiv, etc.). CrossRef results must also have type `journal-article`, `proceedings-article`, or `book-chapter` (checked via `PUBLISHED_CROSSREF_TYPES` Set). OpenReview results return forum URLs instead of DOIs and additionally reject unpublished status markers such as `submitted to`, `under review`, `rejected`, and `withdrawn`.

**UI layer**:

- `src/modules/menu.ts`: per-window menu registration; Tools menu has two items (DOI finding + preprint check); right-click menu has two items with separate visibility rules (`isRegularItem` vs `isPreprint`); DOM refs closed over at registration to avoid per-open getElementById lookups; single `popupshowing` listener per window cleaned up in `unregisterWindowMenus`
- `src/utils/locale.ts`: hardcoded English strings with `replaceAll`-based parameter interpolation. `common.*` holds the tails shared by all three flows, so a wording change lands in one place. House style for anything the user reads: no em-dashes, one idea per sentence, and no two independent clauses joined by a comma plus `and`, `but`, or `so`. Every result message states how many items were checked, so a count is never left implicit
- Toolbar button and both shortcuts toggle: if processing → cancel, otherwise → start; `syncAllToolbarButtons()` updates label/tooltip across all open windows

**Build pipeline**: `scripts/build.mjs` delegates to `scripts/zotero-cmd.mjs`, which cleans output, copies `addon/` template (substituting `__version__` etc.), runs esbuild, then zips to `.xpi`.

## Zotero version compatibility

Supports Zotero 7 through 10 (`strict_min_version` 6.999, `strict_max_version` 10.0.*). Two version-specific traps:

- **Selection getters.** Zotero 10 allows multiple collections and libraries to be selected, so it removed `ZoteroPane.getSelectedCollection()` and `getSelectedLibraryID()` in favour of `getSelectedCollections()` and `getSelectedLibraryIDs()`. The singular versions still exist in Zotero 10 as functions that **throw**, so feature detection must test for the _plural_ name. Zotero 7 to 9 have only the singular ones. `selectedCollections()` and `selectedLibraryIDs()` in `src/index.ts` hold this shim; nothing else may call the getters directly.
- **Icon colour and size.** Icons must carry no colour of their own. Paint every shape with `context-fill` and let Zotero supply the value: its generic `toolbarbutton` rule sets `-moz-context-properties: fill, fill-opacity, stroke, stroke-opacity`, and `menupopup :is(image, .menu-icon)` sets `fill: var(--fill-secondary)` for menu icons. Toolbar buttons additionally need `fill: currentColor`, which Zotero applies per built-in button id (`#zotero-tb-add` and friends) and therefore never to ours, so `setupWindowToolbar` sets it inline. A `prefers-color-scheme` query inside the SVG does **not** work: an icon referenced through the `image` attribute renders as its own document and cannot see Zotero's theme setting. Zotero draws toolbar icons at 20x20 and menu icons at 16x16, hence the separate `find-metadata-20.svg`.
- **Toolbar anchor.** The toolbar button anchors to `zotero-tb-lookup` inside `zotero-items-toolbar`. It previously anchored to `zotero-tb-advanced-search`, which does not exist in any of Zotero 7 to 10, so the button silently never rendered. Verify any new anchor id against `chrome/content/zotero/zoteroPane.xhtml` for the versions in the supported range.

## Key Constraints

- UI elements must be added in `onMainWindowLoad` and removed in `onMainWindowUnload` — Zotero calls these for every window open/close
- TypeScript strict mode: `noUnusedLocals` and `noUnusedParameters` are enforced — prefix unused params with `_`
- The 300ms minimum inter-batch delay in `processItems()` is intentional for API rate limiting — do not remove
- `moduleResolution` is `bundler` (not `node`) — TypeScript 6 deprecated `node`/`node10`
