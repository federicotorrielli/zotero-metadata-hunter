// Bootstrapped plugin entry point for Zotero 7/8
// See: https://www.zotero.org/support/dev/zotero_7_for_developers

var DOIFinder;

async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;
  Services.scriptloader.loadSubScript(rootURI + "content/scripts/index.js");
  DOIFinder = Zotero.DOIFinder;
  await DOIFinder.startup({ id, version, rootURI });
}

function shutdown(data, reason) {
  if (DOIFinder) {
    DOIFinder.shutdown();
    DOIFinder = null;
  }
  delete Zotero.DOIFinder;
}

function install(data, reason) {}
function uninstall(data, reason) {}

function onMainWindowLoad({ window }) {
  DOIFinder?.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
  DOIFinder?.onMainWindowUnload(window);
}
