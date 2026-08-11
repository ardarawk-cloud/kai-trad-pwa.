# KAI TRAD PWA v1.6.1 — Wolf Identity + Market Regime

Phone-flat Cloudflare Workers build.

## v1.6.1
- New original geometric wolf-head KAI TRAD identity.
- Wolf logo used in header, favicon, and PWA install icon.
- Functional control colors restored: START green, STOP red, SCAN NOW blue.
- v1.6 regime detector, quality score, decision log, candle UI, and multi-coin engine remain active.

## v1.6
- Market Regime Detector: BULLISH / BEARISH / SIDEWAYS.
- Regime-aware entry gate for conservative Spot long/flat execution.
- Trade Quality Score for every ranked market.
- Decision Log records why the robot trades or waits.
- Functional robot buttons restored: START green, STOP red, SCAN NOW blue.
- Monochrome dashboard retained.
- Candles remain green/red.
- Multi-coin scanner: BTC, ETH, BNB, SOL, XRP.
- Hard Stop Loss 10% and Take Profit 30% remain locked.
- Paper mode remains default; live execution remains locked.

## Phone deploy
Upload/replace all root files in GitHub `kai-trad-pwa`, commit to `main`, then wait for Cloudflare Git auto-deploy.

## Test
`npm test`

## Build
`npm run build`
