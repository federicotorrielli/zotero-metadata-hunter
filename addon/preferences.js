// Preferences pane, auto-saved on every edit. The pref names below must match
// BATCH_PREF and DBLP_HOST_PREF in src/index.ts.
(() => {
  const BATCH_PREF = "extensions.zotero.metadatahunter.batchSize";
  const DBLP_HOST_PREF = "extensions.zotero.metadatahunter.dblpHost";
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

  const init = () => {
    const range = document.getElementById("metadatahunter-pref-batch-range");
    const number = document.getElementById("metadatahunter-pref-batch-number");
    const dblpHost = document.getElementById("metadatahunter-pref-dblp-host");
    if (!range || !number || !dblpHost) {
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

    try {
      dblpHost.value = Services.prefs.getStringPref(DBLP_HOST_PREF, "");
    } catch (e) {
      /* default */
    }

    // Stored as typed, apart from the surrounding spaces. A missing scheme and
    // a trailing slash are handled in src/index.ts, so both forms of the same
    // address work.
    dblpHost.addEventListener("change", () => {
      const value = dblpHost.value.trim();
      dblpHost.value = value;
      try {
        Services.prefs.setStringPref(DBLP_HOST_PREF, value);
      } catch (e) {
        debug("failed to save dblpHost pref: " + e);
      }
    });
  };

  init();
})();
