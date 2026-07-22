// Background service worker: message router, scheduled polling, notifications,
// the per-tab best-deal icon, and the all-tabs count badge.
//
// All network and pricing logic lives here rather than in the content script,
// because content scripts can't use ES modules from the manifest and shouldn't
// hold API keys. The injected panel is a thin view that asks this worker for a
// finished snapshot.

import { ALARM_POLL, EXT_NAME } from '../lib/constants.js';
import {
  getSettings, setSettings, getWatchlist, saveWatchlist
} from '../lib/storage.js';
import * as steam from '../lib/steam.js';
import * as itad from '../lib/itad.js';
import { buildSnapshot, detectAlerts } from '../lib/evaluate.js';
import { getRates } from '../lib/fx.js';

const BADGE_DOT_COLOR = '#a4d007'; // Steam's positive-deal green

// Two pre-rendered icon sets rather than chrome.action's badge API for the
// per-tab "at its 6-month best" indicator: the badge API has no size control
// and renders a fixed-proportion pill that dominates a 16-19px icon when
// there's no number in it — a baked-in dot in the art itself is the only way
// to make it genuinely small. The all-tabs *count* badge below is a normal,
// appropriately-sized use of the badge API and is unaffected by this.
//
// chrome.action.setIcon({path}) does its own internal fetch of the image and
// can fail with "Failed to fetch" from a service worker even when the path is
// correct (the same paths work fine as manifest.json's default_icon) — a
// known MV3 service-worker quirk, not something fixable by changing the path
// string. Fetching the PNGs ourselves and handing setIcon raw ImageData
// sidesteps it entirely, since we already fetch successfully elsewhere in
// this file.
const ICON_FILES = {
  normal: { 16: 'icons/sale16.png', 32: 'icons/sale32.png', 48: 'icons/sale48.png', 128: 'icons/sale128.png' },
  bestDeal: { 16: 'icons/sale16-dot.png', 32: 'icons/sale32-dot.png', 48: 'icons/sale48-dot.png', 128: 'icons/sale128-dot.png' }
};
const iconImageDataCache = new Map(); // 'normal'|'bestDeal' -> {16:ImageData,...}

