export function getString(
  key: string,
  params?: Record<string, string | number>,
): string {
  const strings: Record<string, string> = {
    // Shared tails. Both read the same in every flow, so they live once here
    // and take the unit as a parameter.
    "common.skipped":
      "\n\n${count} ${unit} could not be checked because a source did not answer. This is usually a rate limit. Those items were left untagged. Run the same action again later to retry them.",
    "common.apiWarning":
      "\n\nSome requests failed. The counts above may be incomplete.",

    "toolbar.label": "Find DOIs and Abstracts",
    "toolbar.tooltip": "Find missing DOIs and abstracts (Ctrl+Alt+D)",
    "toolbar.cancel": "Stop",
    "toolbar.cancel.tooltip": "Stop the run in progress",
    "menu.findDOI": "Find DOI and Abstract",
    "menu.findDOILibrary": "Find DOIs and Abstracts in Library",

    "findDOI.title": "Find DOIs and Abstracts",
    "findDOI.allHaveData":
      "Every item already has a DOI and an abstract. There is nothing to do.",
    "findDOI.allSelectedHaveData":
      "Every selected item already has a DOI and an abstract. There is nothing to do.",
    "findDOI.noneFound":
      "Checked ${total} item(s). No new DOIs or abstracts were found.",
    "findDOI.foundAbstractsOnly":
      "Checked ${total} item(s). Added ${abstracts} abstract(s). No new DOIs were found.",
    "findDOI.foundDOIsOnly":
      "Checked ${total} item(s). Added ${dois} DOI(s). No new abstracts were found.",
    "findDOI.found":
      "Checked ${total} item(s). Added ${dois} DOI(s) and ${abstracts} abstract(s).",
    "findDOI.cancelled":
      "Stopped after ${processed} item(s). Added ${dois} DOI(s) and ${abstracts} abstract(s).",
    "findDOI.taggedNoDOI":
      '\n\nNo source had a DOI for ${count} item(s). They now carry the tag "${tag}". Select that tag in the tag pane to review them.',
    "findDOI.progress.title": "Finding DOIs and Abstracts",
    "findDOI.progress.hint":
      "Press Ctrl+Alt+D or click the toolbar button to stop",
    "findDOI.progress.item":
      "Item ${current} of ${total} (${percent}%). Found ${dois} DOIs and ${abstracts} abstracts.${eta}",

    "preprint.menu.library": "Find Published Versions of Preprints",
    "preprint.menu.selected": "Check for Published Version",
    "preprint.title": "Find Published Versions",
    "preprint.noneFound": "No preprints were found.",
    "preprint.noneFoundSelected": "No preprints were found in the selection.",
    "preprint.noPublished":
      "Checked ${total} preprint(s). No published versions were found.",
    "preprint.found":
      "Checked ${total} preprint(s). Found a published version for ${found} of them. The new items are in your library. The preprints they replace were moved to the trash.",
    "preprint.migratedChildren":
      "\n\nMoved ${count} attachment(s) and note(s) onto the new items, so nothing of yours was left in the trash.",
    "preprint.convertedToPreprint":
      '\n\nChanged ${count} generic "document" item(s) to the "preprint" item type.',
    "preprint.taggedNoPublished":
      '\n\nNo published version was found for ${count} preprint(s). They now carry the tag "${tag}".',
    "preprint.taggedFailed":
      '\n\nA published version was found for ${count} preprint(s), but the new item could not be created from it. They now carry the tag "${tag}".',
    "preprint.cancelled":
      "Stopped after ${checked} preprint(s). Found ${found} published version(s).",
    "preprint.progress.title": "Checking Preprints for Published Versions",
    "preprint.progress.hint":
      "Press Ctrl+Alt+P or click the toolbar button to stop",
    "preprint.progress.item":
      "Preprint ${current} of ${total} (${percent}%). Found ${found} published versions.${eta}",

    "enrich.menu.library": "Enrich Metadata of Library",
    "enrich.menu.selected": "Enrich Metadata",
    "enrich.title": "Enrich Metadata",
    "enrich.noneEligible":
      "No items need enrichment. Items that already have full metadata are skipped. Preprints are skipped as well, because the published version finder handles those.",
    "enrich.noneEligibleSelected":
      "None of the selected items can be enriched. Only regular items are eligible. Preprints are skipped, because the published version finder handles those.",
    "enrich.noneEnriched":
      "Checked ${total} item(s). No source held a richer record than the one already stored.",
    "enrich.found":
      "Checked ${total} item(s). Enriched ${enriched} of them, filling ${fields} field(s).",
    "enrich.cancelled":
      "Stopped after ${processed} item(s). Enriched ${enriched} of them, filling ${fields} field(s).",
    "enrich.taggedNoDOI":
      '\n\nNo DOI could be found for ${count} item(s). Enrichment needs a DOI to look the record up. They now carry the tag "${tag}".',
    "enrich.taggedNoRicher":
      '\n\nThe lookup returned nothing new for ${count} item(s). They now carry the tag "${tag}".',
    "enrich.taggedFailed":
      '\n\nThe lookup or the merge failed for ${count} item(s). They now carry the tag "${tag}".',
    "enrich.progress.title": "Enriching Metadata",
    "enrich.progress.hint":
      "Press Ctrl+Alt+M or click the toolbar button to stop",
    "enrich.progress.item":
      "Item ${current} of ${total} (${percent}%). Enriched ${enriched}, filled ${fields} fields.${eta}",
  };

  let str = strings[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`\${${k}}`, String(v));
    }
  }

  return str;
}
