// Batch-size slider, auto-saved. PREF must match BATCH_PREF in src/index.ts.
(() => {
  const PREF = "extensions.zotero.metadatahunter.batchSize";
  const DEFAULT = 5;
  const MIN = 1;
  const MAX = 12;

  const clamp = (value) => {
    const n = parseInt(value, 10);
    return Math.min(Math.max(isNaN(n) ? DEFAULT : n, MIN), MAX);
  };

  const init = () => {
    const range = document.getElementById("metadatahunter-pref-batch-range");
    const number = document.getElementById("metadatahunter-pref-batch-number");
    if (!range || !number) {
      window.setTimeout(init, 50); // pane DOM not ready yet
      return;
    }

    let current = DEFAULT;
    try {
      current = clamp(Services.prefs.getIntPref(PREF, DEFAULT));
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
        Services.prefs.setIntPref(PREF, v);
      } catch (e) {
        if (typeof Zotero !== "undefined" && Zotero.debug) {
          Zotero.debug("Metadata Hunter: failed to save batchSize pref: " + e);
        }
      }
    };

    range.addEventListener("input", () => {
      number.value = range.value;
    });
    range.addEventListener("change", () => save(range.value));
    number.addEventListener("change", () => save(number.value));
  };

  init();
})();
