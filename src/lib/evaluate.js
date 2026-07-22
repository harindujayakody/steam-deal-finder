// Assembles one complete picture of a deal: Steam's USD price, what that lands
// at in rupees via the live exchange rate, how it compares across regions,
// whether today's price is the best this listing has had in the last six
// months, and the cheapest it's available for at other stores right now.

import { HOME_CC, REGION_NAMES, PRICE_TTL_MS, SIX_MONTHS_MS } from './constants.js';
import { getRates } from './fx.js';
import * as steam from './steam.js';
import * as itad from './itad.js';
import { priceToLKR, toLandedLKR } from './pricing.js';
import { getCache, putCache } from './storage.js';

/**
 * Build a snapshot for one target.
 *
 * @param {{kind:string,id:number}} target
 * @param {object} settings
 * @param {object} opts
 * @param {boolean} opts.regions  run the cross-region survey (slow, on demand)
 * @param {boolean} opts.history  query ITAD for the 6-month best deal (needs a key)
 * @param {object} opts.inlinePrice  price scraped from the page, for bundles
 * @param {boolean} opts.force     bypass the short price cache
 */
export async function buildSnapshot(target, settings, opts = {}) {
  const { regions = false, history = false, inlinePrice = null, force = false } = opts;
  const key = steam.targetKey(target);

  const snapshot = {
    target,
    key,
    url: steam.storeUrl(target),
    name: null,
    image: null,
    fetchedAt: Date.now(),
    warnings: [],
    home: null,        // { price, lkr }
    regions: null,     // cc -> { price, lkrEquiv, name, savingVsHome }
    cheapestRegion: null,
    sixMonth: null,     // { low: {amount,currency,timestamp,lkr}, isBestDeal, history }
    otherStores: null,  // { deals: [{shopId,shopName,lkr,url,cut}, ...] }
    fx: null
  };

  // --- FX -------------------------------------------------------------------
  let fx;
  try {
    fx = await getRates();
    snapshot.fx = { rate: fx.rate, asOf: fx.asOf, stale: fx.stale || false };
    if (fx.stale) snapshot.warnings.push('Exchange rate is stale — network unreachable.');
  } catch {
    snapshot.warnings.push('Could not reach the exchange rate API; rupee figures unavailable.');
    return snapshot;
  }

  // --- Home price -----------------------------------------------------------
  let homePrice = inlinePrice;
  if (!homePrice && target.kind !== 'bundle') {
    const cacheKey = `${key}:${HOME_CC}`;
    const cached = await getCache(cacheKey);
    if (!force && cached && Date.now() - cached.fetchedAt < PRICE_TTL_MS) {
      homePrice = cached.price;
    } else {
      try {
        homePrice = await steam.fetchPrice(target, HOME_CC);
        await putCache(cacheKey, { price: homePrice, fetchedAt: Date.now() });
      } catch (err) {
        snapshot.warnings.push(`Steam price lookup failed: ${err.message}`);
      }
    }
  }

  if (!homePrice) {
    snapshot.warnings.push(
      target.kind === 'bundle'
        ? 'Steam has no public bundle price API — reading the price from the page.'
        : 'No price returned. The title may be free, unreleased, or unavailable in your region.'
    );
    return snapshot;
  }

  const homeLKR = priceToLKR(homePrice, fx);
  snapshot.home = { price: homePrice, lkr: homeLKR };

  // --- Metadata -------------------------------------------------------------
  if (target.kind !== 'bundle') {
    try {
      const meta = await steam.fetchMeta(target, HOME_CC);
      if (meta) {
        snapshot.name = meta.name;
        snapshot.image = meta.image;
      }
    } catch { /* cosmetic only */ }
  }

  // --- Region comparison ------------------------------------------------
  // Informational. Steam locks your store region to your payment method's
  // country, so a cheaper region is context for whether a price is fair — not
  // a checkout you can actually use.
  if (regions && target.kind !== 'bundle') {
    const ccs = (settings.compareRegions || []).filter((c) => c !== HOME_CC);
    let survey = {};
    try {
      survey = await steam.surveyRegions(target, ccs);
    } catch {
      snapshot.warnings.push('Region survey failed.');
    }

    const table = {};
    for (const [cc, price] of Object.entries(survey)) {
      const lkrEquiv = toLandedLKR(price.finalMinor, price.currency, fx);
      if (lkrEquiv == null) continue;
      table[cc] = {
        cc,
        name: REGION_NAMES[cc] || cc.toUpperCase(),
        price,
        lkrEquiv,
        savingVsHome: homeLKR ? homeLKR.now - lkrEquiv : null
      };
    }
    snapshot.regions = table;

    const sorted = Object.values(table).sort((a, b) => a.lkrEquiv - b.lkrEquiv);
    if (sorted.length && homeLKR && sorted[0].lkrEquiv < homeLKR.now) {
      snapshot.cheapestRegion = sorted[0];
    }
  }

  // --- 6-month best deal ------------------------------------------------
  if (history && target.kind === 'app') {
    if (!itad.hasKey(settings)) {
      snapshot.sixMonth = { needsKey: true };
    } else {
      try {
        const since = new Date(Date.now() - SIX_MONTHS_MS);
        const res = await itad.fetchSixMonthLow(target.id, settings.itad.key.trim(), since, 'US');

        if (res.unknownGame) {
          snapshot.sixMonth = { unknownGame: true };
        } else if (!res.low) {
          snapshot.sixMonth = { history: [] };
        } else {
          const lowLKR = toLandedLKR(Math.round(res.low.price * 100), res.low.currency, fx);
          const nowLKR = homeLKR?.now ?? null;
          // Today's price can undercut what ITAD has indexed if it just dropped;
          // treat "at or under the recorded low" as the best deal either way.
          const isBestDeal = nowLKR != null && lowLKR != null && nowLKR <= lowLKR + 0.5;

          snapshot.sixMonth = {
            low: {
              amount: res.low.price,
              currency: res.low.currency,
              lkr: lowLKR,
              date: res.low.timestamp
            },
            isBestDeal,
            eventCount: res.history.length
          };
        }
      } catch (err) {
        snapshot.warnings.push(`IsThereAnyDeal lookup failed: ${err.message}`);
      }
    }
  }

  // --- Other stores -------------------------------------------------------
  // The cheapest deals ITAD knows about anywhere except Steam, since Steam's
  // price is already the headline number above.
  if (history && target.kind === 'app') {
    if (!itad.hasKey(settings)) {
      snapshot.otherStores = { needsKey: true };
    } else {
      try {
        const res = await itad.fetchOtherStoreDeals(target.id, settings.itad.key.trim(), 'US', 3);

        if (res.unknownGame) {
          snapshot.otherStores = { unknownGame: true };
        } else {
          snapshot.otherStores = {
            deals: res.deals.map((d) => ({
              shopId: d.shopId,
              shopName: d.shopName,
              lkr: toLandedLKR(Math.round(d.price * 100), d.currency, fx),
              cut: d.cut,
              url: d.url
            })).filter((d) => d.lkr != null)
          };
        }
      } catch (err) {
        snapshot.warnings.push(`IsThereAnyDeal store lookup failed: ${err.message}`);
      }
    }
  }

  return snapshot;
}

