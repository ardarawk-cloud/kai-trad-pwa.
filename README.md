# KAI TRAD PWA — PHONE FLAT BUILD v1.1

Phone-first Cloudflare Worker + PWA trading control center.

## GitHub upload
Upload every file in this folder directly to the repository root. No folders need to be uploaded manually.

## Cloudflare build/deploy
- Build command: `npm run build`
- Deploy command: `npm run deploy`

`npm run build` automatically creates the `dist/` asset folder inside Cloudflare's build environment.

## Locked automatic trade policy
- Stop Loss: **10%** from entry.
- Take Profit: **30%** from entry.
- 10% trailing distance may protect profit earlier after price advances.

## Safety default
- Paper mode by default.
- Spot long/flat only.
- Live execution remains locked unless all required secrets are configured and `ENABLE_LIVE_EXECUTION` is explicitly changed.
