// Store lookup for the "other stores" price comparison.
//
// The comparison is deliberately restricted to five stores (see
// OTHER_STORE_SHOP_IDS in constants.js) — EA, GOG, Epic, Ubisoft, and
// Battle.net — so every store that can appear here is known ahead of time.
// That means real favicons, fetched once from each store's own site and
// bundled locally in icons/stores/, rather than icon webfonts or a runtime
// fetch to a third party. See THIRD_PARTY_NOTICES.md for provenance.

import { OTHER_STORE_SHOP_IDS } from '../lib/constants.js';

export const STORE_INFO = {
  16: { name: 'Epic Game Store', icon: 'epic.png' },
  35: { name: 'GOG', icon: 'gog.png' },
  52: { name: 'EA Store', icon: 'ea.png' },
  62: { name: 'Ubisoft Store', icon: 'ubisoft.png' },
  4: { name: 'Battle.net', icon: 'battlenet.png' }
};

/** Path (relative to the extension root) to a store's bundled favicon. */
export function storeIconPath(shopId) {
  const info = STORE_INFO[shopId];
  return info ? `icons/stores/${info.icon}` : null;
}

/** True if `shopId` is one of the five stores this extension compares. */
export function isComparedStore(shopId) {
  return shopId in OTHER_STORE_SHOP_IDS;
}
