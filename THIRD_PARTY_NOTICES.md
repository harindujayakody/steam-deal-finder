# Third-party assets

SteamDeal Pro bundles the following third-party assets locally. Nothing is
loaded from a CDN or external host at runtime — all files below ship inside
the extension package.

## Font Awesome 6 Free (icons)

- **Source:** https://fontawesome.com
- **License:** Icons — [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Used as:** raw SVG path data in [`src/theme/icons.js`](src/theme/icons.js),
  rendered as inline `<svg>` elements (no icon webfont).
- **Modification:** none — path data is used as published.

## Poppins

- **Source:** https://fonts.google.com/specimen/Poppins
- **License:** [SIL Open Font License 1.1](https://openfontlicense.org/)
- **Used as:** self-hosted `.woff2` files in [`fonts/`](fonts/), weights 400/500/600/700.

## Inter

- **Source:** https://fonts.google.com/specimen/Inter
- **License:** [SIL Open Font License 1.1](https://openfontlicense.org/)
- **Used as:** a self-hosted variable `.woff2` file in [`fonts/`](fonts/),
  covering weights 400–700.

## Store favicons (EA, GOG, Epic, Ubisoft, Battle.net)

The "Other stores" comparison — deliberately restricted to exactly these
five storefronts — shows each store's own favicon next to its name and
price, in [`icons/stores/`](icons/stores/). Each was fetched once from the
store's own official domain (ea.com, gog.com, epicgames.com, ubi.com,
battle.net) and composited onto a small rounded white backing plate for
visual consistency with the rest of the UI. They are the stores' own marks,
used here purely to identify which store a price comes from — the same
descriptive, non-decorative use as a browser's own tab favicons or a
bookmarks bar. No affiliation with or endorsement by EA, GOG/CD Projekt,
Epic Games, Ubisoft, or Blizzard is claimed or implied. All trademarks are
the property of their respective owners.

## APIs consulted at runtime (not bundled, no code executed from them)

These are plain JSON/text data endpoints called via `fetch()` — no scripts,
markup, or executable content is ever loaded from them, and each is listed
explicitly in `manifest.json`'s `host_permissions`:

- **Steam Storefront API** (`store.steampowered.com`) — public, keyless.
- **IsThereAnyDeal API v2** (`api.isthereanydeal.com`) — optional, user-supplied key.
- **exchangerate.fun** (`api.exchangerate.fun`) — public, keyless.

---

SteamDeal Pro is an independent project and is **not affiliated with, endorsed
by, or sponsored by Valve Corporation, Steam, or IsThereAnyDeal**. "Steam" is a
trademark of Valve Corporation.
