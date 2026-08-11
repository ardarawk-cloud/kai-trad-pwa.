# KAI TRAD PWA v1.7 — Performance & Safety Core

Phone-flat Cloudflare Workers build.

## v1.7
- Dual USD/IDR display with editable USD/IDR display rate.
- Daily Goal tracker defaults to USD 3–5; it is a display goal, never a forced-entry rule.
- PC Fund Tracker with editable real saved amount and target in IDR.
- Forward-test performance stats: closed trades, win rate, profit factor, expectancy, average win/loss and average hold.
- Safety Core v2: 3-loss circuit breaker, extended cooldown, 3-error auto-halt, abnormal volatility/volume entry guard.
- Execution guard reads exchange LOT_SIZE / MARKET_LOT_SIZE / MIN_NOTIONAL / NOTIONAL filters for live orders.
- Client order IDs added for safer live-order traceability.
- Decision Log, Market Regime, Multi-Coin scanner, color candlesticks remain active.
- Hard Stop Loss 10% and Take Profit 30% remain locked.
- Paper mode remains default and live execution remains locked.

## Paper capital
Change `Paper Capital` in Settings, save, then use `RESET PAPER` to apply the new starting balance.

## Deploy from phone
Extract ZIP, upload/replace every root file in GitHub `kai-trad-pwa`, commit to `main`, then wait for Cloudflare Git deployment.
