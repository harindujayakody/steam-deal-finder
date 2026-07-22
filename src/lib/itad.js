// IsThereAnyDeal API v2. Entirely optional — every function degrades to a null
// result when no key is configured, and callers must treat it that way.
//
// Get a key at https://isthereanydeal.com/apps/my/ (register an app, free).
//
// Flow: Steam appid -> ITAD game UUID (/games/lookup/v1), then UUID -> either
// a price history (/games/history/v2, scoped to Steam's own listing and the
// last six months) or current prices across every store ITAD tracks
// (/games/prices/v3), depending what the caller needs.

import { ITAD_API, ITAD_STEAM_SHOP_ID, OTHER_STORE_SHOP_IDS } from './constants.js';

const lookupCache = new Map(); // appid -> uuid|null, per service-worker lifetime

export function hasKey(settings) {
  return !!settings?.itad?.key?.trim();
}

/**
 * Format a Date the way ITAD's own API emits timestamps — e.g.
 * "2022-12-27T11:21:08+01:00": whole seconds, no milliseconds, a numeric
 * UTC offset rather than the "Z" shorthand. `Date#toISOString()` produces
 * milliseconds + "Z" ("...11:21:08.123Z"), which their `since` parser on
 * /games/history/v2 rejects with "Invalid 'since' format" (confirmed live —
 * this isn't a documented constraint, just how their parser behaves).
 */
export function toItadDateTime(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

async function itadFetch(path, { key, query = {}, body = null }) {
  const url = new URL(ITAD_API + path);
  url.searchParams.set('key', key);
  for (const [k, v] of Object.entries(query)) {
    if (v != null) url.searchParams.set(k, v);
  }
  const res = await fetch(url, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  if (res.ok) return res.json();

  // ITAD's error body is {status_code, reason_phrase} — surface the actual
  // reason rather than just the HTTP status, since a bare "HTTP 400" gives no
  // way to tell a malformed request apart from, say, an endpoint that needs
  // explicit approval on this key (ITAD's docs note some endpoints do).
  let reason = '';
  try { reason = (await res.json())?.reason_phrase || ''; } catch { /* not JSON */ }

  if (res.status === 401 || res.status === 403) {
    throw new Error(reason || 'ITAD rejected the API key');
  }
  throw new Error(`ITAD HTTP ${res.status}${reason ? `: ${reason}` : ''}`);
}

/** Confirm a key works. Used by the options page. */
export async function testKey(key) {
  try {
    const json = await itadFetch('/games/lookup/v1', { key, query: { appid: 1174180 } });
    return { ok: !!json?.found, error: null };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/** Steam appid -> ITAD game UUID, or null if ITAD doesn't know it. */
export async function lookupByAppId(appid, key) {
  if (lookupCache.has(appid)) return lookupCache.get(appid);
  try {
    const json = await itadFetch('/games/lookup/v1', { key, query: { appid } });
    const id = json?.found ? json.game?.id ?? null : null;
    lookupCache.set(appid, id);
    return id;
  } catch {
    return null;
  }
}

/**
 * Steam's own price-change history for one game, since a given date.
 * @param {string} gameId ITAD UUID
 * @param {string} key
 * @param {Date} since
 * @param {string} country ISO alpha-2, uppercase
 * @returns {Promise<Array<{timestamp:string, price:number, regular:number,
 *                          currency:string, cut:number}>>}
 */
export async function fetchSteamHistory(gameId, key, since, country = 'US') {
  const json = await itadFetch('/games/history/v2', {
    key,
    query: { id: gameId, country, shops: ITAD_STEAM_SHOP_ID, since: toItadDateTime(since) }
  });
  return (Array.isArray(json) ? json : [])
    .filter((row) => row.deal?.price?.amount != null)
    .map((row) => ({
      timestamp: row.timestamp,
      price: row.deal.price.amount,
      regular: row.deal.regular?.amount ?? row.deal.price.amount,
      currency: row.deal.price.currency,
      cut: row.deal.cut || 0
    }));
}

/**
 * One-shot: Steam appid -> the cheapest point in its last-6-months Steam
 * history, or null if ITAD has no record / no key is configured.
 */
export async function fetchSixMonthLow(appid, key, since, country = 'US') {
  const uuid = await lookupByAppId(appid, key);
  if (!uuid) return { unknownGame: true };

  const history = await fetchSteamHistory(uuid, key, since, country);
  if (!history.length) return { history: [] };

  const low = history.reduce((min, row) => (row.price < min.price ? row : min), history[0]);
  return { history, low };
}

/**
 * Current price at each requested store for one game — /games/prices/v3
 * is a POST with a JSON array body (game UUIDs), not query params like the
 * other endpoints here.
 * @param {string} gameId ITAD UUID
 * @param {string} key
 * @param {string} country ISO alpha-2, uppercase
 * @param {number[]} [shopIds] restrict to these ITAD shop ids; omit for all
 * @returns {Promise<Array<{shopId:number, shopName:string, price:number,
 *                          regular:number, currency:string, cut:number,
 *                          url:string}>>}
 */
export async function fetchAllStorePrices(gameId, key, country = 'US', shopIds = null) {
  const query = { country };
  if (shopIds?.length) query.shops = shopIds.join(',');
  const json = await itadFetch('/games/prices/v3', { key, query, body: [gameId] });
  const row = Array.isArray(json) ? json[0] : null;
  if (!row?.deals) return [];
  return row.deals
    .filter((d) => d.price?.amount != null)
    .map((d) => ({
      shopId: d.shop?.id,
      shopName: d.shop?.name || 'Unknown store',
      price: d.price.amount,
      regular: d.regular?.amount ?? d.price.amount,
      currency: d.price.currency,
      cut: d.cut || 0,
      url: d.url
    }));
}

/**
 * One-shot: Steam appid -> the cheapest deals among the curated store list
 * (OTHER_STORE_SHOP_IDS — Steam itself is never in that set, since that
 * price is already shown as the headline), or null if ITAD has no record /
 * no key is configured. Games are commonly not listed at all five — EA and
 * Battle.net especially have very thin ITAD coverage — so this can return
 * fewer than `limit`, or none.
 * @param {number} limit how many cheapest deals to keep
 */
export async function fetchOtherStoreDeals(appid, key, country = 'US', limit = 3) {
  const uuid = await lookupByAppId(appid, key);
  if (!uuid) return { unknownGame: true };

  const shopIds = Object.keys(OTHER_STORE_SHOP_IDS).map(Number);
  const all = await fetchAllStorePrices(uuid, key, country, shopIds);
  const others = all.sort((a, b) => a.price - b.price).slice(0, limit);
  return { deals: others };
}
