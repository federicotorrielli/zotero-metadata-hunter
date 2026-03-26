// Bootstrapped plugin entry point for Zotero 7/8
// See: https://www.zotero.org/support/dev/zotero_7_for_developers

var MetadataHunter;

async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;
  Services.scriptloader.loadSubScript(rootURI + "content/scripts/index.js");
  MetadataHunter = Zotero.MetadataHunter;
  await MetadataHunter.startup({ id, version, rootURI });
}

function shutdown(data, reason) {
  if (MetadataHunter) {
    MetadataHunter.shutdown();
    MetadataHunter = null;
  }
  delete Zotero.MetadataHunter;
}

function install(data, reason) {}
function uninstall(data, reason) {}

function onMainWindowLoad({ window }) {
  MetadataHunter?.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
  MetadataHunter?.onMainWindowUnload(window);
}
