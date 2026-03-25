# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zotero DOI Finder is a Zotero plugin (addon ID: `doifinder@zotero.org`) that automatically finds missing DOIs and abstracts for items in a Zotero library. It queries CrossRef, DBLP, Semantic Scholar, arXiv, PubMed, and OpenAlex.

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

**Entry point**: `addon/bootstrap.js` — loaded by Zotero, waits for `Zotero.initializationPromise`, loads the compiled bundle (`content/scripts/index.js`) via `Services.scriptloader.loadSubScript`, and delegates all lifecycle calls (`startup`, `shutdown`, `onMainWindowLoad`, `onMainWindowUnload`) to `Zotero.DOIFinder.*`.

**Core logic** (`src/index.ts`):

- Sets up `Zotero.DOIFinder` on the global namespace with lifecycle methods; `bootstrap.js` deletes it on shutdown
- `onMainWindowLoad` registers menus, toolbar button, and keyboard shortcut (Ctrl/Cmd+Alt+D) per window; `onMainWindowUnload` removes them (required to avoid memory leaks)
- `findDOIForItem()` tries four sources in order: **CrossRef → DBLP → Semantic Scholar → arXiv**
- `findAbstractForItem()` races all three abstract sources simultaneously with `Promise.any`: **Semantic Scholar → PubMed → OpenAlex**
- `processItems()` runs items in parallel batches of 5 with a `CancelToken`; a 300ms minimum inter-batch delay rate-limits API calls
- All HTTP calls use `Zotero.HTTP.request()` (async, respects Zotero proxy settings)

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

**UI layer**:
- `src/modules/menu.ts`: per-window menu registration with `popupshowing` listener that hides the right-click item when no regular item is selected; listener cleaned up in `unregisterWindowMenus`
- `src/utils/locale.ts`: hardcoded English strings with `replaceAll`-based parameter interpolation
- Toolbar button and Ctrl/Cmd+Alt+D both toggle: if processing → cancel, otherwise → start; button label/tooltip updates via `syncAllToolbarButtons()` across all open windows

**Build pipeline**: `scripts/build.mjs` delegates to `scripts/zotero-cmd.mjs`, which cleans output, copies `addon/` template (substituting `__version__` etc.), runs esbuild, then zips to `.xpi`.

## Key Constraints

- UI elements must be added in `onMainWindowLoad` and removed in `onMainWindowUnload` — Zotero calls these for every window open/close
- TypeScript strict mode: `noUnusedLocals` and `noUnusedParameters` are enforced — prefix unused params with `_`
- The 300ms minimum inter-batch delay in `processItems()` is intentional for API rate limiting — do not remove
- `moduleResolution` is `bundler` (not `node`) — TypeScript 6 deprecated `node`/`node10`
