// Shared constants and default settings.
//
// Steam bills Sri Lanka in USD, not LKR — there is no Steam "LKR price" to
// read. Every rupee figure here is computed: USD x the live USD/LKR rate.
// No card markup, no fees — just the published rate, applied directly.

export const EXT_NAME = 'Steam Deal Finder';

export const HOME_CC = 'lk';
export const HOME_CURRENCY_LABEL = 'LKR';

export const STEAM_API = 'https://store.steampowered.com/api';
export const ITAD_API = 'https://api.isthereanydeal.com';

// Keyless, open-CORS, hourly-updated FX APIs. One call returns USD-based rates
// for every currency this extension needs — LKR for the headline number, and
// everything else (INR, IDR, ...) for the region-comparison backstop.
// Tried in order; if the primary source is down or returns no LKR rate, the
// next source is tried before the cached rate (or an error) is used.
export const EXCHANGE_RATE_API = 'https://api.exchangerate.fun/latest?base=USD';
export const FX_SOURCES = [
  { name: 'exchangerate.fun', url: 'https://api.exchangerate.fun/latest?base=USD' },
  { name: 'open.er-api.com', url: 'https://open.er-api.com/v6/latest/USD' },
];

export const FX_TTL_MS = 12 * 60 * 60 * 1000; // rates move slowly; refetch twice a day
export const PRICE_TTL_MS = 15 * 60 * 1000;   // don't re-hit Steam for the same page
export const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;

export const ALARM_POLL = 'steamlk-deal-poll';

// ITAD's shop id for Steam itself — used to scope 6-month history to the
// listing this extension is actually about, not third-party resellers.
export const ITAD_STEAM_SHOP_ID = 61;

// The only stores the "Other stores" comparison shows, by ITAD shop id —
// confirmed live against ITAD's /service/shops/v1. Maps to the bundled
// favicon in icons/stores/. Note EA Store (id 52) and Blizzard/Battle.net
// (id 4) have very little data in ITAD (2 and 3 tracked deals respectively,
// at last check) — most games will only ever show GOG/Epic/Ubisoft here, not
// because of a bug, but because ITAD itself rarely tracks EA or Battle.net
// listings (both are largely exclusive to their own launchers).
export const OTHER_STORE_SHOP_IDS = {
  16: 'epic',      // Epic Game Store
  35: 'gog',       // GOG
  52: 'ea',        // EA Store
  62: 'ubisoft',   // Ubisoft Store
  4: 'battlenet'   // Blizzard (Battle.net)
};

// Regions worth comparing against. Steam moved Sri Lanka, Turkey, Argentina and
// the wider "rest of world" pool onto USD, so those are no longer arbitrage
// targets. These are the ones still priced in their own currency.
export const DEFAULT_COMPARE_REGIONS = [
  'us', 'in', 'id', 'vn', 'kz', 'ua', 'br', 'ph', 'th', 'my', 'pl', 'gb'
];

export const REGION_NAMES = {
  lk: 'Sri Lanka', us: 'United States', in: 'India', id: 'Indonesia',
  vn: 'Vietnam', kz: 'Kazakhstan', ua: 'Ukraine', br: 'Brazil',
  ph: 'Philippines', th: 'Thailand', my: 'Malaysia', pl: 'Poland',
  gb: 'United Kingdom', tr: 'Turkey', ar: 'Argentina', ru: 'Russia',
  cn: 'China', jp: 'Japan', kr: 'South Korea', au: 'Australia',
  ca: 'Canada', mx: 'Mexico', za: 'South Africa', sg: 'Singapore',
  ae: 'UAE', sa: 'Saudi Arabia', pk: 'Pakistan', bd: 'Bangladesh',
  np: 'Nepal', de: 'Germany', fr: 'France', no: 'Norway', ch: 'Switzerland'
};

export const ALERT_REASONS = {
  TARGET: 'target',
  DISCOUNT: 'discount',
  SIX_MONTH_LOW: 'sixMonthLow'
};

export const DEFAULT_SETTINGS = {
  compareRegions: [...DEFAULT_COMPARE_REGIONS],

  itad: { key: '' },

  alerts: {
    enabled: true,
    intervalMinutes: 180,
    onTargetPrice: true,
    onDiscountPct: 50,     // 0 disables
    onSixMonthLow: true    // needs an ITAD key
  }
};
