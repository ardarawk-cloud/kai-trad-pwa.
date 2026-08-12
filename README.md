# KAI TRAD v1.10 — Strategy Validation Lab

KAI TRAD tetap **PAPER-first**. v1.10 mempertahankan Indodax Native Market Data, Safety Core, Liquidity Guard, Decision Log Dedup, dan Mobile Performance dari release sebelumnya, lalu menambahkan **Historical Replay / Backtest** untuk mengevaluasi strategy core tanpa membuka jalur live trading.

## v1.10
- **Strategy Validation Lab:** backtest manual dari dashboard PWA.
- Historical OHLC memakai **Indodax Public REST API** `/tradingview/history_v2`.
- Window validasi dibatasi **1–7 hari** agar request dan compute tetap terkendali.
- Main timeframe validasi: **15m**.
- Fast timeframe validasi: **5m**, dibentuk dari candle 1m resmi Indodax seperti engine PAPER production.
- Replay memakai entry pada candle berikutnya setelah signal close untuk mengurangi look-ahead bias.
- PAPER fee simulation tetap **0.1% per side**, mengikuti engine PAPER saat ini.
- SL tetap **10%**, TP tetap **30%**, max position/risk/daily-loss/cooldown mengikuti konfigurasi aman KAI TRAD.
- Output: closed trades, win rate, profit factor, expectancy, net P&L, max drawdown, fee estimate, decision count, dan blocked-entry counters.
- **AI validator tidak direplay.** Backtest ini mengukur deterministic strategy core sebelum runtime AI veto. Forward-test PAPER tetap menjadi sumber utama untuk performa final AI-gated.

## Safety policy
- `TRADING_MODE=paper`
- `BROKER_LIVE_STAGE=LOCKED`
- `ENABLE_LIVE_EXECUTION=NO`
- Historical Validation Lab tidak memiliki order execution.
- Tidak menggunakan Indodax private API key/secret.
- Tidak ada Indodax live order sender.
- Withdrawal tetap disabled.

## Validation workflow
1. Biarkan forward-test PAPER production tetap berjalan.
2. Jalankan Historical Replay untuk 1, 3, atau 7 hari.
3. Evaluasi jumlah trade terlebih dahulu sebelum membaca win rate/profit factor sebagai sinyal kuat.
4. Bandingkan pola backtest dengan forward-test; jangan menganggap historical result sebagai jaminan hasil ke depan.
5. Tuning strategi hanya dilakukan setelah sampel cukup dan safety metrics tetap terkendali.

## Development
```bash
npm test
npm run build
npx wrangler deploy --dry-run --outdir .wrangler-dry
```

Sinyal trading bersifat probabilistik dan hasil historis tidak menjamin performa masa depan.
