// Steam storefront API access.
//
// Two endpoints do the work:
//   /api/appdetails?appids=A,B,C&filters=price_overview&cc=XX
//   /api/packagedetails?packageids=A,B,C&cc=XX
// Both are keyless and honour `cc`, which is what makes cross-region comparison
// possible at all. Neither covers /bundle/ pages — Steam exposes no public
// bundle price API — so bundles are handled from the page DOM instead.
//
// Steam throttles roughly 200 requests per 5 minutes per IP. Batching by appid
// keeps watchlist polling to one request; region surveys are the expensive path
// and run only on demand, spaced by a small delay.

import { STEAM_API } from './constants.js';

const REGION_DELAY_MS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Parse a Steam store URL into a tracking target. */
export function parseTarget(url) {
  if (!url) return null;
  let m = url.match(/store\.steampowered\.com\/app\/(\d+)/);
  if (m) return { kind: 'app', id: Number(m[1]) };
  m = url.match(/store\.steampowered\.com\/sub\/(\d+)/);
  if (m) return { kind: 'sub', id: Number(m[1]) };
  m = url.match(/store\.steampowered\.com\/bundle\/(\d+)/);
  if (m) return { kind: 'bundle', id: Number(m[1]) };
  return null;
}

export function targetKey(target) {
  return `${target.kind}:${target.id}`;
}

export function storeUrl(target) {
  return `https://store.steampowered.com/${target.kind}/${target.id}/`;
}

async function getJson(url) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`Steam HTTP ${res.status}`);
  return res.json();
}

/**
 * Normalise Steam's price_overview into a flat shape.
 * Amounts stay in minor units (cents) as Steam reports them.
 */
function normalisePrice(p) {
  if (!p) return null;
  return {
    currency: p.currency,
    regularMinor: p.initial,
    finalMinor: p.final,
    discountPct: p.discount_percent || 0,
    formatted: p.final_formatted || null
  };
}

/**
 * Prices for many apps in one request.
 * @returns {Promise<Map<number, object|null>>} appid -> price or null (free/unavailable)
 */
export async function fetchAppPrices(appids, cc) {
  const out = new Map();
  if (!appids.length) return out;

  // Steam truncates very long appid lists; chunk defensively.
  for (let i = 0; i < appids.length; i += 50) {
    const chunk = appids.slice(i, i + 50);
    const url = `${STEAM_API}/appdetails?appids=${chunk.join(',')}` +
                `&filters=price_overview&cc=${cc}&l=en`;
    const json = await getJson(url);
    for (const id of chunk) {
      const entry = json?.[String(id)];
      const data = entry?.success ? entry.data : null;
      // Free or region-locked titles come back as an empty array.
      const price = Array.isArray(data) ? null : normalisePrice(data?.price_overview);
      out.set(id, price);
    }
    if (i + 50 < appids.length) await sleep(REGION_DELAY_MS);
  }
  return out;
}

/** Prices for many packages (sub IDs) in one request. */
export async function fetchPackagePrices(packageids, cc) {
  const out = new Map();
  if (!packageids.length) return out;

  for (let i = 0; i < packageids.length; i += 50) {
    const chunk = packageids.slice(i, i + 50);
    const url = `${STEAM_API}/packagedetails?packageids=${chunk.join(',')}&cc=${cc}&l=en`;
    const json = await getJson(url);
    for (const id of chunk) {
      const entry = json?.[String(id)];
      const d = entry?.success ? entry.data : null;
      if (!d?.price) { out.set(id, null); continue; }
      out.set(id, {
        currency: d.price.currency,
        regularMinor: d.price.initial,
        finalMinor: d.price.final,
        discountPct: d.price.discount_percent || 0,
        formatted: null
      });
    }
    if (i + 50 < packageids.length) await sleep(REGION_DELAY_MS);
  }
  return out;
}

/** Price for a single target in one region. Bundles are not supported here. */
export async function fetchPrice(target, cc) {
  if (target.kind === 'app') {
    return (await fetchAppPrices([target.id], cc)).get(target.id);
  }
  if (target.kind === 'sub') {
    return (await fetchPackagePrices([target.id], cc)).get(target.id);
  }
  return null;
}

/** Title, type and artwork. Used when adding to the watchlist. */
export async function fetchMeta(target, cc = 'lk') {
  if (target.kind === 'app') {
    const url = `${STEAM_API}/appdetails?appids=${target.id}&cc=${cc}&l=en`;
    const json = await getJson(url);
    const d = json?.[String(target.id)]?.data;
    if (!d) return null;
    return {
      name: d.name,
      type: d.type,
      isFree: !!d.is_free,
      image: d.header_image || null,
      releaseDate: d.release_date?.date || null
    };
  }
  if (target.kind === 'sub') {
    const url = `${STEAM_API}/packagedetails?packageids=${target.id}&cc=${cc}&l=en`;
    const json = await getJson(url);
    const d = json?.[String(target.id)]?.data;
    if (!d) return null;
    return {
      name: d.name,
      type: 'package',
      isFree: false,
      image: d.header_image || d.small_logo || null,
      releaseDate: d.release_date?.date || null
    };
  }
  return null;
}

/**
 * Price the same target across several regions.
 * Failures per-region are swallowed — a partial table is still useful.
 * @returns {Promise<Record<string, object>>} cc -> normalised price
 */
export async function surveyRegions(target, ccs) {
  const out = {};
  for (const cc of ccs) {
    try {
      const price = await fetchPrice(target, cc);
      if (price) out[cc] = price;
    } catch {
      // Ignore: one bad region shouldn't sink the comparison.
    }
    await sleep(REGION_DELAY_MS);
  }
  return out;
}
