# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zotero DOI Finder is a Zotero plugin (addon ID: `doifinder@zotero.org`) that automatically finds missing DOIs and abstracts for items in a Zotero library. It queries CrossRef, Semantic Scholar, PubMed, and OpenAlex APIs.

## Commands

```bash
npm run build       # TypeScript + esbuild + XPI creation (production)
npm run start       # Development mode with file watching + live injection into Zotero
npm run stop        # Stop development server
npm run lint        # Prettier formatting + ESLint fixing
npm run release     # Release management via release-it
```

There are no tests configured in this project.

## Architecture

The plugin is built with TypeScript and bundled via esbuild into an IIFE (Firefox 128 target). The XPI must have `bootstrap.js` and `manifest.json` at its root.

**Entry point**: `addon/bootstrap.js` — loaded by Zotero, waits for `Zotero.initializationPromise`, then loads the compiled bundle (`content/scripts/index.js`) via `Services.scriptloader.loadSubScript`. It delegates all lifecycle calls to `Zotero.DOIFinder.*`.

**Core logic** is in `src/index.ts`:
- Sets up `Zotero.DOIFinder` with lifecycle methods (`startup`, `shutdown`, `onMainWindowLoad`, `onMainWindowUnload`) when the bundle loads
- `onMainWindowLoad` registers menus, toolbar button, and keyboard shortcut (Ctrl/Cmd+Alt+D) per window; `onMainWindowUnload` removes them (required to avoid memory leaks)
- `findDOIForItem()`: queries `api.crossref.org/works` with fuzzy title matching (Levenshtein distance, 0.85 threshold)
- Abstract finding uses a waterfall: Semantic Scholar → PubMed → OpenAlex
- `processItems()` handles batch processing with a `Zotero.ProgressWindow`
- All HTTP calls use `Zotero.HTTP.request()` (async, non-blocking, respects Zotero proxy settings)

**UI layer**:
- `src/modules/menu.ts`: `registerWindowMenus(win)` / `unregisterWindowMenus(win)` — per-window menu registration with DOM cleanup
- `src/utils/locale.ts`: hardcoded English strings with parameter interpolation

**Build pipeline** (`scripts/zotero-cmd.mjs`): cleans output, copies `addon/` template (with placeholder substitution for `__version__` etc.), runs esbuild, then zips to `.xpi`.

## Key Constraints

- Plugin attaches itself to `Zotero.DOIFinder` global namespace; `bootstrap.js` deletes it on shutdown
- UI elements must be added in `onMainWindowLoad` and removed in `onMainWindowUnload` — Zotero calls these for every window open/close
- TypeScript strict mode is enforced; no unused locals/parameters are allowed
- `zotero-plugin.config.ts` is present but unused — the actual build uses `scripts/zotero-cmd.mjs` directly
