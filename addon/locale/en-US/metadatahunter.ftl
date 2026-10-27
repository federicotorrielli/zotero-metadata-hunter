## Metadata Hunter strings. Every id carries the "metadatahunter-" prefix.
## src/utils/locale.ts adds it, so code calls getString("find-doi-found").

## Tails shared by the three flows.

metadatahunter-common-skipped-items = { $count ->
    [one] 1 item
   *[other] { $count } items
} could not be checked. Not one source answered for { $count ->
    [one] it
   *[other] them
}. { $count ->
    [one] It was
   *[other] They were
} left untagged. Run the same action again later to retry.
metadatahunter-common-skipped-preprints = { $count ->
    [one] 1 preprint
   *[other] { $count } preprints
} could not be checked. Not one source answered for { $count ->
    [one] it
   *[other] them
}. { $count ->
    [one] It was
   *[other] They were
} left untagged. Run the same action again later to retry.
metadatahunter-common-source-failures = Sources that failed at least once during this run: { $sources }. This is usually a rate limit. Results may be less complete than usual.
metadatahunter-common-run-failed = The run stopped because of an error: { $error }
metadatahunter-common-api-warning = Some requests failed. The counts above may be incomplete.

metadatahunter-eta-seconds = About { $count ->
    [one] 1 second
   *[other] { $count } seconds
} left.
metadatahunter-eta-minutes = About { $count ->
    [one] 1 minute
   *[other] { $count } minutes
} left.

metadatahunter-card-dismiss = Dismiss

## Toolbar

metadatahunter-toolbar-label = Metadata Hunter
metadatahunter-toolbar-tooltip = Find DOIs, published versions of preprints, and richer metadata
metadatahunter-toolbar-cancel = Stop
metadatahunter-toolbar-cancel-tooltip = Stop the run in progress

## Menus. These carry only a label, because MenuManager sets it as an attribute.

metadatahunter-menu-find-doi-library =
    .label = Find DOIs and Abstracts in Library
metadatahunter-menu-preprint-library =
    .label = Find Published Versions of Preprints
metadatahunter-menu-enrich-library =
    .label = Enrich Metadata of Library
metadatahunter-menu-find-doi =
    .label = Find DOI and Abstract
metadatahunter-menu-preprint =
    .label = Check for Published Version
metadatahunter-menu-enrich =
    .label = Enrich Metadata

## Find DOIs and abstracts

metadatahunter-find-doi-title = Find DOIs and Abstracts
metadatahunter-find-doi-all-have-data = Every item already has a DOI and an abstract. There is nothing to do.
metadatahunter-find-doi-all-selected-have-data = Every selected item already has a DOI and an abstract. There is nothing to do.
metadatahunter-find-doi-none-found = Checked { $total ->
    [one] 1 item
   *[other] { $total } items
}. No new DOIs or abstracts were found.
metadatahunter-find-doi-found-abstracts-only = Checked { $total ->
    [one] 1 item
   *[other] { $total } items
}. Added { $abstracts ->
    [one] 1 abstract
   *[other] { $abstracts } abstracts
}. No new DOIs were found.
metadatahunter-find-doi-found-dois-only = Checked { $total ->
    [one] 1 item
   *[other] { $total } items
}. Added { $dois ->
    [one] 1 DOI
   *[other] { $dois } DOIs
}. No new abstracts were found.
metadatahunter-find-doi-found = Checked { $total ->
    [one] 1 item
   *[other] { $total } items
}. Added { $dois ->
    [one] 1 DOI
   *[other] { $dois } DOIs
} and { $abstracts ->
    [one] 1 abstract
   *[other] { $abstracts } abstracts
}.
metadatahunter-find-doi-cancelled = Stopped after { $processed ->
    [one] 1 item
   *[other] { $processed } items
}. Added { $dois ->
    [one] 1 DOI
   *[other] { $dois } DOIs
} and { $abstracts ->
    [one] 1 abstract
   *[other] { $abstracts } abstracts
}.
metadatahunter-find-doi-tagged-no-doi = No source had a DOI for { $count ->
    [one] 1 item
   *[other] { $count } items
}. { $count ->
    [one] It now carries
   *[other] They now carry
} the tag "{ $tag }". Select that tag in the tag pane to review { $count ->
    [one] it
   *[other] them
}.
metadatahunter-find-doi-progress-title = Finding DOIs and Abstracts
metadatahunter-find-doi-progress-hint = Press Ctrl+Alt+D or choose Stop in the toolbar menu
metadatahunter-find-doi-progress-item = Item { $current } of { $total } ({ $percent }%). Found { $dois ->
    [one] 1 DOI
   *[other] { $dois } DOIs
} and { $abstracts ->
    [one] 1 abstract
   *[other] { $abstracts } abstracts
}.

## Find published versions of preprints

