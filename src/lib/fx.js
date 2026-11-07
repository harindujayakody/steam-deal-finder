// Foreign exchange rates — sourced from exchangerate.fun (api.exchangerate.fun)
// first, with open.er-api.com as a fallback if the primary is unreachable or
// returns no usable rate. Both are keyless, open-CORS APIs updated hourly from
// multiple data sources. One call returns USD-based rates for every currency
// this extension needs, so the same response serves both jobs:
//
//   - the headline number: what a Steam purchase (billed in USD) costs in LKR
//   - the backstop: converting other regions' currencies (INR, IDR, ...) for
//     the region-comparison table
//
// No card markup, no fees — the rate as published, applied directly.

import { FX_SOURCES, FX_TTL_MS } from './constants.js';
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
    const errors = [];
    for (const source of FX_SOURCES) {
      try {
        const res = await fetch(source.url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`${source.name} HTTP ${res.status}`);
        const json = await res.json();
        const lkr = json?.rates?.LKR;
        if (typeof lkr !== 'number') throw new Error(`${source.name} returned no LKR rate`);

        // exchangerate.fun stamps `timestamp` (unix seconds); er-api uses
        // `time_last_update_unix` (unix seconds) or `time_last_update` (string).
        const ts = json.timestamp ?? json.time_last_update_unix;
        const record = {
          rate: lkr,
          asOf: ts
            ? new Date(ts * 1000).toISOString()
            : (json.time_last_update ? new Date(json.time_last_update).toISOString() : null),
          backstop: json.rates,
          fetchedAt: Date.now()
        };
        await setFxCache(record);
        return { ...record, stale: false };
      } catch (err) {
        errors.push(String(err));
      }
    }
    const err = new Error(`All FX sources failed: ${errors.join('; ')}`);
    if (cached) return { ...cached, stale: true, error: String(err) };
    throw err;
  })().finally(() => { inflight = null; });

  return inflight;
}

/** Backstop USD-based rate for a non-LKR, non-USD currency. Null if unknown. */
export function backstopRate(fx, currency) {
  if (!currency) return null;
  if (currency === 'USD') return 1;
  const r = fx?.backstop?.[currency.toUpperCase()];
  return typeof r === 'number' ? r : null;
}
