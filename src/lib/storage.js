// chrome.storage wrappers. Settings live in `sync` so they follow the profile;
// the watchlist and cached prices live in `local` because they get big and
// churn often. The ITAD API key is the exception: it is a secret, so it lives
// in `local` only — `sync` data is uploaded to the user's Google account and
// synced across devices, which is not where a plaintext API key belongs.

import { DEFAULT_SETTINGS } from './constants.js';

const SETTINGS_KEY = 'settings';
// On-device-only key for the ITAD API key (see header comment).
const ITAD_KEY = 'itadKey';
const WATCH_KEY = 'watchlist';
const CACHE_KEY = 'priceCache';
// Bumped when the cached shape changes (fx.js has swapped rate providers
// twice — open.er-api.com's {rates,...} then CBSL's {rate,series,...} — both
// incompatible with the current {rate,backstop,...} shape). Storing the
// schema alongside the record means an old-shaped leftover from a prior
// install is detected and discarded instead of being trusted at face value.
const FX_KEY = 'fxCache';
const FX_SCHEMA = 3;

/** Deep-merge stored settings over defaults so new keys appear on upgrade. */
function mergeSettings(stored) {
  const s = structuredClone(DEFAULT_SETTINGS);
  if (!stored) return s;
  for (const [k, v] of Object.entries(stored)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && s[k]) {
      Object.assign(s[k], v);
    } else if (v !== undefined) {
      s[k] = v;
    }
  }
  return s;
}

export async function getSettings() {
  const { [SETTINGS_KEY]: stored } = await chrome.storage.sync.get(SETTINGS_KEY);
  const { [ITAD_KEY]: localKey } = await chrome.storage.local.get(ITAD_KEY);
  let key = typeof localKey === 'string' ? localKey : '';
  // One-time migration: a key saved in sync by an older version is moved to
  // local storage and scrubbed from sync, so it stops being uploaded/synced.
  if (stored?.itad?.key) {
    if (!key) {
      key = stored.itad.key;
      await chrome.storage.local.set({ [ITAD_KEY]: key });
    }
    await chrome.storage.sync.set({
      [SETTINGS_KEY]: { ...stored, itad: { ...stored.itad, key: '' } },
    });
  }
  const merged = mergeSettings(stored);
  merged.itad = { ...merged.itad, key };
  return merged;
}

export async function setSettings(patch) {
  const { itad, ...rest } = patch || {};
  if (itad && typeof itad.key === 'string') {
    // Route the secret to on-device-only storage; it never touches sync.
    await chrome.storage.local.set({ [ITAD_KEY]: itad.key });
  }
  const current = await getSettings();
  const next = mergeSettings({ ...current, ...rest });
  next.itad = { ...next.itad, key: '' }; // never persist the key in sync
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return { ...next, itad: { ...next.itad, key: itad?.key ?? current.itad.key ?? '' } };
}

export async function getWatchlist() {
  const { [WATCH_KEY]: list } = await chrome.storage.local.get(WATCH_KEY);
  return Array.isArray(list) ? list : [];
}

export async function saveWatchlist(list) {
  await chrome.storage.local.set({ [WATCH_KEY]: list });
  return list;
}

export async function getFxCache() {
  const { [FX_KEY]: fx } = await chrome.storage.local.get(FX_KEY);
  // A record from a previous fx.js provider has a different shape (no
  // singular `.rate`, or an old `.rate` under different semantics) — treat
  // anything not stamped with the current schema as if there were no cache.
  if (!fx || fx.schema !== FX_SCHEMA || typeof fx.rate !== 'number') return null;
  return fx;
}

export async function setFxCache(fx) {
  await chrome.storage.local.set({ [FX_KEY]: { ...fx, schema: FX_SCHEMA } });
}

export async function getCache(key) {
  const { [CACHE_KEY]: cache } = await chrome.storage.local.get(CACHE_KEY);
  return cache?.[key] || null;
}

export async function putCache(key, value) {
  const { [CACHE_KEY]: cache } = await chrome.storage.local.get(CACHE_KEY);
  const next = cache || {};
  next[key] = value;

  // Keep the cache from growing without bound.
  const entries = Object.entries(next);
  if (entries.length > 400) {
    entries.sort((a, b) => (b[1]?.fetchedAt || 0) - (a[1]?.fetchedAt || 0));
    const trimmed = Object.fromEntries(entries.slice(0, 300));
    await chrome.storage.local.set({ [CACHE_KEY]: trimmed });
    return;
  }
  await chrome.storage.local.set({ [CACHE_KEY]: next });
}
