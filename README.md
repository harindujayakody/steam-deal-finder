# Steam Deal Finder

A Chrome extension that answers one question Steam won't: **what will this actually cost me in rupees, and is now the best time to buy it?**

*Not affiliated with, endorsed by, or sponsored by Valve Corporation, Steam, or IsThereAnyDeal. "Steam" is a trademark of Valve Corporation.*

---

## Why the rupee figure is computed, not read

Steam bills Sri Lankan accounts in **US dollars** — verified against the live storefront API:

```
GET store.steampowered.com/api/appdetails?appids=1174180&cc=lk
{"currency":"USD","final":1499,"final_formatted":"$14.99 USD"}
```

There is no LKR price to scrape. So the rupee figure is computed:

```
landed LKR = USD × the live USD/LKR rate
```

No card markup, no fees, no manual override — just the published rate, applied directly. The rate comes from [exchangerate.fun](https://exchangerate.fun/docs/) — keyless, open CORS, updated hourly.

Region comparison (India, Indonesia, Brazil, ...) uses the same API response — it returns USD-based rates for every currency in one call, so the region table and the headline LKR figure both come from a single fetch. Steam ties your store region to your payment method's country regardless, so a cheaper region is a fairness signal, not a checkout you can use. The panel says so wherever it shows the table.

---

## What it does

**On Steam store pages** — a panel above the buy box: landed rupee price, the rate it used, whether today's price matches the **best deal Steam has offered on this title in the last 6 months** (with the date), the **top 3 cheapest other stores** currently selling it, and a region comparison table.

**In the popup** — your watchlist with landed prices, per-title target prices, and a read on whatever Steam page is open.

**In the background** — polls tracked titles on a schedule and fires a Chrome notification when one hits your target price, crosses a discount threshold, or matches its 6-month best.

**The toolbar dot** — when the page you're looking at is at its own 6-month-best price, the extension icon shows a green dot on that tab. Switch tabs and it's gone unless that page also qualifies. A badge count (also shown as a dot-styled pill) tracks how many watchlist items are currently at their 6-month best.

### 6-month best-deal tracking

Pulls IsThereAnyDeal's `/games/history/v2`, scoped to Steam's own listing (shop id 61) and the trailing six months, and finds the cheapest point in that window plus its date:

```
Best deal · 6 months
LKR 5,042        ★ This is that price now
12 Jun 2026
```

If today's price undercuts what ITAD has indexed so far (a discount just went live), it's still treated as the best deal — no need to wait for ITAD's crawler to catch up. **Needs a free ITAD API key** — without one, everything else still works, this one card just explains what it needs.

### Other stores

Deliberately restricted to five stores — **EA, GOG, Epic, Ubisoft, Battle.net** — no others. Pulls IsThereAnyDeal's `/games/prices/v3` filtered to just those five shop ids, and shows the 3 cheapest that actually list the title, each with the store's own favicon, the discount if any, and a click-through link:

```
Other stores
[icon] GOG                -72%   LKR 3,480
[icon] Epic Game Store     -60%   LKR 3,990
[icon] Ubisoft Store       -35%   LKR 5,210
```

The icons are each store's **real favicon** — fetched once from the store's own official domain (ea.com, gog.com, epicgames.com, ubi.com, battle.net), composited onto a small rounded white plate for visual consistency, and bundled locally in `icons/stores/`. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for provenance and the fair-use rationale (identifying a store, same as a browser tab's own favicon — no affiliation implied).

Two of the five — **EA and Battle.net — rarely appear.** ITAD itself tracks very little data for them (2 and 3 listings respectively, at last check), since both are largely exclusive to their own launchers. Most games will only ever show GOG/Epic/Ubisoft here; that's ITAD's coverage, not a bug. Link URLs are ITAD's own redirect links, used exactly as returned — their API terms require affiliate tags not be altered or stripped. **Needs the same free ITAD API key** as the 6-month tracker — see the [in-extension help page](src/help/help.html) for setup steps.

---

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this folder

No build step. No dependencies. Plain ES modules, self-hosted fonts and icons — nothing loads from a CDN at runtime.

**If you update the code after loading it**, click the reload icon on the extension's card in `chrome://extensions` — Chrome doesn't pick up file changes to an unpacked extension automatically. If something still looks wrong after reloading, open the popup or options page, press F12, and check the console — both now log and surface any load failure there instead of failing silently.

## Configure

Nothing is required to get accurate rupee prices — the exchange rate is live and automatic.

**IsThereAnyDeal key** is optional and unlocks the 6-month best-deal card, its alert/badge, and the other-stores comparison. Register free at [isthereanydeal.com/apps/my](https://isthereanydeal.com/apps/my/), paste the key into Settings, hit **Test** — or open **Help** from the Settings page for a step-by-step walkthrough (`src/help/help.html`), which includes a placeholder video-embed slot ready to swap in a real tutorial.

---

## Design

Pure black (`#000`), Steam's own accent colors (`#66c0f4` blue, `#a4d007` green), **Poppins** for brand/headings/prices, **Inter** for body and dense data. Icons are self-hosted Font Awesome 6 Free (Solid) paths rendered as inline SVG — no icon webfont, no flash of unstyled icons, fully recolorable via `currentColor`. All four font files (~80KB total) and every icon path live in the repo; nothing is fetched from Google Fonts or a CDN at runtime.

## Layout

```
manifest.json              MV3, module service worker
fonts/                     self-hosted Poppins + Inter (woff2)
icons/                     toolbar icon, pure-black + Steam blue/green mark
icons/stores/              real favicons for EA/GOG/Epic/Ubisoft/Battle.net
src/theme/
  theme.css                design tokens, @font-face, shared component classes, credit pulse
  icons.js                 Font Awesome 6 path data + iconSvg() renderer
  stores.js                shop-id -> name/favicon lookup for the curated five
src/lib/                   shared ES modules
  constants.js              defaults; the USD-billing note + OTHER_STORE_SHOP_IDS live here
  storage.js                chrome.storage wrappers, settings merge-on-upgrade
  fx.js                     exchangerate.fun rate + multi-currency backstop, one call
  steam.js                  appdetails + packagedetails, batched
  itad.js                   ITAD v2 lookup, 6-month Steam history, other-store prices
  pricing.js                USD -> landed LKR, date formatting
  evaluate.js                assembles one snapshot; detects alert conditions
src/background/             alarms, notifications, per-tab icon, message router
src/content/                injected Steam panel (plain JS + inline icon/favicon subset)
src/popup/  src/options/    UI (ES modules)
src/help/                   in-extension setup guide, linked from Settings
test/run.mjs                headless harness
```

All network and pricing logic lives in the service worker. The content script parses the URL, asks for a finished snapshot, and renders it — it holds no API key and does no maths. Content scripts declared in a manifest can't be ES modules, which is why `steam-page.js` inlines the small icon subset it needs rather than importing `theme/icons.js`, and why `steam-page.css` redeclares its own `@font-face` and color tokens scoped under `#steamlk-panel` instead of linking `theme.css` — it runs inside `store.steampowered.com`'s document, so nothing here touches that page's `:root`.

## Test

```bash
npm test
```

Stubs `chrome.*`, runs pricing/parsing/icon-set/store-favicon checks offline, then hits Steam and exchangerate.fun for one live end-to-end snapshot. The 6-month-best-deal alert path is exercised with a hand-built snapshot (pure function, no ITAD key needed to test the logic). 51 assertions.

```
== live network ==
        rate:   336.28 LKR/USD  (as of 2026-07-22T19:00:00.000Z)
        "Red Dead Redemption 2"
        Steam:  $14.99 (-75%)
        Landed: LKR 5,041   (was LKR 20,174)
        Indonesia      Rp 219 750    ~ LKR 4,127
        India          ₹ 1,249       ~ LKR 4,351
        Brazil         R$ 74,97      ~ LKR 4,972
        United States  $14.99        ~ LKR 5,041
```

---

## Limits worth knowing

- **Bundles** (`/bundle/`) have no public Steam price API. The panel reads the price off the page, so rupee conversion still works, but bundles can't be background-polled, region-compared, or tracked for a 6-month best deal.
- **6-month history is Steam-only.** It's scoped to ITAD's Steam shop id specifically — a deal on another storefront won't show up here, on purpose, since the whole point is what Steam itself has charged.
- **Steam rate-limits** at roughly 200 requests per 5 minutes. Background sweeps batch every tracked title into one request; the region survey is the expensive path and only runs when you open a page or the panel.
- **Popup and options now fail loudly.** Both wrap their startup in a try/catch that logs to the console and shows an inline error instead of leaving the page silently stuck on its loading state — if you see that message, F12 → Console has the actual error.

---

## Chrome Web Store readiness

Reviewed against the Developer Program Policies before writing this section, not after:

- **No obfuscated or minified code.** Every `.js` file is hand-written and readable. `src/theme/icons.js` contains long lines of SVG path *data* (icon coordinates, not code) — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for its source and license.
- **No remotely hosted code.** All JS ships in the package; MV3's default CSP (`script-src 'self'`) is untouched — `manifest.json` sets no custom `content_security_policy`. No `eval`, `new Function`, or string-form `setTimeout`/`setInterval` anywhere in the codebase.
- **Minimal, justified permissions.** `storage` (settings/watchlist), `alarms` (background polling), `notifications` (price alerts) — each is used exactly where you'd expect and nowhere else. `host_permissions` lists exactly the three domains the code fetches from (Steam, ITAD, exchangerate.fun) — grep confirms no `fetch()` call targets anything outside that list. No `tabs`, `webRequest`, `history`, `bookmarks`, `<all_urls>`, or other broad permission is requested.
- **Single, narrow purpose.** Steam price → LKR conversion and deal tracking — nothing else.
- **No ad injection, no affiliate-link rewriting, no page hijacking.** The content script only adds its own panel above Steam's existing purchase box; it never modifies Steam's own DOM, links, or checkout flow.
- **Third-party text is never trusted as HTML.** Error messages that can carry text from ITAD's own API response (`reason_phrase`) go through `textContent`, never `innerHTML` — checked deliberately during this review, since an earlier same-session change to surface that text had introduced exactly this risk.
- **Local-only data.** Settings and watchlist live in `chrome.storage`; nothing is sent anywhere except the three declared APIs, and only what each one needs (Steam gets app/package IDs, ITAD gets your key plus a game ID, exchangerate.fun gets nothing but the request itself).

**Still needed on your end** — these live in the Chrome Web Store dashboard, not the code:
1. A privacy practices disclosure (the "Local-only data" point above is the accurate answer, but CWS wants it stated in their form).
2. A short justification string per requested permission, shown to reviewers.
3. Consider adding the non-affiliation line from the top of this README to your actual store listing description too — extensions using "Steam" in their name occasionally draw trademark scrutiny, and existing published extensions (Enhanced Steam, Augmented Steam, etc.) carry a similar disclaimer.