async function loadIconImageData(variant) {
  if (iconImageDataCache.has(variant)) return iconImageDataCache.get(variant);

  const sizes = ICON_FILES[variant];
  const entries = await Promise.all(
    Object.entries(sizes).map(async ([size, path]) => {
      const res = await fetch(chrome.runtime.getURL(path));
      const bitmap = await createImageBitmap(await res.blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      return [size, ctx.getImageData(0, 0, bitmap.width, bitmap.height)];
    })
  );
  const imageData = Object.fromEntries(entries);
  iconImageDataCache.set(variant, imageData);
  return imageData;
}

// ---------------------------------------------------------------- lifecycle

chrome.runtime.onInstalled.addListener(async (details) => {
  await rescheduleAlarm();
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(rescheduleAlarm);

async function rescheduleAlarm() {
  const settings = await getSettings();
  await chrome.alarms.clear(ALARM_POLL);
  if (!settings.alerts.enabled) return;
  const minutes = Math.max(30, settings.alerts.intervalMinutes || 180);
  chrome.alarms.create(ALARM_POLL, { periodInMinutes: minutes, delayInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_POLL) pollWatchlist().catch(console.error);
});

// ---------------------------------------------------------------- watchlist

async function addToWatchlist(target, extra = {}) {
  const list = await getWatchlist();
  const key = steam.targetKey(target);
  if (list.some((i) => i.key === key)) return { added: false, list };

  let meta = null;
  try {
    meta = await steam.fetchMeta(target);
  } catch { /* name can be filled in later */ }

  list.push({
    key,
    target,
    name: extra.name || meta?.name || `${target.kind} ${target.id}`,
    image: meta?.image || null,
    url: steam.storeUrl(target),
    targetLKR: extra.targetLKR ?? null,
    addedAt: Date.now(),
    lastPrice: null,
    lastSixMonth: null,
    lastCheckedAt: null,
    notified: {}
  });

  await saveWatchlist(list);
  await updateBadge();
  return { added: true, list };
}

async function removeFromWatchlist(key) {
  const list = (await getWatchlist()).filter((i) => i.key !== key);
  await saveWatchlist(list);
  await updateBadge();
  return list;
}

async function updateWatchItem(key, patch) {
  const list = await getWatchlist();
  const item = list.find((i) => i.key === key);
  if (item) {
    Object.assign(item, patch);
    // A changed target price should be allowed to fire again.
    if ('targetLKR' in patch) delete item.notified.target;
    await saveWatchlist(list);
  }
  return list;
}

/** Default (all-tabs) badge: a count of watched titles at their 6-month best. */
async function updateBadge() {
  try {
    const list = await getWatchlist();
    const hot = list.filter((i) => i.lastSixMonth?.isBestDeal).length;
    await chrome.action.setBadgeText({ text: hot ? String(hot) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_DOT_COLOR });
  } catch (err) {
    console.warn('updateBadge failed (cosmetic, ignored):', err);
  }
}

/**
 * Per-tab icon swap: the dot-variant icon when the page currently open in
 * that tab is at its own 6-month-best price, the normal icon otherwise, so
 * it doesn't linger when the user browses to a different, non-discounted
 * title. Purely cosmetic — a failure here must never take down the snapshot
 * response the caller actually asked for, so every failure is swallowed.
 */
async function setTabBadge(tabId, isBestDeal) {
  if (tabId == null) return;
  try {
    const imageData = await loadIconImageData(isBestDeal ? 'bestDeal' : 'normal');
    await chrome.action.setIcon({ tabId, imageData });
    await chrome.action.setTitle({
      tabId,
      title: isBestDeal ? `${EXT_NAME} — best price in 6 months` : EXT_NAME
    });
  } catch (err) {
    console.warn('setTabBadge failed (cosmetic, ignored):', err);
  }
}

// ---------------------------------------------------------------- polling

let polling = false;

async function pollWatchlist({ notify = true } = {}) {
  if (polling) return { skipped: true };
  polling = true;

  try {
    const settings = await getSettings();
    const list = await getWatchlist();
    if (!list.length) return { checked: 0 };

    await getRates(); // warm the FX cache once for the whole sweep

    const useHistory = itad.hasKey(settings) && settings.alerts.onSixMonthLow;
    const results = [];

    for (const item of list) {
      if (item.target.kind === 'bundle') continue; // no API to poll
      let snap;
      try {
        snap = await buildSnapshot(item.target, settings, {
          regions: false,       // too many requests for a background sweep
          history: useHistory,
          force: true
        });
      } catch (err) {
        console.warn('poll failed for', item.key, err);
        continue;
      }
      if (!snap.home) continue;

      item.lastPrice = {
        currency: snap.home.price.currency,
        finalMinor: snap.home.price.finalMinor,
        regularMinor: snap.home.price.regularMinor,
        discountPct: snap.home.price.discountPct,
        lkrNow: snap.home.lkr?.now ?? null
      };
      item.lastSixMonth = snap.sixMonth?.low
        ? { isBestDeal: snap.sixMonth.isBestDeal, low: snap.sixMonth.low }
        : item.lastSixMonth;
      item.lastCheckedAt = Date.now();
      if (!item.name || item.name.startsWith('app ')) item.name = snap.name || item.name;
      if (!item.image) item.image = snap.image || null;

      if (notify) {
        // Signature ties a fired alert to the price that caused it, so the same
        // condition re-fires only after the price actually moves.
        const sig = String(snap.home.price.finalMinor);
        for (const alert of detectAlerts(snap, item, settings)) {
          if (item.notified[alert.reason] === sig) continue;
          item.notified[alert.reason] = sig;
          await fireNotification(item, alert);
        }
        // Clear stale marks so a later drop to the same price can alert again.
        for (const reason of Object.keys(item.notified)) {
          if (item.notified[reason] !== sig) delete item.notified[reason];
        }
      }

      results.push({ key: item.key, price: item.lastPrice });
    }

    await saveWatchlist(list);
    await updateBadge();
    return { checked: results.length, results };
  } finally {
    polling = false;
  }
}

async function fireNotification(item, alert) {
  const id = `deal:${item.key}:${alert.reason}:${Date.now()}`;
  try {
    await chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/sale128.png'),
      title: alert.title,
      message: alert.detail,
      contextMessage: EXT_NAME,
      priority: 1
    });
    notificationTargets.set(id, item.url);
  } catch (err) {
    console.warn('notification failed', err);
  }
}

const notificationTargets = new Map();

chrome.notifications.onClicked.addListener((id) => {
  const url = notificationTargets.get(id);
  if (url) chrome.tabs.create({ url });
  chrome.notifications.clear(id);
  notificationTargets.delete(id);
});

// ---------------------------------------------------------------- messaging

const handlers = {
  async GET_SNAPSHOT({ target, regions, history, inlinePrice, force }, sender) {
    const settings = await getSettings();
    const snap = await buildSnapshot(target, settings, {
      regions: regions ?? false,
      history: history ?? itad.hasKey(settings),
      inlinePrice: inlinePrice ?? null,
      force: force ?? false
    });
    if (sender?.tab?.id != null) {
      await setTabBadge(sender.tab.id, !!snap.sixMonth?.isBestDeal);
    }
    return snap;
  },

  async PARSE_URL({ url }) {
    return steam.parseTarget(url);
  },

  async WATCH_LIST() {
    return getWatchlist();
  },

  async WATCH_ADD({ target, name, targetLKR }) {
    return addToWatchlist(target, { name, targetLKR });
  },

  async WATCH_REMOVE({ key }) {
    return removeFromWatchlist(key);
  },

  async WATCH_UPDATE({ key, patch }) {
    return updateWatchItem(key, patch);
  },

  async WATCH_HAS({ key }) {
    const list = await getWatchlist();
    return { watching: list.some((i) => i.key === key) };
  },

  async REFRESH_ALL() {
    return pollWatchlist({ notify: true });
  },

  async GET_SETTINGS() {
    return getSettings();
  },

  async SET_SETTINGS({ patch }) {
    const next = await setSettings(patch);
    await rescheduleAlarm();
    return next;
  },

  async TEST_ITAD_KEY({ key }) {
    return itad.testKey(key);
  },

  async GET_FX({ force }) {
    return getRates({ force: !!force });
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) {
    sendResponse({ ok: false, error: `Unknown message type: ${msg?.type}` });
    return false;
  }
  handler(msg, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true; // keep the channel open for the async reply
});
