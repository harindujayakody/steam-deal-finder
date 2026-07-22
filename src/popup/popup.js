// Popup: the watchlist, plus a quick read on whatever Steam page is open.

import { formatLKR } from '../lib/pricing.js';
import { iconSvg } from '../theme/icons.js';

const $ = (id) => document.getElementById(id);

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(res || { ok: false, error: 'No response' });
      }
    });
  });
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function status(text, isError = false) {
  const s = $('status');
  s.textContent = text || '';
  s.style.color = isError ? 'var(--gold)' : '';
}

/** Accept a full store URL, a bare appid, or "app/1174180". */
function parseInput(raw) {
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(/\/(app|sub|bundle)\/(\d+)/);
  if (m) return { kind: m[1], id: Number(m[2]) };
  m = s.match(/^(app|sub|bundle)[\s/:]+(\d+)$/i);
  if (m) return { kind: m[1].toLowerCase(), id: Number(m[2]) };
  if (/^\d+$/.test(s)) return { kind: 'app', id: Number(s) };
  return null;
}

// ------------------------------------------------------------------ icons
// Best-effort: a broken icon should never take the rest of the popup down
// with it, so each injection is isolated rather than one unguarded block.

function setIcon(id, name, size) {
  try { $(id).innerHTML = iconSvg(name, { size }); } catch { /* cosmetic only */ }
}
setIcon('refresh', 'arrows_rotate', 14);
setIcon('options', 'gear', 14);
setIcon('creditHeart', 'heart', 11);

// ------------------------------------------------------------------ watchlist

async function renderList() {
  const res = await send('WATCH_LIST');
  const list = res.ok ? res.data : [];
  const wrap = $('list');
  wrap.textContent = '';

  $('empty').classList.toggle('hidden', list.length > 0);
  $('count').textContent = list.length ? `Watchlist · ${list.length}` : 'Watchlist';

  // Best-deal-now first, then discounted, then most recently added.
  const sorted = [...list].sort((a, b) => {
    const ba = a.lastSixMonth?.isBestDeal ? 1 : 0;
    const bb = b.lastSixMonth?.isBestDeal ? 1 : 0;
    if (ba !== bb) return bb - ba;
    const da = a.lastPrice?.discountPct || 0;
    const db = b.lastPrice?.discountPct || 0;
    if (da !== db) return db - da;
    return b.addedAt - a.addedAt;
  });

  for (const item of sorted) {
    wrap.appendChild(renderItem(item));
  }
}

function renderItem(item) {
  const p = item.lastPrice;
  const thumb = item.image
    ? el('img', { src: item.image, alt: '' })
    : el('div', { class: 'noimg' });

  const sub = el('div', { class: 'item-sub' });
  if (item.lastSixMonth?.isBestDeal) {
    sub.appendChild(el('span', { class: 'pill green', html: iconSvg('star', { size: 10 }) + ' 6mo best' }));
  }
  if (p?.discountPct) sub.appendChild(el('span', { class: 'pill blue', text: `-${p.discountPct}%` }));
  if (item.targetLKR > 0) {
    sub.appendChild(el('span', { class: 'pill dim', text: `target ${formatLKR(item.targetLKR)}` }));
  }
  if (p?.finalMinor != null) {
    sub.appendChild(el('span', { text: `$${(p.finalMinor / 100).toFixed(2)}` }));
  }
  sub.appendChild(el('span', { text: item.lastCheckedAt ? relTime(item.lastCheckedAt) : 'not checked yet' }));

  const right = el('div', { class: 'item-right' }, [
    el('div', { class: 'item-price', text: p?.lkrNow != null ? formatLKR(p.lkrNow) : '—' }),
    p && p.regularMinor > p.finalMinor
      ? el('div', { class: 'item-was', text: `$${(p.regularMinor / 100).toFixed(2)}` })
      : null
  ]);

  const tools = el('div', { class: 'item-tools' }, [
    el('button', {
      class: 'icon-btn', title: 'Set a target price', html: iconSvg('tag', { size: 12 }),
      onclick: () => toggleTargetEditor(row, item)
    }),
    el('button', {
      class: 'icon-btn rm', title: 'Stop tracking', html: iconSvg('xmark', { size: 12 }),
      onclick: async () => {
        await send('WATCH_REMOVE', { key: item.key });
        renderList();
      }
    })
  ]);
  right.appendChild(tools);

  const main = el('div', { class: 'item-main' }, [
    el('a', { class: 'item-name', href: item.url, target: '_blank', rel: 'noopener', text: item.name }),
    sub
  ]);

  const row = el('div', { class: 'item' }, [thumb, main, right]);
  return row;
}

