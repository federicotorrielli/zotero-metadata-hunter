import { config } from "../package.json";

// The names and bounds below are repeated in addon/preferences.js, which is not
// bundled. A test keeps the two in step.
export const BATCH_PREF = `${config.prefsPrefix}.batchSize`;
export const DBLP_HOST_PREF = `${config.prefsPrefix}.dblpHost`;
export const DEFAULT_BATCH = 2;
export const MIN_BATCH = 1;
export const MAX_BATCH = 12;

export interface Prefs {
  getInt(name: string, fallback: number): number;
  getString(name: string, fallback: string): string;
}

// Parallel items per batch, set in the preferences pane.
export function readBatchSize(prefs: Prefs): number {
  try {
    const value = prefs.getInt(BATCH_PREF, DEFAULT_BATCH);
    return Math.min(Math.max(value, MIN_BATCH), MAX_BATCH);
  } catch {
    return DEFAULT_BATCH;
  }
}

// A value without a scheme gets https, and a trailing slash is removed, so
// "dblp.example.org/" and "https://dblp.example.org" mean the same thing.
export function normalizeHost(raw: string): string | null {
  const host = raw.trim();
  if (!host) return null;
  const withScheme = /^https?:\/\//i.test(host) ? host : `https://${host}`;
  return withScheme.replace(/\/+$/, "");
}

export function readUserDblpHost(prefs: Prefs): string | null {
  try {
    return normalizeHost(prefs.getString(DBLP_HOST_PREF, ""));
  } catch {
    return null;
  }
}
