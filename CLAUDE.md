# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zotero Metadata Hunter is a Zotero plugin (addon ID: `metadatahunter@federicotorrielli.github.io`) that automatically finds missing DOIs and abstracts for items in a Zotero library, checks whether preprints have a published conference/journal version, and enriches sparse already-published items (e.g. Google Scholar BibTeX imports) with full metadata pulled from Zotero's own translators. It queries CrossRef, DBLP, Semantic Scholar, arXiv, PubMed, and OpenAlex.

## Commands

```bash
pnpm run build       # TypeScript check + esbuild + XPI creation (production)
pnpm run lint        # Prettier formatting + ESLint fixing (flat config in eslint.config.mjs)
pnpm test            # vitest, no Zotero needed (tests/ typechecks with tsconfig.tests.json)
```

There is no watch mode. To run from source, point a Zotero extension proxy file at `build/addon` (see the README) and restart Zotero after each build. Tests need Node 22.12 or newer.

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

**Design rules** (from the maintainer's guidelines, enforced by review):

- `src/index.ts` is the only composition root. It, `src/zoteroApi.ts` and `getString` in `src/utils/locale.ts` are the only code that reads `Zotero` or `Services`. Timers come from the injected `Clock` (`now`, `delay`, `after`), so `withTimeout` and the batch runner read no global either. Everything else receives what it needs as parameters (`FlowDeps`, `SourceDeps`, `DblpDeps`, `ToolbarDeps`, `Prefs`, `Clock`), so it runs unchanged under a test.
- At most 3 parameters per function. Group more into one options object. Keep functions to one level of abstraction, and extract a helper before a function needs a "step 1, step 2" comment.
- Domain logic sits in pure leaf functions (`match/`, `domain/`), and I/O sits at the edges.

**Module map** (`src/`):

- `index.ts`: builds the adapters, wires the lifecycle (`Zotero.MetadataHunter.startup/shutdown/onMainWindowLoad/onMainWindowUnload`, called by `addon/bootstrap.js`), registers menus once at startup and the toolbar and shortcuts per window.
- `core/`: `CancelToken` and `RunController` (the one run in progress, which the toolbar and the shortcuts toggle), `runBatches` (parallel batches, cancel, a 300 ms minimum interval between batch starts that is intentional API rate limiting, so do not remove it), `createProgressReporter`.
- `flows/`: `doi.ts`, `preprints.ts`, `enrich.ts` are the three user actions. Each exports a `create*Action(deps, scope)` that returns an `Action` (`select`, `process`, `message`), and `runAction` in `action.ts` runs it. `shared.ts` holds `processInBatches`, the loop all three share, plus the result tail helpers. `tags.ts` holds the failure tags.
- `sources/`: one file per service (`crossref`, `semanticScholar`, `arxiv`, `pubmed`, `openalex`, `openreview`, `dblp`). `lookups.ts` lists them as data (`doiCascade`, `abstracts`, `published`), so a flow does not know which sources exist and a new source is one more entry.
- `net/`: `createHttp` (every request goes through it) and `SourceTally` with `withTimeout` and `withNullAsReject`.
- `domain/`: `preprint.ts` (what is a preprint, what counts as published), `merge.ts` (how a record merges onto an item), `creators.ts`.
- `match/title.ts`: title cleaning and matching.
- `selection.ts`, `prefs.ts`, `types.ts` (the slice of Zotero's objects the code uses, so fakes stay small).
- `modules/`: `menu.ts`, `toolbar.ts`, `shortcuts.ts`, `progress.ts` (the cards).

**Lookup behavior**:

- `findDOIForItem` tries **CrossRef → DBLP → Semantic Scholar → arXiv** in order. `findAbstractForItem` races **Semantic Scholar, PubMed, OpenAlex** with `Promise.any`. PubMed returns every section of a structured abstract, joined with their labels.
- `findPublishedDOI` asks the arXiv entry of the preprint first, then races Semantic Scholar, CrossRef, DBLP and OpenReview. It returns a `PublishedRef`, one of `{doi}`, `{url}` or `{bibtex, url}`, and `createItemFromPublished` picks the translator for it.
- **OpenReview must not be fetched as a web page.** `openreview.net/forum?id=...` answers non-browser clients with a 307 to `/challenge`, so the web translator gets an anti-bot page and item creation fails. `api2.openreview.net/notes/search` is not gated and its response already contains `content._bibtex.value`, a complete record. `sources/openreview.ts` therefore returns `{bibtex, url}`, and the BibTeX translator (`9cb70025-a888-4a29-a210-93ec52da40d4`) derives the item type from the entry type. Do not rebuild those fields by hand: `api2` wraps every `content` field as `{value: ...}`, and `contentValue` and `contentList` unwrap them.
- The preprint flow creates the new item through the translators and **re-parents child attachments and notes from the source preprint onto it before trashing the source**. Zotero trashes children with their parent, so skipping this step silently loses annotated PDFs once the trash is emptied. An attachment whose file is missing or empty (`api.attachmentState` answers "broken") is trashed instead of moved, and the result panel counts them. A file that is only waiting to download from Zotero's server (`awaiting-download`), a linked file at a path this computer cannot reach (`unreachable`, e.g. an unmounted drive), a note, and a link-only attachment are always kept. When nothing replaces the source and it is Zotero's generic `document` type, `promoteDocumentToPreprint` converts it in place to `preprint` (Zotero remaps the base fields, so no metadata is lost). Non-preprint `document` items are re-typed by the enrichment flow instead.
- A DOI save happens once per item per run: the flows change the item in memory and call `saveTx` at the end, and the counters rise only after the save succeeds.
- `runAction` shows an error card when a run or the item lookup throws, and `processInBatches` always closes the progress card.
- `shutdown()` unloads every window itself, because Zotero does not announce windows when a plugin is disabled or updated. Without it the old toolbar button and shortcut handlers would stay and a second copy would be added.
- `resolveTargetItems()` answers "what should this run act on": the explicit item selection, else every item of the selected collection tree rows, de-duplicated by id.

**Failure tags** (`TAG_NO_DOI`, `TAG_NO_PUBLISHED`, `TAG_UPDATE_FAILED`, `TAG_NO_RICHER_RECORD` in `flows/tags.ts`): items that cannot be resolved get a persistent Zotero tag so users can filter and retry. Tags are cleared on a later successful run. Any code path that resolves an item must remove its tags, or stale failure tags accumulate.

**A failure tag is a claim about the paper, never about the network.** One source answering "I hold no record of this" is evidence, so it justifies the tag. The tag is withheld only when _no_ source gave a verdict (`SourceTally.unchecked`). An earlier version withheld it whenever any source threw, which on a real 12 item run suppressed 8 of them, because with four sources something throws most of the time. Do not tighten this back up without measuring it against a real library.

`findDOIForItem` and `findPublishedDOI` return `{result/ref, unchecked, failedSources}`. Callers tag only when `unchecked` is false, and they fold `failedSources` into a run-wide `Map<string, number>` that the panel prints as "Semantic Scholar (3), CrossRef (2)". Naming the source matters, because "a source did not answer" leaves the user unable to tell a rate limit from an outage. `Zotero.HTTP.request` retries 429 and 5xx internally with a backoff of up to an hour, far past our own timeout, so a rate limit used to arrive as a plain `null` and get recorded as "this paper has no DOI". `createHttp` passes `errorDelayMax: 0` to surface the throttle at once, and sends a User-Agent carrying the repository URL, which puts CrossRef requests in its higher-limit polite pool.

Outcomes are tallied through `SourceTally.run` (sequential cascades) and `SourceTally.track` (raced lookups). Source functions do not catch, so a new source needs no error handling of its own. Wrap `track` _inside_ `withNullAsReject`, never outside, or a source that found nothing is recorded as a failure instead of an answer. Read the tally only after every source has settled, which for `Promise.any` means only in the rejection path.

**404 does not always mean failure.** Semantic Scholar's `/paper/search/match` answers 404 with `{"error":"Title match not found"}` for a title it cannot match, and both Semantic Scholar and OpenAlex answer 404 for a DOI they do not hold. Those call sites use `getOptionalJson`, which allows 404 and returns `null`. Treating them as failures would suppress `TAG_NO_DOI` for every paper those sources do not know.

**Metadata enrichment** (`flows/enrich.ts`, `domain/merge.ts`): for non-preprint regular items with sparse fields, the flow pulls the canonical record by DOI through `Zotero.Translate.Search` (the machinery behind "Add Item by Identifier") and merges it onto the existing item in place. If the item has no DOI, `findDOIForItem` runs first. An arXiv DOI on a published item is swapped for the published DOI first, and when none exists the item is left alone. The merge policy is `enrichItemFromMetadata`: scalar fields (venue, volume, pages, ISSN) are fill-missing-only and gated by `isFieldValidForType`; the abstract is replaced when the existing one is empty or shorter than 200 characters; the creator list is replaced only when the hydrated one is longer, and then when the existing one has fewer than 2 entries or shares a surname (an equal list adds nothing, so a single author is never rewritten); the item type is set from the translator's choice. `hasSparseMetadata` filters library runs to items missing a venue, abstract, pages or volume. Right-click runs respect the selection but still skip preprints.

**Critical pitfall**: the translator in `fetchRichRecordByDOI` saves the new item to the user's library, and the enrichment must not leave a duplicate. So it runs with `collections: []`, snapshots the scratch item into a plain `NormalizedRecord` with `normalizeScratch`, and erases the scratch with `api.eraseItem` inside `finally`. The notifier event is not suppressed: `translate()` fires `add` events, so the matching `delete` must fire too, or the Zotero pane keeps a stale row until a manual refresh. The order is load bearing in two ways. The snapshot runs on the live scratch, relying on `return normalizeScratch(...)` being evaluated before `finally`. And the erase finishes before the function returns, so a duplicate never reaches the user. Skipping the erase silently doubles the library, and returning the live scratch to read later makes the merge depend on undocumented post-erase cache survival.

**DBLP host selection** (`sources/dblp.ts`, `DblpHostPool`): dblp.org, dblp.dagstuhl.de and dblp.uni-trier.de are three separate machines serving the same index, and they go down one at a time. Both DBLP lookups call `pool.search`, which resolves a host on first use, keeps it for the session, and moves to another as soon as it throws. The health check is a real search request (`/search/publ/api?q=dblp&h=1`) whose response must parse as JSON with a `result` block. A HEAD request on the root would not do: `dblp.uni-trier.de` once served its front page with a 200 and returned 500 for every search, so the lighter check would have selected the one host unable to serve a lookup. Checking is lazy, so a session that never runs the plugin makes no DBLP request, and the running check is shared, so a batch costs one check and not one per item.

A host that throws on a real query is set aside for the session. That is safe because the hosts serve the same index: losing a healthy one costs nothing, while staying on a dead one costs every remaining item. When no host is left, the pool clears its set and pauses for a minute (`RETRY_PAUSE_MS`), which keeps a library run from spending one timeout per host per item on a service that is clearly down. The pause makes DBLP throw, which the tally records as a failed source in the result panel.

The preference `extensions.zotero.metadatahunter.dblpHost` (`DBLP_HOST_PREF` in `prefs.ts`) stores an optional self-hosted DBLP, and `DEFAULT_HOST` (`https://dblp.federicotorrielli.me`, the maintainer's mirror) comes next. The pool checks the preference host and then the default one at a time, so a working one always wins, and races the public hosts only when both fail. It reads the preference on every lookup and resets when the value changed, so an edit in the preferences pane takes effect without a restart. The names and bounds of the preferences are repeated in `addon/preferences.js`, which is not bundled, and `tests/prefs.test.ts` keeps the two in step.

**Title matching** (`match/title.ts`, `isTitleMatch`): both strings are normalized (NFKD, combining marks dropped so "Über" equals "Uber", lowercase, punctuation stripped). A length gate comes first for all checks: if `(longer − shorter) / longer > 0.15` the titles do not match, which stops a short title ("Large Language Models") from matching a longer one by substring. Then exact, then substring, then Levenshtein similarity above 0.85.

**Query cleaning** (`cleanTitleForQuery`): strips HTML entities and truncates to 100 characters at a word boundary. It drops the subtitle (after `:` or `—`) only when the fragment before it has at least 4 words. Short main titles like "BERT: …" need their subtitle to make a distinctive query.

**Preprint detection** (`domain/preprint.ts`): item type `preprint`, venue CoRR, URL containing `arxiv.org`, an arXiv DOI, or `arXiv:` in Extra (any case). `extractArxivId` reads new (`2502.01534`) and old (`hep-th/9901001`) identifiers from the URL, the DOI and Extra, and serves both `isPreprint` and the preprint flow.

**Published venue validation**: results are accepted only when the DOI does not start with `10.48550/arXiv.` and the venue is not in `PREPRINT_VENUES` (arXiv, CoRR, SSRN, bioRxiv, medRxiv and so on). CrossRef results must also have type `journal-article`, `proceedings-article` or `book-chapter`. OpenReview results additionally reject unpublished status markers (`submitted to`, `under review`, `rejected`, `withdrawn`), DBLP mirror records, and notes without authors.

**UI layer**:

- `modules/menu.ts`: `Zotero.MenuManager` registration; the Tools menu has three items (DOI finding, preprint check, enrichment); the right-click menu has the same three with separate visibility rules (`lacksDOIOrAbstract`, `isPreprint`, `isEnrichable`, so the DOI entry is hidden for items that already have a DOI and an abstract) applied through `onShowing` and `context.items`.
- `utils/locale.ts`: Fluent lookup over `Zotero.ftl`. `common-*` ids hold the tails shared by all three flows, so a wording change lands in one place. House style for anything the user reads: no em-dashes, one idea per sentence, and no two independent clauses joined by a comma plus `and`, `but` or `so`. Every result message states how many items were checked, so a count is never left implicit.
- `modules/toolbar.ts`: the toolbar button is a dropdown with the three library-wide actions (`libraryEntries` in `menu.ts`, shared with the Tools menu), or a single Stop item while a run is active. It receives `isProcessing` and `stop` as `ToolbarDeps` and reads no module state.
- `modules/shortcuts.ts`: Ctrl or Cmd plus Alt plus D, P or M. Each key toggles through `RunController.toggle`: start when idle, cancel when running.
- `modules/progress.ts`: the progress and result cards, mounted into the window the host is given.

## Testing

`pnpm test` runs vitest over `tests/`. The suites use fakes (`tests/helpers.ts` for items, `tests/harness.ts` for flow dependencies, `tests/doubles.ts` for sources) and the real FTL file, so a wrong message id or variable fails a test. `tests/ui.test.ts`, `tests/wiring.test.ts` and `tests/sources.test.ts` run under jsdom. What a test cannot cover, because it needs a running Zotero: `MozXULElement.insertFTLIfNeeded`, `MenuManager` rendering, the real translators, and `Zotero.Items.erase`. Check those by hand in Zotero 10 after a change that touches them.

**Build pipeline**: `scripts/build.mjs` delegates to `scripts/zotero-cmd.mjs`, which cleans output, copies `addon/` template (substituting `__version__` etc.), runs esbuild, then zips to `.xpi`.

## Zotero version compatibility

Requires Zotero 10 (`strict_min_version` 10.0, `strict_max_version` 10.0.*). Zotero 9 added no developer-facing API, so every API worth using is Zotero 10 or older, and nothing keeps a fallback for Zotero 7 to 9. Version-specific traps:

- **Selection.** Zotero 10 allows several collections and libraries to be selected. `ZoteroPane.getCollectionTreeRows()` returns the selected rows, and the singular getters (`getSelectedCollection()`, `getSelectedLibraryID()`, `getCollectionTreeRow()`) throw. Never call a singular getter. `resolveTargetItems()` calls `row.getItems({ unfiltered: true })` on every selected row, which covers collections, saved searches, libraries, unfiled and duplicates alike. It follows the "show items from subcollections" setting, and skips trash, feeds, buckets and shares through `isEditableRow`.
- **Menus.** `src/modules/menu.ts` registers through `Zotero.MenuManager.registerMenu` once at startup, not per window. Zotero removes the entries when the plugin is disabled. Labels come from Fluent (`.label` in the FTL), so every window must load the file through `MozXULElement.insertFTLIfNeeded`, which `loadWindowStrings` does. The toolbar button has no API and stays manual in `setupWindowToolbar`.
- **Strings.** All user-facing text lives in `addon/locale/en-US/metadatahunter.ftl`, which Zotero registers on its own from `locale/<lang>/`. Every id carries the `metadatahunter-` prefix, and `getString("find-doi-found", {...})` adds it. Fluent term arguments cannot be variables, so plural selects are written inline in each message. Result tails are separate paragraphs added through `tail()`. Fluent wraps arguments in bidi isolation marks, which `formatString` strips. The preferences pane loads the same file through a `<linkset>`.
- **Icons.** The plugin ships no icons of its own. `src/utils/icons.ts` points at Zotero's `chrome://zotero/skin/{16,20}/universal/*.svg`, which paint with `context-fill` and follow the theme. Menu icons use the 16px set. The toolbar uses the 20px set, because Zotero draws toolbar icons at 20x20. Toolbar buttons additionally need `fill: currentColor`, which Zotero applies per built-in button id and therefore never to ours, so `createButton` in `toolbar.ts` sets it inline. Check any new icon exists in the Zotero source under `chrome/skin/default/zotero/`.
- **Toolbar anchor.** The toolbar button anchors to `zotero-tb-lookup` inside `zotero-items-toolbar`. It previously anchored to `zotero-tb-advanced-search`, which does not exist in any of Zotero 7 to 10, so the button silently never rendered. Verify any new anchor id against `chrome/content/zotero/zoteroPane.xhtml` for the versions in the supported range.

## Key Constraints

- UI elements must be added in `onMainWindowLoad` and removed in `onMainWindowUnload` — Zotero calls these for every window open/close
- TypeScript strict mode: `noUnusedLocals` and `noUnusedParameters` are enforced — prefix unused params with `_`
- The 300ms minimum inter-batch delay in `runBatches` (`BATCH_MIN_INTERVAL_MS` in `flows/shared.ts`) is intentional for API rate limiting — do not remove
- `moduleResolution` is `bundler` (not `node`) — TypeScript 6 deprecated `node`/`node10`
