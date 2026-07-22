// Settings page.

import { DEFAULT_SETTINGS, REGION_NAMES, DEFAULT_COMPARE_REGIONS } from '../lib/constants.js';
import { formatLKR, formatDate } from '../lib/pricing.js';
import { iconSvg } from '../theme/icons.js';

const $ = (id) => document.getElementById(id);

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (res) => {
      resolve(chrome.runtime.lastError
        ? { ok: false, error: chrome.runtime.lastError.message }
        : res || { ok: false, error: 'No response' });
    });
  });
}

// ------------------------------------------------------------------ icons
// Best-effort: a broken icon should never take the rest of the page down
// with it, so each injection is isolated rather than one unguarded block.

function setIcon(id, name, size) {
  try { $(id).innerHTML = iconSvg(name, { size }); } catch { /* cosmetic only */ }
}
setIcon('icRate', 'chart_line', 13);
setIcon('icGlobe', 'globe', 13);
setIcon('icKey', 'key', 13);
setIcon('icBell', 'bell', 13);
setIcon('icHelp', 'circle_info', 13);
setIcon('itadReveal', 'eye', 13);
setIcon('creditHeart', 'heart', 11);

let fxRate = null; // live USD/LKR

// ---------------------------------------------------------------- regions

function renderRegions(selected) {
  const wrap = $('regions');
  wrap.textContent = '';
  const all = [...new Set([...DEFAULT_COMPARE_REGIONS, ...selected])];
  for (const cc of all.sort((a, b) =>
    (REGION_NAMES[a] || a).localeCompare(REGION_NAMES[b] || b))) {
    const label = document.createElement('label');
    label.className = 'region-check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = cc;
    box.checked = selected.includes(cc);
    const span = document.createElement('span');
    span.textContent = REGION_NAMES[cc] || cc.toUpperCase();
    label.append(box, span);
    wrap.appendChild(label);
  }
}

function readRegions() {
  return [...$('regions').querySelectorAll('input:checked')].map((i) => i.value);
}

// ---------------------------------------------------------------- preview

function updatePreview() {
  const box = $('preview');
  if (!fxRate) {
    box.textContent = 'Waiting for the exchange rate…';
    return;
  }
  const landed = (usd) => usd * fxRate;
  box.innerHTML =
    `A $59.99 game lands at <b>${formatLKR(landed(59.99))}</b> · ` +
    `$29.99 → <b>${formatLKR(landed(29.99))}</b> · ` +
    `$14.99 → <b>${formatLKR(landed(14.99))}</b><br>` +
    `Straight conversion — no markup or fees applied.`;
}

// ---------------------------------------------------------------- load/save

async function load() {
  const res = await send('GET_SETTINGS');
  const s = res.ok ? res.data : structuredClone(DEFAULT_SETTINGS);

  renderRegions(s.compareRegions);
  $('itadKey').value = s.itad.key || '';

  $('alertsEnabled').checked = s.alerts.enabled;
  $('intervalMinutes').value = s.alerts.intervalMinutes;
  $('onTargetPrice').checked = s.alerts.onTargetPrice;
  $('onSixMonthLow').checked = s.alerts.onSixMonthLow;
  $('onDiscountPct').value = s.alerts.onDiscountPct;

  const fx = await send('GET_FX', {});
  if (fx.ok && fx.data?.rate) {
    fxRate = fx.data.rate;
    $('rateValue').textContent = `${fx.data.rate.toFixed(2)} LKR`;
    $('rateMeta').textContent =
      `per 1 USD · updated ${formatDate(fx.data.asOf)}` +
      (fx.data.stale ? ' · showing a cached value, network unreachable' : '');
  } else {
    $('rateMeta').textContent = `Could not reach the exchange rate API${fx.error ? `: ${fx.error}` : '.'}`;
  }
  updatePreview();
}

async function save() {
  const msg = $('saveMsg');
  const patch = {
    compareRegions: readRegions(),
    itad: { key: $('itadKey').value.trim() },
    alerts: {
      enabled: $('alertsEnabled').checked,
      intervalMinutes: Math.max(30, Number($('intervalMinutes').value) || 180),
      onTargetPrice: $('onTargetPrice').checked,
      onSixMonthLow: $('onSixMonthLow').checked,
      onDiscountPct: Math.max(0, Math.min(100, Number($('onDiscountPct').value) || 0))
    }
  };

  const res = await send('SET_SETTINGS', { patch });
  msg.classList.toggle('bad', !res.ok);
  msg.textContent = res.ok ? 'Saved.' : `Failed: ${res.error}`;
  setTimeout(() => { msg.textContent = ''; }, 2600);
}

// ---------------------------------------------------------------- wiring

$('save').addEventListener('click', save);

$('reset').addEventListener('click', async () => {
  await send('SET_SETTINGS', { patch: structuredClone(DEFAULT_SETTINGS) });
  await load();
  $('saveMsg').classList.remove('bad');
  $('saveMsg').textContent = 'Reset to defaults.';
  setTimeout(() => { $('saveMsg').textContent = ''; }, 2600);
});

$('itadReveal').addEventListener('click', () => {
  const f = $('itadKey');
  f.type = f.type === 'password' ? 'text' : 'password';
  $('itadReveal').innerHTML = iconSvg(f.type === 'password' ? 'eye' : 'eye_slash', { size: 13 });
});

$('itadTest').addEventListener('click', async () => {
  const out = $('itadOut');
  const key = $('itadKey').value.trim();
  out.className = 'calib-out';
  if (!key) { out.textContent = 'Enter a key first.'; return; }
  out.textContent = 'Testing…';
  const res = await send('TEST_ITAD_KEY', { key });
  if (res.ok && res.data.ok) {
    out.className = 'calib-out ok';
    out.textContent = 'Key works. Save to start tracking the 6-month best-deal date.';
  } else {
    out.className = 'calib-out bad';
    out.textContent = `Key rejected: ${res.data?.error || res.error || 'unknown error'}`;
  }
});

load().catch((err) => {
  console.error('SteamDeal Pro options failed to load:', err);
  $('rateMeta').textContent = 'Something went wrong loading settings — see the console (F12).';
});
