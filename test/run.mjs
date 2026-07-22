/**
 * Headless test harness — `npm test`.
 *
 * Stubs the handful of chrome.* APIs the lib modules touch, then exercises them
 * in Node. Pricing and URL parsing are pure and tested offline. The network
 * section hits Steam and the exchangerate.fun API for real, so it needs
 * network and will report a live price that changes between runs. ITAD needs
 * a free-but-registered API key this harness doesn't have, so its live path
 * is only exercised indirectly (buildSnapshot without a key -> needsKey) —
 * the alert logic for a 6-month best deal is still fully tested with a
 * hand-built snapshot, since detectAlerts is a pure function.
 */

import fs from 'node:fs';
import path from 'node:path';

const store = { sync: {}, local: {} };
const area = (name) => ({
  get: async (k) => (k == null ? { ...store[name] }
    : typeof k === 'string' ? { [k]: store[name][k] }
    : Object.fromEntries(Object.keys(k).map((x) => [x, store[name][x]]))),
  set: async (obj) => { Object.assign(store[name], obj); },
  remove: async (k) => { delete store[name][k]; }
});
globalThis.chrome = { storage: { sync: area('sync'), local: area('local') } };

const { DEFAULT_SETTINGS, OTHER_STORE_SHOP_IDS } = await import('../src/lib/constants.js');
const pricing = await import('../src/lib/pricing.js');
const steam = await import('../src/lib/steam.js');
const { getRates } = await import('../src/lib/fx.js');
const { buildSnapshot, detectAlerts } = await import('../src/lib/evaluate.js');
const { ICONS, iconSvg } = await import('../src/theme/icons.js');
const { getFxCache, setFxCache } = await import('../src/lib/storage.js');
const { toItadDateTime } = await import('../src/lib/itad.js');
const { STORE_INFO, storeIconPath, isComparedStore } = await import('../src/theme/stores.js');

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}   ${extra}`); }
};
const near = (a, b, tol = 0.51) => a != null && Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- pricing
console.log('\n== pricing (live-rate-only conversion) ==');
const FX = { rate: 300, asOf: '2026-07-22T00:00:00.000Z', backstop: { INR: 100, USD: 1, GBP: 0.8 } };

// $59.99 * 300 = 17997
t('USD -> landed LKR is a straight multiply by the live rate',
  near(pricing.toLandedLKR(5999, 'USD', FX), 17997),
  pricing.toLandedLKR(5999, 'USD', FX));

// Rs 4999 INR -> $49.99 via backstop -> * 300 = 14997
t('INR -> landed LKR routes through the backstop then the live rate',
  near(pricing.toLandedLKR(499900, 'INR', FX), 14997),
  pricing.toLandedLKR(499900, 'INR', FX));

t('unknown currency with no backstop entry -> null',
  pricing.toLandedLKR(1000, 'ZWL', FX) === null);
t('null price -> null', pricing.toLandedLKR(null, 'USD', FX) === null);
t('missing rate -> null', pricing.toLandedLKR(1000, 'USD', { rate: null }) === null);

const pl = pricing.priceToLKR(
  { currency: 'USD', regularMinor: 5999, finalMinor: 1499, discountPct: 75 }, FX);
t('priceToLKR computes saving', near(pl.saved, pl.regular - pl.now) && pl.saved > 12000,
  JSON.stringify(pl));
t('formatLKR renders a rupee figure', /1[,.\s]?000/.test(pricing.formatLKR(1000)),
  pricing.formatLKR(1000));
t('formatDate renders a human date', pricing.formatDate('2026-06-12') === '12 Jun 2026',
  pricing.formatDate('2026-06-12'));
t('formatDate handles junk input', pricing.formatDate(null) === '—' && pricing.formatDate('nope') === '—');

// ---------------------------------------------------------------- parsing
console.log('\n== url parsing ==');
t('app url', JSON.stringify(steam.parseTarget('https://store.steampowered.com/app/1174180/Red_Dead/'))
  === '{"kind":"app","id":1174180}');
t('sub url', steam.parseTarget('https://store.steampowered.com/sub/68179/')?.kind === 'sub');
t('bundle url', steam.parseTarget('https://store.steampowered.com/bundle/232/')?.kind === 'bundle');
t('non-store url -> null', steam.parseTarget('https://example.com/app/5') === null);
t('targetKey', steam.targetKey({ kind: 'app', id: 7 }) === 'app:7');

// -------------------------------------------------------------------- icons
console.log('\n== icon set ==');
const needed = ['chart_line', 'tag', 'calendar_days', 'gear', 'star', 'bell', 'xmark',
  'globe', 'key', 'eye', 'eye_slash', 'arrows_rotate'];
t('every icon the UI references exists', needed.every((n) => !!ICONS[n]),
  needed.filter((n) => !ICONS[n]).join(','));
t('iconSvg renders a well-formed <svg>', /^<svg[^>]*>.*<\/svg>$/.test(iconSvg('star')));
t('iconSvg returns empty string for an unknown icon', iconSvg('does_not_exist') === '');

// ---------------------------------------------------------- fx cache schema
// Regression test: fx.js has changed its cached record shape twice (first
// open.er-api.com's {rates,...}, then CBSL's {rate,series,...}), and each
// time a leftover cache from the previous shape was silently reused —
// getRates() would resolve without error, but fx.rate would be undefined,
// which crashed the UI several layers away (steam-page.js reading `.now` off
// a null lkr). getFxCache() must refuse anything not stamped with the
// current schema, so a stale record is treated as no cache at all.
console.log('\n== fx cache schema guard ==');
await chrome.storage.local.set({ fxCache: { rates: { LKR: 300 }, fetchedAt: Date.now() } });
t('an old-shaped cache (no schema stamp) is not trusted', (await getFxCache()) === null);

await chrome.storage.local.set({ fxCache: { rate: 300, schema: 1, fetchedAt: Date.now() } });
t('a cache stamped with a prior schema version is not trusted', (await getFxCache()) === null);

await setFxCache({ rate: 336.5, asOf: '2026-07-22T00:00:00.000Z', backstop: {}, fetchedAt: Date.now() });
const roundTripped = await getFxCache();
t('a cache written by the current setFxCache round-trips correctly',
  roundTripped?.rate === 336.5, JSON.stringify(roundTripped));
await chrome.storage.local.remove('fxCache');

// ------------------------------------------------------------ itad date format
// Regression test: Date#toISOString() emits milliseconds + "Z"
// ("2026-01-24T19:13:43.827Z"), which ITAD's /games/history/v2 `since` param
// rejects outright with "Invalid 'since' format" (confirmed against the live
// API with a real key) even though their own OpenAPI spec just says
// format:date-time. Their own example timestamps in responses use whole
// seconds and a numeric offset instead ("2022-12-27T11:21:08+01:00") — that's
// the shape toItadDateTime must produce.
console.log('\n== itad since-date formatting ==');
const itadDate = toItadDateTime(new Date('2026-01-24T19:13:43.827Z'));
t('drops milliseconds and swaps Z for a numeric offset',
  itadDate === '2026-01-24T19:13:43+00:00', itadDate);
t('matches the shape of ITAD\'s own example timestamps',
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(itadDate), itadDate);

// ----------------------------------------------------------- store favicons
// "Other stores" is deliberately restricted to exactly five stores (EA, GOG,
// Epic, Ubisoft, Battle.net) with real bundled favicons — no drawn badges or
// hashed fallback, since the set is fixed and every member is known ahead of
// time. These checks make sure the shop-id keys line up between constants.js
// (what ITAD is asked to filter to) and stores.js (what art gets shown), and
// that the actual PNG files referenced exist on disk.
console.log('\n== store favicons ==');
t('constants.js and stores.js agree on which five shop ids are compared',
  Object.keys(OTHER_STORE_SHOP_IDS).sort().join(',') === Object.keys(STORE_INFO).sort().join(','));
for (const [shopId, info] of Object.entries(STORE_INFO)) {
  const p = path.join('icons', 'stores', info.icon);
  t(`favicon file exists for ${info.name} (shop ${shopId})`, fs.existsSync(p), p);
}
t('storeIconPath resolves a known shop id', storeIconPath(35) === 'icons/stores/gog.png');
t('storeIconPath returns null for a shop id outside the curated five', storeIconPath(61) === null);
t('isComparedStore is true only for the curated five',
  isComparedStore(35) && isComparedStore(16) && !isComparedStore(61));

// ------------------------------------------------------------------- live
console.log('\n== live network ==');
const fx = await getRates();
t('exchange rate fetch returns a plausible LKR rate', fx.rate > 200 && fx.rate < 800, fx.rate);
t('exchange rate fetch returns a parseable as-of timestamp',
  !Number.isNaN(new Date(fx.asOf).getTime()), fx.asOf);
t('exchange rate fetch returns a backstop table for other currencies',
  Object.keys(fx.backstop || {}).length > 20, Object.keys(fx.backstop || {}).length);
console.log(`        rate:   ${fx.rate.toFixed(2)} LKR/USD  (as of ${fx.asOf})`);

const prices = await steam.fetchAppPrices([1174180, 292030], 'lk');
t('batched Steam fetch', prices.get(1174180)?.currency === 'USD');
t('  second app in the same batch', prices.get(292030) != null);

const pkg = await steam.fetchPackagePrices([68179], 'lk');
t('package fetch', pkg.get(68179)?.finalMinor > 0, JSON.stringify(pkg.get(68179)));

const settings = structuredClone(DEFAULT_SETTINGS);
settings.compareRegions = ['us', 'in', 'id', 'br'];
const snap = await buildSnapshot({ kind: 'app', id: 1174180 }, settings,
  { regions: true, history: true, force: true });

t('snapshot resolves a name', !!snap.name, snap.name);
t('snapshot has a landed LKR figure', snap.home?.lkr?.now > 0);
t('snapshot used a plausible live rate', snap.fx?.rate > 200, JSON.stringify(snap.fx));
t('snapshot surveyed the regions', Object.keys(snap.regions || {}).length >= 3,
  Object.keys(snap.regions || {}).join(','));
t('no ITAD key configured -> sixMonth reports needsKey',
  snap.sixMonth?.needsKey === true, JSON.stringify(snap.sixMonth));
t('no ITAD key configured -> otherStores reports needsKey',
  snap.otherStores?.needsKey === true, JSON.stringify(snap.otherStores));
t('no unexpected warnings', snap.warnings.length === 0, JSON.stringify(snap.warnings));

console.log(`\n        "${snap.name}"`);
console.log(`        Steam:  $${(snap.home.price.finalMinor / 100).toFixed(2)} (-${snap.home.price.discountPct}%)`);
console.log(`        Landed: ${pricing.formatLKR(snap.home.lkr.now)}   (was ${pricing.formatLKR(snap.home.lkr.regular)})`);
for (const r of Object.values(snap.regions).sort((a, b) => a.lkrEquiv - b.lkrEquiv)) {
  console.log(`        ${r.name.padEnd(14)} ${String(r.price.formatted || '').padEnd(13)} ~ ${pricing.formatLKR(r.lkrEquiv)}`);
}

// ----------------------------------------------------------------- alerts
// detectAlerts is pure, so the 6-month-best-deal path is tested with a
// hand-built snapshot rather than a real ITAD key.
console.log('\n== alerts ==');
const watch = { key: 'app:1174180', name: 'RDR2', targetLKR: 999999 };
const fired = detectAlerts(snap, watch, settings);
t('target alert fires when price is under target', fired.some((a) => a.reason === 'target'));
t('discount alert tracks the threshold',
  snap.home.price.discountPct >= settings.alerts.onDiscountPct
    ? fired.some((a) => a.reason === 'discount')
    : !fired.some((a) => a.reason === 'discount'));
t('no target alert when price is above target',
  !detectAlerts(snap, { ...watch, targetLKR: 1 }, settings).some((a) => a.reason === 'target'));
t('alerts disabled -> nothing fires',
  detectAlerts(snap, watch, { ...settings, alerts: { ...settings.alerts, enabled: false } })
    .length === 0);

const bestDealSnap = { ...snap, sixMonth: { isBestDeal: true, low: { lkr: snap.home.lkr.now } } };
t('six-month-best-deal alert fires when isBestDeal is true',
  detectAlerts(bestDealSnap, watch, settings).some((a) => a.reason === 'sixMonthLow'));
const notBestDealSnap = { ...snap, sixMonth: { isBestDeal: false } };
t('six-month-best-deal alert does not fire otherwise',
  !detectAlerts(notBestDealSnap, watch, settings).some((a) => a.reason === 'sixMonthLow'));
t('six-month-best-deal alert respects the settings toggle',
  !detectAlerts(bestDealSnap, watch, { ...settings, alerts: { ...settings.alerts, onSixMonthLow: false } })
    .some((a) => a.reason === 'sixMonthLow'));

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
