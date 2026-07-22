// Turning a Steam price into rupees, using the live USD/LKR rate — nothing else.
//
//   landed LKR = USD x the current USD/LKR rate
//
// No markup, no fees: the published rate, applied directly.

import { backstopRate } from './fx.js';

/** Convert a Steam price (minor units, home currency = USD) straight to LKR. */
export function toLandedLKR(minorUnits, currency, fx) {
  if (minorUnits == null || !fx?.rate) return null;
  const major = minorUnits / 100;
  if (currency === 'USD') return major * fx.rate;

  // Non-USD only happens for the region-comparison table; route it through
  // the backstop multi-currency table, then apply the USD/LKR rate.
  const toUsd = backstopRate(fx, currency);
  if (!toUsd) return null;
  return (major / toUsd) * fx.rate;
}

/** Landed cost for both the regular and discounted price of one region. */
export function priceToLKR(price, fx) {
  if (!price) return null;
  const now = toLandedLKR(price.finalMinor, price.currency, fx);
  const regular = toLandedLKR(price.regularMinor, price.currency, fx);
  if (now == null) return null;
  return {
    now,
    regular: regular ?? now,
    saved: regular != null ? Math.max(0, regular - now) : 0,
    discountPct: price.discountPct || 0
  };
}

const lkrFmt = new Intl.NumberFormat('en-LK', {
  style: 'currency',
  currency: 'LKR',
  maximumFractionDigits: 0
});

export function formatLKR(amount) {
  if (amount == null || Number.isNaN(amount)) return '—';
  return lkrFmt.format(Math.round(amount));
}

export function formatUSD(minorUnits) {
  if (minorUnits == null) return '—';
  return `$${(minorUnits / 100).toFixed(2)}`;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric'
});

export function formatDate(isoOrDate) {
  if (!isoOrDate) return '—';
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}