metadatahunter-preprint-title = Find Published Versions
metadatahunter-preprint-none-found = No preprints were found.
metadatahunter-preprint-none-found-selected = No preprints were found in the selection.
metadatahunter-preprint-no-published = Checked { $total ->
    [one] 1 preprint
   *[other] { $total } preprints
}. No published versions were found.
metadatahunter-preprint-found = Checked { $total ->
    [one] 1 preprint
   *[other] { $total } preprints
}. Found a published version for { $found } of them. The new items are in your library. The preprints they replace were moved to the trash.
metadatahunter-preprint-migrated-children = Moved { $count ->
    [one] 1 attachment or note
   *[other] { $count } attachments and notes
} onto the new items, so nothing of yours was left in the trash.
metadatahunter-preprint-trashed-attachments = Moved { $count ->
    [one] 1 attachment
   *[other] { $count } attachments
} to the trash, because { $count ->
    [one] its file was
   *[other] their files were
} missing or empty.
metadatahunter-preprint-converted-to-preprint = Changed { $count ->
    [one] 1 generic "document" item
   *[other] { $count } generic "document" items
} to the "preprint" item type.
metadatahunter-preprint-tagged-no-published = No published version was found for { $count ->
    [one] 1 preprint
   *[other] { $count } preprints
}. { $count ->
    [one] It now carries
   *[other] They now carry
} the tag "{ $tag }".
metadatahunter-preprint-tagged-failed = A published version was found for { $count ->
    [one] 1 preprint
   *[other] { $count } preprints
}, but the new item could not be created from it. { $count ->
    [one] It now carries
   *[other] They now carry
} the tag "{ $tag }".
metadatahunter-preprint-cancelled = Stopped after { $checked ->
    [one] 1 preprint
   *[other] { $checked } preprints
}. Found { $found ->
    [one] 1 published version
   *[other] { $found } published versions
}.
metadatahunter-preprint-progress-title = Checking Preprints for Published Versions
metadatahunter-preprint-progress-hint = Press Ctrl+Alt+P or choose Stop in the toolbar menu
metadatahunter-preprint-progress-item = Preprint { $current } of { $total } ({ $percent }%). Found { $found ->
    [one] 1 published version
   *[other] { $found } published versions
}.

## Enrich metadata

metadatahunter-enrich-title = Enrich Metadata
metadatahunter-enrich-none-eligible = No items need enrichment. Items that already have full metadata are skipped. Preprints are skipped as well, because the published version finder handles those.
metadatahunter-enrich-none-eligible-selected = None of the selected items can be enriched. Only regular items are eligible. Preprints are skipped, because the published version finder handles those.
metadatahunter-enrich-none-enriched = Checked { $total ->
    [one] 1 item
   *[other] { $total } items
}. No source held a richer record than the one already stored.
metadatahunter-enrich-found = Checked { $total ->
    [one] 1 item
   *[other] { $total } items
}. Enriched { $enriched } of them, filling { $fields ->
    [one] 1 field
   *[other] { $fields } fields
}.
metadatahunter-enrich-cancelled = Stopped after { $processed ->
    [one] 1 item
   *[other] { $processed } items
}. Enriched { $enriched }, filling { $fields ->
    [one] 1 field
   *[other] { $fields } fields
}.
metadatahunter-enrich-tagged-no-doi = No DOI could be found for { $count ->
    [one] 1 item
   *[other] { $count } items
}. Enrichment needs a DOI to look the record up. { $count ->
    [one] It now carries
   *[other] They now carry
} the tag "{ $tag }".
metadatahunter-enrich-tagged-no-richer = The lookup returned nothing new for { $count ->
    [one] 1 item
   *[other] { $count } items
}. { $count ->
    [one] It now carries
   *[other] They now carry
} the tag "{ $tag }".
metadatahunter-enrich-tagged-failed = The lookup or the merge failed for { $count ->
    [one] 1 item
   *[other] { $count } items
}. { $count ->
    [one] It now carries
   *[other] They now carry
} the tag "{ $tag }".
metadatahunter-enrich-progress-title = Enriching Metadata
metadatahunter-enrich-progress-hint = Press Ctrl+Alt+M or choose Stop in the toolbar menu
metadatahunter-enrich-progress-item = Item { $current } of { $total } ({ $percent }%). Enriched { $enriched }, filled { $fields ->
    [one] 1 field
   *[other] { $fields } fields
}.

## Preferences pane

metadatahunter-prefs-subtitle = Find missing DOIs, abstracts, and published versions of preprints.
metadatahunter-prefs-section-settings = Settings
metadatahunter-prefs-batch-label = Concurrent batch size
metadatahunter-prefs-batch-hint = Items processed in parallel per batch. Higher is faster but hits the metadata APIs harder. Default is 2.
metadatahunter-prefs-dblp-label = DBLP server
metadatahunter-prefs-dblp-input =
    .placeholder = https://dblp.example.org
metadatahunter-prefs-dblp-hint = Optional. A DBLP of your own, used before all the others. Leave it empty and the plugin uses dblp.federicotorrielli.me. When that server does not reply, the plugin sends one small search request to dblp.org, dblp.dagstuhl.de, and dblp.uni-trier.de, then keeps the first that replies for the rest of the session. A server that fails later in the session is set aside and the next one takes over.
