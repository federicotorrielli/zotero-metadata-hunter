export function getString(key: string, params?: Record<string, string | number>): string {
  const strings: Record<string, string> = {
    "toolbar.label": "Find DOIs & Abstracts",
    "toolbar.tooltip": "Find missing DOIs and abstracts (Ctrl+Alt+D)",
    "toolbar.cancel": "Cancel DOI Finding",
    "toolbar.cancel.tooltip": "Click to cancel the current operation",
    "menu.findDOI": "Find DOI and Abstract",
    "menu.findDOILibrary": "Find DOIs and Abstracts in Library",
    "findDOI.title": "DOI and Abstract Finder",
    "findDOI.allHaveData": "All items already have DOIs and abstracts.",
    "findDOI.allSelectedHaveData": "All selected items already have DOIs and abstracts.",
    "findDOI.noneFound": "No new DOIs or abstracts were found.",
    "findDOI.foundAbstractsOnly": "Found ${abstracts} new abstract(s). No new DOIs were found.",
    "findDOI.foundDOIsOnly": "Found ${dois} new DOI(s). No abstracts were found.",
    "findDOI.found": "Found ${dois} new DOI(s) and ${abstracts} abstract(s) across ${total} items processed.",
    "findDOI.cancelled": "Cancelled after ${processed} item(s). Found ${dois} DOI(s) and ${abstracts} abstract(s).",
    "findDOI.apiWarning": "\n\nNote: some API requests failed — results may be incomplete.",
    "findDOI.progress.title": "Finding DOIs and Abstracts",
    "findDOI.progress.hint": "Press Ctrl+Alt+D or click the toolbar button to cancel",
    "findDOI.progress.item": "Processing ${current}/${total} (${percent}%) • ${dois} DOIs + ${abstracts} abstracts found${eta}",
  };

  let str = strings[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`\${${k}}`, String(v));
    }
  }

  return str;
}
