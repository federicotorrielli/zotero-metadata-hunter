# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zotero Metadata Hunter is a Zotero plugin (addon ID: `metadatahunter@federicotorrielli.github.io`) that automatically finds missing DOIs and abstracts for items in a Zotero library, checks whether preprints have a published conference/journal version, and enriches sparse already-published items (e.g. Google Scholar BibTeX imports) with full metadata pulled from Zotero's own translators. It queries CrossRef, DBLP, Semantic Scholar, arXiv, PubMed, and OpenAlex.

## Commands

```bash
pnpm run build       # TypeScript check + esbuild + XPI creation (production)
pnpm run start       # Development mode with file watching + live injection into Zotero
pnpm run stop        # Stop development server
pnpm run lint        # Prettier formatting + ESLint fixing
```

There are no tests configured in this project.

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
- `processItems()` runs items in parallel batches of 5 with a `CancelToken`; a 300ms minimum inter-batch delay rate-limits API calls
- `findPublishedDOI()` checks for a published version of a preprint: arXiv direct ID first, then Semantic Scholar + CrossRef + DBLP raced with `Promise.any`
- `processPreprints()` same batch/cancel/progress pattern as `processItems()`; on success creates a new item via `Zotero.Translate.Search`, **re-parents child attachments and notes from the source preprint onto the new item before trashing the source** (Zotero trashes children with their parent, so skipping this step silently loses annotated PDFs once Trash is emptied)
- All HTTP calls use `Zotero.HTTP.request()` (async, respects Zotero proxy settings)

**Failure tags** (`TAG_NO_DOI`, `TAG_NO_PUBLISHED`, `TAG_UPDATE_FAILED`, `TAG_NO_RICHER_RECORD` at the top of `src/index.ts`): items that can't be resolved get a persistent Zotero tag so users can filter/retry. Tags are cleared automatically on a subsequent successful run — any code path that resolves an item must call the tag-removal helper, or stale failure tags will accumulate.

**Metadata enrichment** (`enrichItemMetadata`, `processEnrichments`, `enrichMetadata`, `enrichMetadataForSelected` in `src/index.ts`): for non-preprint regular items with sparse fields, pulls the canonical record by DOI through `Zotero.Translate.Search` (same machinery as "Add Item by Identifier") and merges fields onto the existing item in place. If the item has no DOI, runs `findDOIForItem` first. Per-field merge policy lives in `enrichItemFromMetadata`: scalar fields like venue/volume/pages/ISSN are fill-missing-only with `Zotero.ItemFields.isValidForType` gating; abstract is replaced when existing is empty or suspiciously short (< 200 chars); creator list is replaced when existing has fewer than 2 entries or is strictly shorter than hydrated with a shared surname; item type is set directly from the translator's choice. `analyzeItemsForEnrichment` filters library-wide runs to items missing at least one of `{publicationTitle, proceedingsTitle, abstractNote, pages, volume}`; right-click runs respect the user's selection but still skip preprints.

**Critical pitfall**: `Zotero.Translate.Search.translate({...})` in `fetchRichRecordByDOI` persists the new item to the user's library (same behavior `processPreprints` relies on). The enrichment path does NOT want a duplicate, so `fetchRichRecordByDOI` runs the translator with `collections: []`, snapshots the scratch's hydrated data into a plain `NormalizedRecord` via `normalizeScratch`, and erases the scratch via `Zotero.Items.erase(scratch.id)` inside `finally` (notifier event NOT suppressed: `translate.translate()` fires `add` events, so the matching `delete` must fire too or the Zotero pane keeps a stale row visible until manual refresh). The order is load-bearing in two ways: (1) the snapshot must run on the live scratch, before the erase, so it relies on the JS semantics that `return normalizeScratch(scratch)` evaluates before `finally` runs; (2) the erase must run before the function returns to the caller, so a duplicate never reaches the user's library. Skipping the erase silently doubles the library; skipping the normalization step (i.e. returning the live scratch and reading from it later) makes the merge depend on undocumented post-erase cache survival.

**DOI source details** (all in `src/index.ts`):

- `findDOIFromCrossRef`: narrow query (title + author + year), falls back to title-only if no match — prevents author substring false positives (e.g. "Kirchenbauer" matching "Müller-Kirchenbauer")
- `findDOIFromDBLP`: title + author concatenated into DBLP's full-text index; handles `hit` being object or array
- `findDOIFromSemanticScholar`: uses `/paper/search/match` with title only (no author — extra terms break this endpoint's scoring); fetches `externalIds,title,abstract` so a single call can provide both DOI and abstract, skipping the abstract lookup when SS wins
- `findDOIFromArXiv`: extracts `<arxiv:doi>` (namespace `http://arxiv.org/schemas/atom`) or `<link title="doi">` href from Atom XML

**Title matching** (`isTitleMatch`):

- Normalises both strings (lowercase, strip punctuation)
- Length gate applied first to ALL checks: if `(longer − shorter) / longer > 0.15`, reject immediately — this prevents short strings (e.g. "Large Language Models") from falsely matching longer ones via substring
- Then: exact → substring → Levenshtein similarity > 0.85

**Query cleaning** (`cleanTitleForQuery`):

- Strips HTML entities, truncates to 100 chars
- Only strips subtitle (after `:` or `—`) when the pre-colon fragment has ≥ 4 words — short main titles like "BERT: …" or "Machine generated text: …" need their subtitle to produce a distinctive query

**Preprint detection** (`isPreprint`): item type `preprint`, URL containing `arxiv.org`, DOI starting with `10.48550/arXiv.`, or `arXiv:` in the Extra field. `extractArxivId()` parses the ID from those same fields and is reused by both `isPreprint` and `findPublishedDOI`.

**Published venue validation**: results are only accepted if the DOI doesn't start with `10.48550/arXiv.` and the venue is not in the `PREPRINT_VENUES` blocklist (arXiv, CoRR, SSRN, bioRxiv, medRxiv, etc.). CrossRef results must also have type `journal-article`, `proceedings-article`, or `book-chapter` (checked via `PUBLISHED_CROSSREF_TYPES` Set).

**UI layer**:

- `src/modules/menu.ts`: per-window menu registration; Tools menu has two items (DOI finding + preprint check); right-click menu has two items with separate visibility rules (`isRegularItem` vs `isPreprint`); DOM refs closed over at registration to avoid per-open getElementById lookups; single `popupshowing` listener per window cleaned up in `unregisterWindowMenus`
- `src/utils/locale.ts`: hardcoded English strings with `replaceAll`-based parameter interpolation
- Toolbar button and both shortcuts toggle: if processing → cancel, otherwise → start; `syncAllToolbarButtons()` updates label/tooltip across all open windows

**Build pipeline**: `scripts/build.mjs` delegates to `scripts/zotero-cmd.mjs`, which cleans output, copies `addon/` template (substituting `__version__` etc.), runs esbuild, then zips to `.xpi`.

## Key Constraints

- UI elements must be added in `onMainWindowLoad` and removed in `onMainWindowUnload` — Zotero calls these for every window open/close
- TypeScript strict mode: `noUnusedLocals` and `noUnusedParameters` are enforced — prefix unused params with `_`
- The 300ms minimum inter-batch delay in `processItems()` is intentional for API rate limiting — do not remove
- `moduleResolution` is `bundler` (not `node`) — TypeScript 6 deprecated `node`/`node10`
