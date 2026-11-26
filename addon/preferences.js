// Preferences pane, auto-saved on every edit. The pref names below must match
// BATCH_PREF, DBLP_HOST_PREF and S2_KEY_PREF in src/prefs.ts.
(() => {
  const BATCH_PREF = "extensions.zotero.metadatahunter.batchSize";
  const DBLP_HOST_PREF = "extensions.zotero.metadatahunter.dblpHost";
  const S2_KEY_PREF = "extensions.zotero.metadatahunter.semanticScholarKey";
  const DEFAULT = 2;
  const MIN = 1;
  const MAX = 12;

  const debug = (message) => {
    if (typeof Zotero !== "undefined" && Zotero.debug) {
      Zotero.debug("Metadata Hunter: " + message);
    }
  };

  const clamp = (value) => {
    const n = parseInt(value, 10);
    return Math.min(Math.max(isNaN(n) ? DEFAULT : n, MIN), MAX);
  };

  const bindText = (input, pref) => {
    try {
      input.value = Services.prefs.getStringPref(pref, "");
    } catch (e) {
      /* default */
    }
    input.addEventListener("change", () => {
      const value = input.value.trim();
      input.value = value;
      try {
        Services.prefs.setStringPref(pref, value);
      } catch (e) {
        debug("failed to save " + pref + ": " + e);
      }
    });
  };

  const init = () => {
    const range = document.getElementById("metadatahunter-pref-batch-range");
    const number = document.getElementById("metadatahunter-pref-batch-number");
    const dblpHost = document.getElementById("metadatahunter-pref-dblp-host");
    const s2Key = document.getElementById("metadatahunter-pref-s2-key");
    if (!range || !number || !dblpHost || !s2Key) {
      window.setTimeout(init, 50); // pane DOM not ready yet
      return;
    }

    let current = DEFAULT;
    try {
      current = clamp(Services.prefs.getIntPref(BATCH_PREF, DEFAULT));
    } catch (e) {
      /* default */
    }
    range.value = current;
    number.value = current;

    const save = (value) => {
      const v = clamp(value);
      range.value = v;
      number.value = v;
      try {
        Services.prefs.setIntPref(BATCH_PREF, v);
      } catch (e) {
        debug("failed to save batchSize pref: " + e);
      }
    };

    range.addEventListener("input", () => {
      number.value = range.value;
    });
    range.addEventListener("change", () => save(range.value));
    number.addEventListener("change", () => save(number.value));

    // Stored as typed, apart from the surrounding spaces. src/prefs.ts adds a
    // missing scheme to the DBLP host and removes a trailing slash. Therefore
    // both forms of the same address work.
    bindText(dblpHost, DBLP_HOST_PREF);
    bindText(s2Key, S2_KEY_PREF);
  };

  init();
})();
