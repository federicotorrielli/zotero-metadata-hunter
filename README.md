# Zotero Metadata Hunter

A Zotero plugin that finds missing DOIs and abstracts, replaces preprints with their published versions, and fills in sparse fields on items imported from Google Scholar.

[![Latest release](https://img.shields.io/github/v/release/federicotorrielli/zotero-metadata-hunter?style=flat-square)](https://github.com/federicotorrielli/zotero-metadata-hunter/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/federicotorrielli/zotero-metadata-hunter/total?style=flat-square)](https://github.com/federicotorrielli/zotero-metadata-hunter/releases)
[![Zotero 7 and 8](https://img.shields.io/badge/Zotero-7%20%7C%208-CC2936?style=flat-square)](https://www.zotero.org/)
[![License EUPL 1.2](https://img.shields.io/badge/License-EUPL%201.2-blue.svg?style=flat-square)](LICENSE)

## Install

1. Download the latest `.xpi` from [Releases](https://github.com/federicotorrielli/zotero-metadata-hunter/releases).
2. In Zotero, open Tools, Add-ons, the gear menu, Install Add-on From File.
3. Pick the `.xpi`. Restart if Zotero asks.

## What it does

The plugin adds three operations. Each one can be run on selected items (right-click), on a collection or library (Tools menu), or with a keyboard shortcut. Running it again while it is working cancels it.

### Find DOIs and abstracts

Shortcut: `Ctrl/Cmd + Alt + D`. Toolbar button.

DOI lookup tries CrossRef, then DBLP, then Semantic Scholar, then arXiv. Abstract lookup queries Semantic Scholar, PubMed, and OpenAlex at the same time and keeps the first result. Items that already have both fields are skipped.

### Replace preprints with their published versions

Shortcut: `Ctrl/Cmd + Alt + P`.

Detects preprints by item type, arXiv URL, arXiv DOI, or an `arXiv:` line in the Extra field. If a published version is found, the plugin creates a new item from the DOI (the same way *Add Item by Identifier* does), moves attachments, notes, and annotations from the preprint onto the new item, and trashes the old one. Annotated PDFs stay attached to the upgraded record.

### Enrich sparse items

Shortcut: `Ctrl/Cmd + Alt + M`.

For items that already exist but are missing fields, the plugin looks up the canonical record by DOI and fills the gaps in place. Missing scalar fields (venue, volume, issue, pages, ISSN, publisher, date, language, URL, series) are filled. The abstract is replaced if it is empty or under 200 characters. The author list is replaced if it has fewer than two entries or is strictly shorter than the new one and at least one surname matches. Item type is updated, so an ICML paper imported as `journalArticle` becomes `conferencePaper`. The item id, collections, citation key, and attached PDFs are kept. Preprints are skipped here; use the preprint flow instead.

## Failure tags

Items that cannot be resolved are tagged so you can filter them in the tag pane. Tags are removed on a later successful run.

| Tag | Meaning |
| --- | --- |
| `MetadataHunter: No DOI` | No DOI found in any source |
| `MetadataHunter: No Published Version` | Preprint checked, no non-preprint publication found |
| `MetadataHunter: Update Failed` | Published version found but the new item could not be created |
| `MetadataHunter: No Richer Record` | Enrichment ran but nothing new was added |

## Development

Requires Node.js 20+, pnpm, and Zotero 7 or 8.

```bash
pnpm install
pnpm run build    # type-check, bundle, package the .xpi
pnpm run start    # watch mode with live reload into Zotero
pnpm run lint     # prettier and eslint
```

## Release

Bump `version` in `package.json`, commit, tag, push. The GitHub Action builds the XPI, publishes the release, and updates `update.json`.

```bash
git commit -am "chore: bump version to X.Y.Z"
git tag vX.Y.Z
git push origin main vX.Y.Z
```

## License

[EUPL v1.2](LICENSE).
