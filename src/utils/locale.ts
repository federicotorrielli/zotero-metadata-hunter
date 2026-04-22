export function getString(
  key: string,
  params?: Record<string, string | number>,
): string {
  const strings: Record<string, string> = {
    "toolbar.label": "Find DOIs & Abstracts",
    "toolbar.tooltip": "Find missing DOIs and abstracts (Ctrl+Alt+D)",
    "toolbar.cancel": "Cancel DOI Finding",
    "toolbar.cancel.tooltip": "Click to cancel the current operation",
    "menu.findDOI": "Find DOI and Abstract",
    "menu.findDOILibrary": "Find DOIs and Abstracts in Library",
    "findDOI.title": "DOI and Abstract Finder",
    "findDOI.allHaveData": "All items already have DOIs and abstracts.",
    "findDOI.allSelectedHaveData":
      "All selected items already have DOIs and abstracts.",
    "findDOI.noneFound": "No new DOIs or abstracts were found.",
    "findDOI.foundAbstractsOnly":
      "Found ${abstracts} new abstract(s). No new DOIs were found.",
    "findDOI.foundDOIsOnly":
      "Found ${dois} new DOI(s). No abstracts were found.",
    "findDOI.found":
      "Found ${dois} new DOI(s) and ${abstracts} abstract(s) across ${total} items processed.",
    "findDOI.cancelled":
      "Cancelled after ${processed} item(s). Found ${dois} DOI(s) and ${abstracts} abstract(s).",
    "findDOI.taggedNoDOI":
      '\n\n${count} item(s) tagged with "${tag}" — filter by this tag to review them.',
    "findDOI.apiWarning":
      "\n\nNote: some API requests failed — results may be incomplete.",
    "findDOI.progress.title": "Finding DOIs and Abstracts",
    "findDOI.progress.hint":
      "Press Ctrl+Alt+D or click the toolbar button to cancel",
    "findDOI.progress.item":
      "Processing ${current}/${total} (${percent}%) • ${dois} DOIs + ${abstracts} abstracts found${eta}",

    "preprint.menu.library": "Find Published Versions of Preprints",
    "preprint.menu.selected": "Check for Published Version",
    "preprint.title": "Published Version Finder",
    "preprint.noneFound": "No preprints were found.",
    "preprint.noneFoundSelected": "No preprints were found in the selection.",
    "preprint.noPublished":
      "No published versions were found for ${total} preprint(s) checked.",
    "preprint.found":
      "Found published versions for ${found} of ${total} preprint(s). New items have been added and originals moved to trash.",
    "preprint.migratedChildren":
      "\n\nMoved ${count} attachment(s)/note(s) from the preprint(s) onto the new published item(s).",
    "preprint.taggedNoPublished":
      '\n\n${count} preprint(s) tagged with "${tag}" — filter by this tag to review them.',
    "preprint.taggedFailed":
      '\n\n${count} preprint(s) tagged with "${tag}" — a published version was found but the new item could not be created.',
    "preprint.cancelled":
      "Cancelled after checking ${checked} preprint(s). Found ${found} published version(s).",
    "preprint.apiWarning":
      "\n\nNote: some API requests failed — results may be incomplete.",
    "preprint.progress.title": "Checking Preprints for Published Versions",
    "preprint.progress.hint":
      "Press Ctrl+Alt+P or click the toolbar button to cancel",
    "preprint.progress.item":
      "Checking ${current}/${total} (${percent}%) • ${found} published versions found${eta}",
  };

  let str = strings[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`\${${k}}`, String(v));
    }
  }

  return str;
}
