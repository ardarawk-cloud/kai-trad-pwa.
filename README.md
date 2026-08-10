# KAI TRAD PWA — PHONE FLAT BUILD v1.0

Phone-first Cloudflare Worker + PWA trading control center.

## GitHub upload
Upload every file in this folder directly to the repository root. No folders need to be uploaded manually.

## Cloudflare build/deploy
- Build command: `npm run build`
- Deploy command: `npm run deploy`

`npm run build` automatically creates the `dist/` asset folder inside Cloudflare's build environment.

## Safety default
- Paper mode by default.
- Spot long/flat only.
- Live execution remains locked unless all required secrets are configured and `ENABLE_LIVE_EXECUTION` is explicitly changed.

## v1.3 Market Data Hotfix
Public market-data traffic uses Binance's market-data-only endpoint first (`data-api.binance.vision`) with official REST endpoint fallbacks. Live/private trading remains isolated on `TRADE_BASE_URL` (`api.binance.com`).