function toggleTargetEditor(row, item) {
  const existing = row.querySelector('.target-edit');
  if (existing) { existing.remove(); return; }

  const input = el('input', {
    type: 'number', min: '0', step: '100',
    placeholder: 'LKR',
    value: item.targetLKR != null ? String(item.targetLKR) : ''
  });
  const save = el('button', {
    class: 'btn primary sm', text: 'Set',
    onclick: async () => {
      const v = input.value.trim();
      const targetLKR = v === '' ? null : Math.max(0, Number(v));
      await send('WATCH_UPDATE', { key: item.key, patch: { targetLKR } });
      status(targetLKR ? `Alert set at ${formatLKR(targetLKR)}` : 'Target cleared');
      renderList();
    }
  });
  const editor = el('div', { class: 'target-edit' }, [input, save]);
  row.querySelector('.item-main').appendChild(editor);
  input.focus();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
}

function relTime(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ------------------------------------------------------------ current tab

async function renderCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const target = tab?.url ? parseInput(tab.url) : null;
  if (!target) return;

  const section = $('current');
  const body = $('current-body');
  section.classList.remove('hidden');
  body.textContent = '';
  body.appendChild(el('div', { class: 'snap-sub', text: 'Checking…' }));

  const res = await send('GET_SNAPSHOT', { target, regions: false, history: true });
  body.textContent = '';

  if (!res.ok || !res.data?.home) {
    body.appendChild(el('div', {
      class: 'snap-sub',
      text: res.data?.warnings?.[0] || res.error || 'No price for this page.'
    }));
    return;
  }

  const snap = res.data;

  // Steam price fetched fine, but the LKR conversion didn't — say so instead
  // of crashing on the null.
  if (!snap.home.lkr) {
    body.appendChild(el('div', {
      class: 'snap-sub',
      text: `Got the Steam price ($${(snap.home.price.finalMinor / 100).toFixed(2)}) but the exchange rate is unavailable right now.`
    }));
    return;
  }

  body.appendChild(el('div', { class: 'snap-price', text: formatLKR(snap.home.lkr.now) }));
  body.appendChild(el('div', { class: 'snap-sub' }, [
    el('span', { text: snap.name || `${target.kind} ${target.id}` }),
    snap.home.price.discountPct
      ? el('span', { class: 'pill blue', text: `-${snap.home.price.discountPct}%` })
      : null
  ]));

  if (snap.sixMonth?.isBestDeal) {
    body.appendChild(el('div', {
      class: 'snap-best',
      html: iconSvg('star', { size: 12 }) + ' Best price in the last 6 months'
    }));
  }

  const has = await send('WATCH_HAS', { key: `${target.kind}:${target.id}` });
  const watching = has.ok && has.data.watching;
  body.appendChild(el('div', { class: 'snap-actions' }, [
    el('button', {
      class: 'btn' + (watching ? ' ghost' : ' primary'),
      text: watching ? 'Tracking ✓ — remove' : 'Track this',
      onclick: async (e) => {
        e.target.disabled = true;
        if (watching) await send('WATCH_REMOVE', { key: `${target.kind}:${target.id}` });
        else await send('WATCH_ADD', { target, name: snap.name });
        await renderCurrentTab();
        await renderList();
      }
    })
  ]));
}

// ------------------------------------------------------------------ wiring

$('add-btn').addEventListener('click', addFromInput);
$('add-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFromInput(); });

async function addFromInput() {
  const msg = $('add-msg');
  const target = parseInput($('add-input').value);
  msg.classList.remove('hidden', 'ok');

  if (!target) {
    msg.textContent = 'Paste a Steam store URL or an AppID.';
    return;
  }
  msg.textContent = 'Adding…';
  const res = await send('WATCH_ADD', { target });
  if (!res.ok) {
    msg.textContent = res.error;
    return;
  }
  msg.classList.add('ok');
  msg.textContent = res.data.added ? 'Added.' : 'Already tracking that.';
  $('add-input').value = '';
  await renderList();
  setTimeout(() => msg.classList.add('hidden'), 2500);
}

$('refresh').addEventListener('click', async () => {
  const btn = $('refresh');
  btn.disabled = true;
  status('Checking every tracked title…');
  const res = await send('REFRESH_ALL');
  btn.disabled = false;
  status(res.ok ? `Checked ${res.data.checked ?? 0}.` : res.error, !res.ok);
  await renderList();
});

$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

async function renderFx() {
  const res = await send('GET_FX', {});
  if (!res.ok || !res.data?.rate) {
    $('fx').textContent = 'rate unavailable';
    return;
  }
  $('fx').textContent =
    `${res.data.rate.toFixed(2)} LKR/USD` + (res.data.stale ? ' · stale' : '');
}

(async function init() {
  try {
    await renderList();
    await renderFx();
    await renderCurrentTab();
  } catch (err) {
    console.error('SteamDeal Pro popup failed to load:', err);
    status('Something went wrong — see the console (F12).', true);
  }
})();
