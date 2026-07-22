// Foreign exchange rates — sourced from exchangerate.fun (api.exchangerate.fun),
// a keyless, open-CORS API updated hourly from multiple data sources. One call
// returns USD-based rates for every currency this extension needs, so the same
// response serves both jobs:
//
//   - the headline number: what a Steam purchase (billed in USD) costs in LKR
//   - the backstop: converting other regions' currencies (INR, IDR, ...) for
//     the region-comparison table
//
// No card markup, no fees — the rate as published, applied directly.

import { EXCHANGE_RATE_API, FX_TTL_MS } from './constants.js';
import { getFxCache, setFxCache } from './storage.js';

let inflight = null;

/**
 * @returns {Promise<{
 *   rate: number,                     USD/LKR
 *   asOf: string|null,                ISO date the rate is timestamped for
 *   backstop: Record<string, number>, full USD-based rate table
 *   fetchedAt: number,
 *   stale: boolean
 * }>}
 */
export async function getRates({ force = false } = {}) {
  const cached = await getFxCache();
  const fresh = cached && Date.now() - cached.fetchedAt < FX_TTL_MS;
  if (fresh && !force) return { ...cached, stale: false };

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(EXCHANGE_RATE_API, { cache: 'no-store' });
      if (!res.ok) throw new Error(`exchangerate.fun HTTP ${res.status}`);
      const json = await res.json();
      const lkr = json?.rates?.LKR;
      if (typeof lkr !== 'number') throw new Error('exchangerate.fun returned no LKR rate');

      const record = {
        rate: lkr,
        asOf: json.timestamp ? new Date(json.timestamp * 1000).toISOString() : null,
        backstop: json.rates,
        fetchedAt: Date.now()
      };
      await setFxCache(record);
      return { ...record, stale: false };
    } catch (err) {
      if (cached) return { ...cached, stale: true, error: String(err) };
      throw err;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Backstop USD-based rate for a non-LKR, non-USD currency. Null if unknown. */
export function backstopRate(fx, currency) {
  if (!currency) return null;
  if (currency === 'USD') return 1;
  const r = fx?.backstop?.[currency.toUpperCase()];
  return typeof r === 'number' ? r : null;
}
