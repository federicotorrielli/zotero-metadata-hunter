# Zotero Metadata Hunter

A Zotero plugin that automatically finds and adds missing DOIs and abstracts to your references, checks whether preprints in your library have been published at a conference or journal, and enriches sparse items (e.g. Google Scholar BibTeX imports) with full metadata pulled from Zotero's own translators.

## Features

- **4 DOI sources**: CrossRef → DBLP → Semantic Scholar → arXiv, tried in order
- **3 abstract sources**: Semantic Scholar, PubMed, and OpenAlex raced in parallel — fastest wins
- **Preprint upgrading**: detects arXiv preprints and checks if a published version exists; creates a fully-populated item and moves the preprint to trash — child attachments, annotations, and notes are re-parented onto the new item so nothing is lost
- **Metadata enrichment**: for already-published items with sparse fields (no venue, no abstract, no pages), looks up the canonical record by DOI and fills in the missing pieces in place. Item type is set by Zotero's own translator, so a Scholar BibTeX entry stuck on `journalArticle` for an ICML paper gets correctly promoted to `conferencePaper`.
- **Parallel processing**: items processed in batches of 5 (~10× faster than serial)
- **Smart title matching**: Levenshtein similarity with length-gating and subtitle-aware query cleaning
- **Cancellable**: press `Ctrl/Cmd+Alt+D` (DOI finding), `Ctrl/Cmd+Alt+P` (preprint check), or `Ctrl/Cmd+Alt+M` (enrichment) to stop mid-run
- **Live progress**: headline shows a running tally and ETA while processing
- **Failure tags**: items that couldn't be resolved are tagged so you can filter and retry them later

## Installation

1. Download the latest `.xpi` from the [Releases](https://github.com/federicotorrielli/zotero-metadata-hunter/releases) page
2. In Zotero: **Tools → Add-ons → ⚙ → Install Add-on From File…**
3. Select the `.xpi` file and restart if prompted

## Usage

| Trigger | Scope |
| ------- | ----- |

**Find DOIs & Abstracts**

| Trigger                                        | Scope                              |
| ---------------------------------------------- | ---------------------------------- |
| Right-click → **Find DOI and Abstract**        | Selected items only                |
| **Tools → Find DOIs and Abstracts in Library** | Current collection or full library |
| Toolbar button                                 | Current collection or full library |
| `Ctrl/Cmd + Alt + D`                           | Current collection or full library |

Items that already have both a DOI and an abstract are skipped.

**Find Published Versions of Preprints**

| Trigger                                          | Scope                              |
| ------------------------------------------------ | ---------------------------------- |
| Right-click → **Check for Published Version**    | Selected preprints only            |
| **Tools → Find Published Versions of Preprints** | Current collection or full library |
| `Ctrl/Cmd + Alt + P`                             | Current collection or full library |

Detects preprints by item type, arXiv URL, arXiv DOI (`10.48550/arXiv.*`), or `arXiv:` in the Extra field. When a published version is found, a new fully-populated item is created (via the same mechanism as _Add Item by Identifier_), any attachments, annotations, and notes on the original preprint are re-parented onto the new item, and the (now-empty) preprint is moved to trash. Your annotated PDFs stay with the upgraded record — even if you empty Trash afterward.

**Enrich Metadata**

| Trigger                                | Scope                                                |
| -------------------------------------- | ---------------------------------------------------- |
| Right-click → **Enrich Metadata**      | Selected items only                                  |
| **Tools → Enrich Metadata of Library** | Sparse regular items in current collection / library |
| `Ctrl/Cmd + Alt + M`                   | Sparse regular items in current collection / library |

Enrichment uses the existing DOI on the item (or finds one first via the DOI cascade), then runs a single `Translate.Search` by DOI to pull the fully-hydrated record straight from Zotero's CrossRef translator. Missing scalar fields (venue, volume, issue, pages, ISSN, publisher, date, language, URL, series) are filled, the abstract is replaced when the existing one is empty or suspiciously short, and the creator list is replaced when the existing list looks truncated (fewer than 2 entries, or strictly shorter than the hydrated list with at least one shared surname). The item is updated in place, so collections, citation keys, and attached PDFs are not disturbed. Preprints are skipped (use the preprint flow instead). The `MetadataHunter: No Richer Record` tag is applied when the lookup succeeded but yielded nothing better than what was already stored.

To cancel any running operation, use the same shortcut again or click the toolbar button — it toggles.

## Failure Tags

Items that couldn't be resolved are tagged so you can find and retry them via Zotero's tag filter:

| Tag                                    | Meaning                                                             |
| -------------------------------------- | ------------------------------------------------------------------- |
| `MetadataHunter: No DOI`               | No DOI could be found for this item in any of the four sources      |
| `MetadataHunter: No Published Version` | Preprint was checked but no non-preprint publication was found      |
| `MetadataHunter: Update Failed`        | A published version was found but the new item could not be created |
| `MetadataHunter: No Richer Record`     | Enrichment ran but found no fields to add beyond what was stored    |

A tag is automatically removed on a later run if the item is resolved successfully.

## How It Works

**DOI finding** (sources tried in order until one matches):

1. **CrossRef** — title + author + year; falls back to title-only if the narrow query finds nothing
2. **DBLP** — strong coverage of CS conference and journal papers
3. **Semantic Scholar** — `/paper/search/match` endpoint; returns DOI _and_ abstract in one call, skipping the abstract lookup when it wins
4. **arXiv** — extracts the journal DOI from `<arxiv:doi>` when the author has submitted one

**Abstract finding** (all three sources queried simultaneously; first non-null result wins):

- Semantic Scholar (by DOI), PubMed (esearch + efetch), OpenAlex

**Preprint published-version lookup** (sources tried in order):

1. **arXiv direct ID** — fetches the specific arXiv entry and extracts `<arxiv:doi>` (the journal DOI the author reported); most authoritative when present
2. **Semantic Scholar, CrossRef, DBLP** — raced in parallel with `Promise.any`; result must have a non-arXiv DOI and a non-preprint venue to count

**Title matching**: candidates are verified with fuzzy matching (Levenshtein similarity ≥ 0.85), gated by a ≤15% length-difference check that applies to both substring and similarity checks.

## Development

### Prerequisites

- Node.js 20+, pnpm
- Zotero 7 or 8

### Setup

```bash
git clone https://github.com/federicotorrielli/zotero-metadata-hunter.git
cd zotero-metadata-hunter
pnpm install
pnpm run build    # production XPI
pnpm run start    # dev mode with live reload into Zotero
pnpm run lint     # Prettier + ESLint
```

### Releasing

Bump the version in `package.json`, commit, tag, and push — the GitHub Action builds the XPI, creates the release, and updates `update.json` automatically:

```bash
# edit package.json version first
git commit -am "chore: bump version to X.Y.Z"
git tag vX.Y.Z
git push origin main vX.Y.Z
```

## License

AGPL-3.0 — see the LICENSE file for details.
