# Zotero DOI Finder

A Zotero plugin that automatically finds and adds missing DOI numbers and abstracts to your references using CrossRef, Semantic Scholar, PubMed, and OpenAlex APIs.

## Features

- **Automatic DOI Discovery**: Searches CrossRef for missing DOIs using title and author information
- **Abstract Finder**: Fetches missing abstracts via Semantic Scholar, PubMed, and OpenAlex (waterfall fallback)
- **Smart Matching**: Uses fuzzy title matching (Levenshtein distance) to ensure accurate results
- **Bulk Processing**: Process entire collections or libraries at once
- **Native Zotero Integration**: Integrates with Zotero 7/8's interface

## Installation

1. Download the latest `.xpi` file from the [Releases](https://github.com/federicotorrielli/zotero-doi-finder/releases) page
2. Open Zotero
3. Go to Tools → Add-ons
4. Click the gear icon and select "Install Add-on From File..."
5. Select the downloaded `.xpi` file

## Usage

### Selected items
1. Select one or more items in your library
2. Right-click and choose "Find DOI and Abstract"

### Entire library / collection
1. Go to **Tools → Find DOIs and Abstracts in Library**
2. Or click the toolbar button
3. Or use the keyboard shortcut: `Ctrl/Cmd + Alt + D`

If items are selected, only those are processed; otherwise the current collection or full library is used.

## How It Works

1. For each item missing a DOI: queries CrossRef with the title, first author, and year, then verifies the match with title similarity scoring (threshold: 0.85)
2. For each item missing an abstract: tries Semantic Scholar → PubMed → OpenAlex in order, stopping at the first result

## Development

### Prerequisites
- Node.js (v16 or higher)
- Zotero 7 or 8

### Setup
```bash
git clone https://github.com/federicotorrielli/zotero-doi-finder.git
cd zotero-doi-finder
npm install
npm run build
```

### Releasing
Tag a commit and push — the GitHub Action handles building the XPI and publishing the release:
```bash
git tag v1.0.0
git push origin v1.0.0
```

## License

AGPL-3.0 — see the LICENSE file for details.

## Author

Federico Torrielli — evilscript@protonmail.com
