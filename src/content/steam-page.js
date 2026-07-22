/**
 * SteamDeal Pro — injected panel on Steam store pages.
 *
 * Deliberately dumb: it parses the target from the URL, hands it to the service
 * worker, and renders whatever comes back. No API keys, no pricing maths here.
 * Content scripts declared in the manifest can't be ES modules, which is the
 * other reason all the logic lives in the worker — this file also can't import
 * the shared icon module, so a small subset of the same Font Awesome path data
 * is inlined below.
 */

(() => {
  'use strict';

  const PANEL_ID = 'steamlk-panel';
  if (document.getElementById(PANEL_ID)) return;

  // ------------------------------------------------------------------ icons
  // Font Awesome 6 Free (Solid), CC BY 4.0 — https://fontawesome.com

  const ICONS = {
    chart_line: { vb: '0 0 512 512', d: 'M64 64c0-17.7-14.3-32-32-32S0 46.3 0 64L0 400c0 44.2 35.8 80 80 80l400 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L80 416c-8.8 0-16-7.2-16-16L64 64zm406.6 86.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L320 210.7l-57.4-57.4c-12.5-12.5-32.8-12.5-45.3 0l-112 112c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L240 221.3l57.4 57.4c12.5 12.5 32.8 12.5 45.3 0l128-128z' },
    calendar_days: { vb: '0 0 448 512', d: 'M128 0c17.7 0 32 14.3 32 32l0 32 128 0 0-32c0-17.7 14.3-32 32-32s32 14.3 32 32l0 32 48 0c26.5 0 48 21.5 48 48l0 48L0 160l0-48C0 85.5 21.5 64 48 64l48 0 0-32c0-17.7 14.3-32 32-32zM0 192l448 0 0 272c0 26.5-21.5 48-48 48L48 512c-26.5 0-48-21.5-48-48L0 192zm64 80l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-32 0c-8.8 0-16 7.2-16 16zm128 0l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-32 0c-8.8 0-16 7.2-16 16zm144-16c-8.8 0-16 7.2-16 16l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-32 0zM64 400l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-32 0c-8.8 0-16 7.2-16 16zm144-16c-8.8 0-16 7.2-16 16l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-32 0zm112 16l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-32 0z' },
    star: { vb: '0 0 576 512', d: 'M316.9 18C311.6 7 300.4 0 288.1 0s-23.4 7-28.8 18L195 150.3 51.4 171.5c-12 1.8-22 10.2-25.7 21.7s-.7 24.2 7.9 32.7L137.8 329 113.2 474.7c-2 12 3 24.2 12.9 31.3s23 8 33.8 2.3L288.1 439.8 415.3 508.3c10.8 5.7 23.9 4.9 33.8-2.3s14.9-19.3 12.9-31.3L438.4 329 542.7 226c8.6-8.5 11.7-21.2 7.9-32.7s-13.7-19.9-25.7-21.7L381.3 150.3 316.9 18z' },
    star_outline: { vb: '0 0 576 512', d: 'M287.9 0c9.2 0 17.6 5.2 21.6 13.5l68.6 141.3 153.2 22.6c9.1 1.3 16.6 7.6 19.5 16.3s.5 18.1-6.1 24.5L433.6 328.4l26.2 155.6c1.5 9-2.2 18.1-9.7 23.5s-17.3 6-25.3 1.7l-137-73.2L151 509.1c-8.1 4.3-17.9 3.7-25.3-1.7s-11.2-14.5-9.7-23.5l26.2-155.6L31.1 218.2c-6.5-6.4-8.9-15.9-6.1-24.5s10.4-14.9 19.5-16.3l153.2-22.6L266.3 13.5C270.4 5.2 278.7 0 287.9 0zm0 79L235.4 187.2c-3.5 7.1-10.2 12.1-18.1 13.2L99 217.9 184.9 303c5.5 5.5 8.1 13.3 6.8 21L171.4 443.7l105.2-56.2c7.1-3.8 15.6-3.8 22.6 0l105.2 56.2L384.2 324.4c-1.3-7.7 1.2-15.5 6.8-21l90.5-89.7-121.6-17.9c-7.9-1.2-14.7-6.1-18.1-13.2L287.9 79z' },
    rotate: { vb: '0 0 512 512', d: 'M105.1 202.6c7.7-21.8 20.2-42.3 37.8-59.8c62.5-62.5 163.8-62.5 226.3 0L386.3 160 352 160c-17.7 0-32 14.3-32 32s14.3 32 32 32l112 0c17.7 0 32-14.3 32-32l0-112c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 34.7L414.4 97.6c-87.5-87.5-229.3-87.5-316.8 0C73.2 122 55.6 150.7 44.8 181.4c-5.9 16.7 2.9 34.9 19.5 40.8s34.9-2.9 40.8-19.5zM39 289.3c-5 1.5-9.8 4.2-13.7 8.2c-4 4-6.7 8.8-8.1 14c-.3 1.2-.6 2.5-.8 3.8c-.3 1.7-.4 3.4-.4 5.1L16 432c0 17.7 14.3 32 32 32s32-14.3 32-32l0-34.7 19.1 19.1c87.5 87.4 229.3 87.4 316.7 0c24.4-24.4 42.1-53.1 52.9-83.8c5.9-16.7-2.9-34.9-19.5-40.8s-34.9 2.9-40.8 19.5c-7.7 21.8-20.2 42.3-37.8 59.8c-62.5 62.5-163.8 62.5-226.3 0l-9.8-9.8L160 352c17.7 0 32-14.3 32-32s-14.3-32-32-32L48.4 288c-1.6 0-3.2 .1-4.8 .3s-3.1 .5-4.6 1z' },
    triangle_exclamation: { vb: '0 0 512 512', d: 'M256 32c14.2 0 27.3 7.5 34.5 19.8l216 368c7.3 12.4 7.3 27.7 .2 40.1S486.3 480 472 480L40 480c-14.3 0-27.6-7.7-34.7-20.1s-7-27.8 .2-40.1l216-368C228.7 39.5 241.8 32 256 32zm0 128c-13.3 0-24 10.7-24 24l0 112c0 13.3 10.7 24 24 24s24-10.7 24-24l0-112c0-13.3-10.7-24-24-24zm32 224a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z' },
    globe: { vb: '0 0 512 512', d: 'M352 256c0 22.2-1.2 43.6-3.3 64l-185.3 0c-2.2-20.4-3.3-41.8-3.3-64s1.2-43.6 3.3-64l185.3 0c2.2 20.4 3.3 41.8 3.3 64zm28.8-64l123.1 0c5.3 20.5 8.1 41.9 8.1 64s-2.8 43.5-8.1 64l-123.1 0c2.1-20.6 3.2-42 3.2-64s-1.1-43.4-3.2-64zm112.6-32l-116.7 0c-10-63.9-29.8-117.4-55.3-151.6c78.3 20.7 141.4 79.4 172 151.6zm-149.5 0l-176 0c6.1-36.4 15.5-68.6 27-94.7c10.5-23.6 22.2-40.7 33.5-51.5C239.4 3.2 248.7 0 256 0s16.6 3.2 27.6 13.8c11.3 10.8 23 27.9 33.5 51.5c11.6 26 21 58.2 27 94.7zm-209.9 0L17.3 160C47.9 87.8 111 29.1 189.3 8.4C163.8 42.6 144 96.1 134 160zm-8.9 32c-2.1 20.6-3.2 42-3.2 64s1.1 43.4 3.2 64L8.1 320C2.8 299.5 0 278.1 0 256s2.8-43.5 8.1-64l116.9 0zm10.9 160l116.7 0c10 63.9 29.8 117.4 55.3 151.6c-78.3-20.7-141.4-79.4-172-151.6zm102.2 0l176 0c-6.1 36.4-15.5 68.6-27 94.7c-10.5 23.6-22.2 40.7-33.5 51.5C266.6 508.8 257.3 512 256 512s-16.6-3.2-27.6-13.8c-11.3-10.8-23-27.9-33.5-51.5c-11.6-26-21-58.2-27-94.7zm-121.2 0c30.6 72.2 93.7 130.9 172 151.6c-25.5-34.2-45.2-87.7-55.3-151.6l-116.7 0z' },
    xmark: { vb: '0 0 384 512', d: 'M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z' },
    key: { vb: '0 0 512 512', d: 'M336 352c97.2 0 176-78.8 176-176S433.2 0 336 0S160 78.8 160 176c0 18.7 2.9 36.8 8.3 53.7L7 391c-4.5 4.5-7 10.6-7 17l0 80c0 13.3 10.7 24 24 24l80 0c13.3 0 24-10.7 24-24l0-40 40 0c13.3 0 24-10.7 24-24l0-40 40 0c6.4 0 12.5-2.5 17-7l33.3-33.3c16.9 5.4 35 8.3 53.7 8.3zM376 96a40 40 0 1 1 0 80 40 40 0 1 1 0-80z' },
    shop: { vb: '0 0 640 512', d: 'M36.8 192l566.3 0c20.3 0 36.8-16.5 36.8-36.8c0-7.3-2.2-14.4-6.2-20.4L558.2 21.4C549.3 8 534.4 0 518.3 0L121.7 0c-16 0-31 8-39.9 21.4L6.2 134.7c-4 6.1-6.2 13.2-6.2 20.4C0 175.5 16.5 192 36.8 192zM64 224l0 160 0 80c0 26.5 21.5 48 48 48l224 0c26.5 0 48-21.5 48-48l0-80 0-160-64 0 0 160-192 0 0-160-64 0zm448 0l0 256c0 17.7 14.3 32 32 32s32-14.3 32-32l0-256-64 0z' }
  };

  // Store badges for the "other stores" comparison: original marks (a short
  // initialism on a store-associated color), not reproductions of each
  // store's actual logo — see src/theme/stores.js for the full rationale and
  // the version popup/options would use if they ever need this too. Keyed by
  // ITAD's exact shop name.
  // The "other stores" comparison is restricted to exactly these five —
  // real favicons bundled locally (icons/stores/), fetched once from each
  // store's own site. Keyed by ITAD shop id, matching OTHER_STORE_SHOP_IDS
  // in src/lib/constants.js and the source of truth in src/theme/stores.js.
  const STORE_ICONS = {
    16: 'epic.png', 35: 'gog.png', 52: 'ea.png', 62: 'ubisoft.png', 4: 'battlenet.png'
  };

  function svg(name, size = 15) {
    const i = ICONS[name];
    if (!i) return '';
    return `<svg class="stlk-icon" viewBox="${i.vb}" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${i.d}"/></svg>`;
  }

  // ---------------------------------------------------------------- helpers

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

  /**
   * Appends an icon and a message to `container` as two separate flex
   * children (matching .stlk-warn's `display:flex; gap:` layout) rather than
   * one concatenated HTML string. The icon markup is our own static SVG data
   * (safe to inject as-is); the message can carry text from a third-party API
   * response (e.g. ITAD's error `reason_phrase`), so it always goes through
   * textContent rather than innerHTML.
   */
  function appendIconLine(container, iconName, message, size = 12) {
    container.appendChild(el('span', { html: svg(iconName, size) }));
    container.appendChild(el('span', { text: message }));
  }

  const lkr = (n) =>
    n == null || Number.isNaN(n) ? '—' : 'LKR ' + Math.round(n).toLocaleString('en-LK');

  const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
  };

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

  function parseTarget(url) {
    let m = url.match(/\/app\/(\d+)/);
    if (m) return { kind: 'app', id: Number(m[1]) };
    m = url.match(/\/sub\/(\d+)/);
    if (m) return { kind: 'sub', id: Number(m[1]) };
    m = url.match(/\/bundle\/(\d+)/);
    if (m) return { kind: 'bundle', id: Number(m[1]) };
    return null;
  }

  /** Bundles have no price API, so read the page. Sri Lankan accounts see USD. */
  function scrapeInlinePrice() {
    const sel = [
      '.game_purchase_price.price',
      '.discount_final_price',
      '.game_area_purchase_game .price'
    ];
    for (const s of sel) {
      const node = document.querySelector(s);
      const raw = node?.textContent?.trim();
      if (!raw) continue;
      const m = raw.replace(/[\s,]/g, '').match(/([\d]+(?:\.\d{1,2})?)/);
      if (!m) continue;
      const finalMinor = Math.round(parseFloat(m[1]) * 100);
      if (!finalMinor) continue;

      const origNode = document.querySelector('.discount_original_price');
      const om = origNode?.textContent?.replace(/[\s,]/g, '').match(/([\d]+(?:\.\d{1,2})?)/);
      const regularMinor = om ? Math.round(parseFloat(om[1]) * 100) : finalMinor;

      return {
        currency: 'USD',
        finalMinor,
        regularMinor,
        discountPct: regularMinor > finalMinor
          ? Math.round((1 - finalMinor / regularMinor) * 100)
          : 0,
        formatted: raw
      };
    }
    return null;
  }

  // ---------------------------------------------------------------- rendering

  function renderSixMonth(sm) {
    if (!sm) return null;
    const box = el('div', { class: 'stlk-section' });
    box.appendChild(el('div', { class: 'stlk-section-title', html: svg('calendar_days') + ' Best deal · 6 months' }));

    if (sm.needsKey) {
      box.appendChild(el('div', { class: 'stlk-note dim', text: 'Add an IsThereAnyDeal API key in options to track the 6-month best-deal date.' }));
      return box;
    }
    if (sm.unknownGame) {
      box.appendChild(el('div', { class: 'stlk-note dim', text: 'IsThereAnyDeal has no record for this title.' }));
      return box;
    }
    if (!sm.low) {
      box.appendChild(el('div', { class: 'stlk-note dim', text: 'No price history recorded in the last 6 months yet.' }));
      return box;
    }

    const row = el('div', { class: 'stlk-deal-row' + (sm.isBestDeal ? ' hit' : '') }, [
      el('div', { class: 'stlk-deal-left' }, [
        el('div', { class: 'stlk-deal-amount', text: lkr(sm.low.lkr) }),
        el('div', { class: 'stlk-deal-date', html: svg('calendar_days', 12) + ' ' + fmtDate(sm.low.date) })
      ]),
      sm.isBestDeal
        ? el('div', { class: 'stlk-best', html: svg('star', 12) + ' This is that price now' })
        : null
    ]);
    box.appendChild(row);
    return box;
  }

  function renderRegions(snap) {
    if (!snap.regions || !Object.keys(snap.regions).length) return null;
    const box = el('div', { class: 'stlk-section' });
    box.appendChild(el('div', { class: 'stlk-section-title' }, [
      el('span', { html: svg('globe') + ' Other regions' }),
      el('span', {
        class: 'stlk-hint-dot',
        title: 'Steam ties your store region to your payment method’s country. These are reference points for whether a price is fair, not a checkout you can use.',
        text: '?'
      })
    ]));

    const rows = Object.values(snap.regions).sort((a, b) => a.lkrEquiv - b.lkrEquiv).slice(0, 8);
    const table = el('div', { class: 'stlk-regions' });
    for (const r of rows) {
      const cheaper = r.savingVsHome > 0;
      table.appendChild(
        el('div', { class: 'stlk-region' + (cheaper ? ' cheaper' : '') }, [
          el('span', { class: 'stlk-region-name', text: r.name }),
          el('span', {
            class: 'stlk-region-native',
            text: r.price.formatted || `${(r.price.finalMinor / 100).toFixed(2)} ${r.price.currency}`
          }),
          el('span', { class: 'stlk-region-lkr', text: lkr(r.lkrEquiv) })
        ])
      );
    }
    box.appendChild(table);
    box.appendChild(el('div', { class: 'stlk-note dim', text: 'Reference only — Steam locks your store to your card’s country.' }));
    return box;
  }

  function renderOtherStores(os) {
    if (!os) return null;
    const box = el('div', { class: 'stlk-section' });
    box.appendChild(el('div', { class: 'stlk-section-title', html: svg('shop') + ' Other stores' }));

    if (os.needsKey) {
      box.appendChild(el('div', { class: 'stlk-note dim', text: 'Add an IsThereAnyDeal API key in options to compare prices at other stores.' }));
      return box;
    }
    if (os.unknownGame) {
      box.appendChild(el('div', { class: 'stlk-note dim', text: 'IsThereAnyDeal has no record for this title.' }));
      return box;
    }
    if (!os.deals?.length) {
      box.appendChild(el('div', { class: 'stlk-note dim', text: 'No other store currently lists this title.' }));
      return box;
    }

    const list = el('div', { class: 'stlk-stores' });
    for (const d of os.deals) {
      const iconFile = STORE_ICONS[d.shopId];
      list.appendChild(
        el('a', { class: 'stlk-store', href: d.url, target: '_blank', rel: 'noopener noreferrer' }, [
          iconFile
            ? el('img', { class: 'stlk-store-icon', src: chrome.runtime.getURL(`icons/stores/${iconFile}`), alt: '' })
            : el('span', { class: 'stlk-store-icon stlk-store-icon-blank' }),
          el('span', { class: 'stlk-store-name', text: d.shopName }),
          d.cut ? el('span', { class: 'stlk-badge', text: `-${d.cut}%` }) : null,
          el('span', { class: 'stlk-store-price', text: lkr(d.lkr) })
        ])
      );
    }
    box.appendChild(list);
    return box;
  }

  function renderSnapshot(panel, snap) {
    const body = panel.querySelector('.stlk-body');
    body.textContent = '';

    if (!snap.home) {
      body.appendChild(el('div', { class: 'stlk-note', text: snap.warnings[0] || 'No price available.' }));
      return;
    }

    const { price, lkr: priceLkr } = snap.home;

    // Steam's price came through fine, but converting it to LKR didn't — a
    // currency-conversion miss, not a missing price. Say that specifically
    // rather than crashing on the null.
    if (!priceLkr) {
      const warn = el('div', { class: 'stlk-warn' });
      appendIconLine(warn, 'triangle_exclamation',
        `Got the Steam price ($${(price.finalMinor / 100).toFixed(2)}) but couldn't convert it to rupees — the exchange rate is unavailable right now. Try Refresh.`);
      body.appendChild(warn);
      return;
    }

    const hero = el('div', { class: 'stlk-hero' }, [
      el('div', {}, [
        el('div', { class: 'stlk-price', text: lkr(priceLkr.now) }),
        el('div', { class: 'stlk-price-meta' }, [
          el('span', { text: `${(price.finalMinor / 100).toFixed(2)} ${price.currency} on Steam` }),
          priceLkr.saved > 0 ? el('span', { class: 'stlk-was', text: lkr(priceLkr.regular) }) : null,
          price.discountPct ? el('span', { class: 'stlk-badge', text: `-${price.discountPct}%` }) : null
        ])
      ])
    ]);
    body.appendChild(hero);

    if (snap.fx?.rate) {
      body.appendChild(el('div', {
        class: 'stlk-fxline',
        html: svg('chart_line', 11) + ` ${snap.fx.rate.toFixed(2)} LKR/USD — updated ${fmtDate(snap.fx.asOf)}`
      }));
    }

    const sixMonth = renderSixMonth(snap.sixMonth);
    if (sixMonth) body.appendChild(sixMonth);

    const otherStores = renderOtherStores(snap.otherStores);
    if (otherStores) body.appendChild(otherStores);

    const regions = renderRegions(snap);
    if (regions) body.appendChild(regions);

    for (const w of snap.warnings) {
      // `w` can carry text straight from a third-party API's error response
      // (e.g. ITAD's `reason_phrase`), so it goes through appendIconLine's
      // textContent path rather than being concatenated into innerHTML.
      const warn = el('div', { class: 'stlk-warn' });
      appendIconLine(warn, 'triangle_exclamation', w);
      body.appendChild(warn);
    }
  }

  // ---------------------------------------------------------------- panel

  function buildPanel(target) {
    const panel = el('div', { id: PANEL_ID });

    const watchBtn = el('button', { class: 'stlk-btn', type: 'button', html: svg('star_outline', 13) + ' Track' });
    const refreshBtn = el('button', { class: 'stlk-btn ghost icon-only', type: 'button', html: svg('rotate', 13), title: 'Re-fetch prices' });

    panel.appendChild(
      el('div', { class: 'stlk-header' }, [
        el('div', { class: 'stlk-brand' }, [
          el('img', { class: 'stlk-mark', src: chrome.runtime.getURL('icons/sale48.png'), alt: '' }),
          el('span', { text: 'Steam Deal Finder' })
        ]),
        el('div', { class: 'stlk-actions' }, [refreshBtn, watchBtn])
      ])
    );
    panel.appendChild(el('div', { class: 'stlk-body' }, [
      el('div', { class: 'stlk-loading', html: svg('rotate', 13) + ' Checking prices…' })
    ]));

    async function syncWatchButton() {
      const res = await send('WATCH_HAS', { key: `${target.kind}:${target.id}` });
      const watching = res.ok && res.data.watching;
      watchBtn.innerHTML = watching ? svg('star', 13) + ' Tracking' : svg('star_outline', 13) + ' Track';
      watchBtn.classList.toggle('active', watching);
      return watching;
    }

    watchBtn.addEventListener('click', async () => {
      watchBtn.disabled = true;
      const key = `${target.kind}:${target.id}`;
      const watching = await syncWatchButton();
      if (watching) {
        await send('WATCH_REMOVE', { key });
      } else {
        await send('WATCH_ADD', { target, name: document.title.replace(' on Steam', '').trim() });
      }
      await syncWatchButton();
      watchBtn.disabled = false;
    });

    refreshBtn.addEventListener('click', () => load(panel, target, { force: true }));
    syncWatchButton();

    return panel;
  }

  async function load(panel, target, { force = false } = {}) {
    const body = panel.querySelector('.stlk-body');
    body.textContent = '';
    body.appendChild(el('div', { class: 'stlk-loading', html: svg('rotate', 13) + ' Checking prices…' }));

    const inlinePrice = target.kind === 'bundle' ? scrapeInlinePrice() : null;
    const res = await send('GET_SNAPSHOT', {
      target, regions: true, history: true, inlinePrice, force
    });

    if (!res.ok) {
      body.textContent = '';
      const warn = el('div', { class: 'stlk-warn' });
      appendIconLine(warn, 'triangle_exclamation', res.error || 'Lookup failed.');
      body.appendChild(warn);
      return;
    }
    renderSnapshot(panel, res.data);
  }

  // ---------------------------------------------------------------- mount

  function mount() {
    const target = parseTarget(location.pathname);
    if (!target) return;

    // Age gates and region blocks replace the purchase area entirely.
    const anchor =
      document.querySelector('#game_area_purchase') ||
      document.querySelector('.game_page_autocollapse.game_area_description') ||
      document.querySelector('.page_content .rightcol') ||
      document.querySelector('.page_content');
    if (!anchor) return;

    const panel = buildPanel(target);
    anchor.parentNode.insertBefore(panel, anchor);
    load(panel, target);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
