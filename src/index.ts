import { config, homepage, version } from "../package.json";
import type { Clock } from "./core/batch";
import { RunController } from "./core/cancel";
import { runAction, type Action, type Scope } from "./flows/action";
import { createDOIAction } from "./flows/doi";
import { createEnrichAction } from "./flows/enrich";
import { createPreprintAction } from "./flows/preprints";
import type { FlowDeps, RunStats } from "./flows/shared";
import {
  libraryEntries,
  registerMenus,
  type MenuActions,
} from "./modules/menu";
import { createCardHost, type CardHost } from "./modules/progress";
import { installShortcuts } from "./modules/shortcuts";
import {
  setupWindowToolbar,
  syncToolbarButton,
  teardownWindowToolbar,
  type ToolbarDeps,
} from "./modules/toolbar";
import { createHttp } from "./net/http";
import { readBatchSize, readUserDblpHost, type Prefs } from "./prefs";
import { resolveTargetItems } from "./selection";
import { createDblpPool } from "./sources/dblp";
import { createLookups } from "./sources/lookups";
import { createZoteroApi } from "./zoteroApi";
import {
  getString,
  loadWindowStrings,
  registerStrings,
  unloadWindowStrings,
  unregisterStrings,
} from "./utils/locale";

declare const Zotero: any;
declare const Services: any;
declare const IOUtils: any;

// CrossRef routes requests that carry a contact into its polite pool, which has
// much higher rate limits. The fragment is stripped because a URL is the useful part.
const USER_AGENT = `Zotero Metadata Hunter/${version} (+${homepage.replace(/#.*$/, "")})`;

interface StartupData {
  id: string;
  version: string;
  rootURI: string;
}

type ActionFactory = (deps: FlowDeps, scope: Scope) => Action<RunStats>;

// What the builders below read from Zotero, collected once.
interface Env {
  zotero: any;
  prefs: Prefs;
  log: (message: string) => void;
  cards: CardHost;
}

function createEnv(zotero: any, services: any): Env {
  return {
    zotero,
    log: (message) => zotero.debug(message),
    prefs: {
      getInt: (name, fallback) => services.prefs.getIntPref(name, fallback),
      getString: (name, fallback) =>
        services.prefs.getStringPref(name, fallback),
    },
    cards: createCardHost(
      () => zotero.getMainWindow?.(),
      getString("card-dismiss"),
    ),
  };
}

function createSourceLookups(env: Env, clock: Clock) {
  const { zotero, prefs, log } = env;
  const http = createHttp({
    request: (method, url, options) =>
      zotero.HTTP.request(method, url, options),
    userAgent: USER_AGENT,
    clock,
  });
  return createLookups({
    http,
    parseXml: (text) => new DOMParser().parseFromString(text, "text/xml"),
    dblp: createDblpPool({
      http,
      readUserHost: () => readUserDblpHost(prefs),
      now: Date.now,
      log,
    }),
  });
}

const systemClock: Clock = {
  now: Date.now,
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  after: (ms, fn) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

function createFlowDeps(env: Env): FlowDeps {
  return {
    api: createZoteroApi(
      env.zotero,
      { fileSize: async (path) => (await IOUtils.stat(path)).size },
      env.log,
    ),
    lookups: createSourceLookups(env, systemClock),
    clock: systemClock,
    t: getString,
    log: env.log,
    batchSize: () => readBatchSize(env.prefs),
    createPanel: env.cards.createProgressPanel,
  };
}

// A run starts from the items the user selected, or from the selected rows.
function createLauncher(
  env: Env,
  controller: RunController,
  flowDeps: FlowDeps,
) {
  const actionDeps = {
    controller,
    t: getString,
    showResult: env.cards.showResult,
    log: env.log,
  };
  return (make: ActionFactory, scope: Scope) => async (): Promise<void> => {
    if (controller.isProcessing) return;
    const pane = env.zotero.getActiveZoteroPane();
    const candidates = async () =>
      scope === "library" ? resolveTargetItems(pane) : pane.getSelectedItems();
    await runAction(actionDeps, make(flowDeps, scope), candidates);
  };
}

function createPlugin(zotero: any, services: any) {
  const env = createEnv(zotero, services);
  const controller = new RunController(() => {
    for (const win of zotero.getMainWindows()) syncToolbarButton(win, toolbar);
  });
  const launch = createLauncher(env, controller, createFlowDeps(env));

  const actions: MenuActions = {
    findDOIs: launch(createDOIAction, "library"),
    findPublishedVersions: launch(createPreprintAction, "library"),
    enrichMetadata: launch(createEnrichAction, "library"),
    findDOIsForSelected: launch(createDOIAction, "selection"),
    findPublishedVersionsForSelected: launch(createPreprintAction, "selection"),
    enrichMetadataForSelected: launch(createEnrichAction, "selection"),
  };
  const toolbar: ToolbarDeps = {
    t: getString,
    entries: libraryEntries(actions),
    isProcessing: () => controller.isProcessing,
    stop: () => controller.stop(),
  };
  const shortcuts = {
    d: () => controller.toggle(actions.findDOIs),
    p: () => controller.toggle(actions.findPublishedVersions),
    m: () => controller.toggle(actions.enrichMetadata),
  };
  return { actions, controller, toolbar, shortcuts };
}

type Plugin = ReturnType<typeof createPlugin>;

let plugin: Plugin | null = null;
const removeShortcuts = new WeakMap<Window, () => void>();

Zotero.MetadataHunter = {
  async startup(data: StartupData) {
    Zotero.debug("Metadata Hunter: Startup");
    registerStrings(Zotero.ftl);
    plugin = createPlugin(Zotero, Services);
    Object.assign(Zotero.MetadataHunter, plugin.actions);
    registerMenus(Zotero.MenuManager, data.id, plugin.actions);
    registerPreferencePane(data.id, data.rootURI);
    for (const win of Zotero.getMainWindows()) {
      Zotero.MetadataHunter.onMainWindowLoad(win);
    }
  },

  shutdown() {
    Zotero.debug("Metadata Hunter: Shutdown");
    plugin?.controller.stop();
    // Zotero does not announce the windows when a plugin is disabled or updated,
    // so the toolbar button and the shortcuts are removed here.
    for (const win of Zotero.getMainWindows()) {
      Zotero.MetadataHunter.onMainWindowUnload(win);
    }
    plugin = null;
    unregisterStrings(Zotero.ftl);
  },

  onMainWindowLoad(win: Window) {
    // Zotero and startup() both announce a window, and a second pass must add nothing.
    if (!plugin || removeShortcuts.has(win)) return;
    loadWindowStrings(win);
    setupWindowToolbar(win, plugin.toolbar);
    removeShortcuts.set(win, installShortcuts(win, plugin.shortcuts));
  },

  onMainWindowUnload(win: Window) {
    unloadWindowStrings(win);
    teardownWindowToolbar(win);
    removeShortcuts.get(win)?.();
    removeShortcuts.delete(win);
  },

  get isProcessing() {
    return plugin?.controller.isProcessing ?? false;
  },
};

// Zotero removes the pane when the plugin shuts down.
function registerPreferencePane(pluginID: string, rootURI: string): void {
  Zotero.PreferencePanes?.register?.({
    pluginID,
    id: `${config.addonRef}-prefs`,
    label: config.addonName,
    src: rootURI + "preferences.xhtml",
    scripts: [rootURI + "preferences.js"],
  });
}
