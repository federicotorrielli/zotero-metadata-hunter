export function getString(
  key: string,
  params?: Record<string, string | number>,
): string {
  const strings: Record<string, string> = {
    "toolbar.label": "Find DOIs & Abstracts",
    "toolbar.tooltip": "Find missing DOIs and abstracts (Ctrl+Alt+D)",
    "toolbar.cancel": "Cancel Operation",
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

    "enrich.menu.library": "Enrich Metadata of Library",
    "enrich.menu.selected": "Enrich Metadata",
    "enrich.title": "Metadata Enrichment",
    "enrich.noneEligible":
      "No regular items needing enrichment were found. Preprints are skipped (use the preprint flow instead) and items already complete are not re-processed.",
    "enrich.noneEligibleSelected":
      "None of the selected items can be enriched. Preprints are skipped and only regular items are eligible.",
    "enrich.noneEnriched":
      "Checked ${total} item(s); no richer records were available beyond what was already stored.",
    "enrich.found":
      "Enriched ${enriched} of ${total} item(s), filling ${fields} field(s) in total.",
    "enrich.cancelled":
      "Cancelled after ${processed} item(s). Enriched ${enriched} item(s), filling ${fields} field(s).",
    "enrich.taggedNoDOI":
      '\n\n${count} item(s) tagged with "${tag}" because no DOI could be found, which is required for enrichment.',
    "enrich.taggedNoRicher":
      '\n\n${count} item(s) tagged with "${tag}" because the lookup returned no improvements over what is already stored.',
    "enrich.taggedFailed":
      '\n\n${count} item(s) tagged with "${tag}" because the metadata lookup or merge failed.',
    "enrich.apiWarning":
      "\n\nNote: some API requests failed, results may be incomplete.",
    "enrich.progress.title": "Enriching Metadata",
    "enrich.progress.hint": "Press Ctrl+Alt+M to cancel",
    "enrich.progress.item":
      "Processing ${current}/${total} (${percent}%) • ${enriched} enriched, ${fields} fields filled${eta}",
  };

  let str = strings[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`\${${k}}`, String(v));
    }
  }

  return str;
}
