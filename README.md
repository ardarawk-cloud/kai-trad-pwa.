# KAI TRAD PWA v1.5.2 — Monochrome UI + Color Candles

Phone-flat Cloudflare Workers build.

## v1.5.2
- Candlestick colors restored: green bullish candle, red bearish candle.
- UI remains monochrome.
- Signal/status colors remain enabled for readability.

## v1.5.1
- Monochrome UI retained.
- Status and indicator colors restored for easier differentiation (BUY green, SELL red, HOLD amber, ONLINE/RUNNING green).
- Candlestick chart remains monochrome.

## v1.5
- Main chart upgraded from line chart to candlestick chart.
- Visual theme changed to monochrome (black / white / gray).
- Multi-coin scanner from v1.4 remains active.

## v1.4
- Auto-scan 5 Spot markets: BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT.
- Rank setup quality every engine cycle.
- Only one open position at a time.
- Entry candidate = highest-ranked qualified BUY setup.
- AI validates only the selected best candidate.
- When a position is open, risk monitoring stays locked to that position's symbol.
- Hard Stop Loss 10% and Take Profit 30% remain locked.
- Paper mode remains default; live execution remains locked.
- Public market-data fallback from v1.3 remains active.

## Phone deploy
Upload/replace all root files in the GitHub `kai-trad-pwa` repo, then commit to `main`. Cloudflare Git integration auto-builds and deploys.

## Test
`npm test`

## Build
`npm run build`