/**
 * Which alert conditions a snapshot newly satisfies.
 * Returns reason objects; the caller handles dedupe and delivery.
 */
export function detectAlerts(snapshot, watchItem, settings) {
  const out = [];
  const a = settings.alerts;
  if (!a?.enabled || !snapshot.home?.lkr) return out;

  const nowLKR = snapshot.home.lkr.now;
  const discount = snapshot.home.price.discountPct || 0;

  if (a.onTargetPrice && watchItem.targetLKR > 0 && nowLKR <= watchItem.targetLKR) {
    out.push({
      reason: 'target',
      title: 'Target price hit',
      detail: `${snapshot.name || watchItem.name} is at LKR ${Math.round(nowLKR).toLocaleString('en-LK')}, at or under your LKR ${watchItem.targetLKR.toLocaleString('en-LK')} target.`
    });
  }

  if (a.onDiscountPct > 0 && discount >= a.onDiscountPct) {
    out.push({
      reason: 'discount',
      title: `${discount}% off`,
      detail: `${snapshot.name || watchItem.name} is ${discount}% off — LKR ${Math.round(nowLKR).toLocaleString('en-LK')} landed.`
    });
  }

  if (a.onSixMonthLow && snapshot.sixMonth?.isBestDeal) {
    out.push({
      reason: 'sixMonthLow',
      title: 'Best price in 6 months',
      detail: `${snapshot.name || watchItem.name} just matched its lowest Steam price of the last six months.`
    });
  }

  return out;
}
