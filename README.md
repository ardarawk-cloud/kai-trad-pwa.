# KAI TRAD v1.10.1 — Rejection Diagnostics

KAI TRAD tetap **PAPER-first**. v1.10.1 mempertahankan Strategy Validation Lab v1.10 dan menambahkan **Rejection Diagnostics** untuk menjelaskan kenapa historical decision tidak lolos menjadi BUY sebelum AI validator.

## v1.10.1
- Historical Replay / Backtest tetap memakai **Indodax Public REST API**.
- Window validasi tetap **1–7 hari**, main TF 15m dan fast TF 5m.
- Diagnostic gate memisahkan penolakan karena:
  - main-frame buy score,
  - fast-frame buy score,
  - weighted confidence,
  - abnormal market,
  - liquidity,
  - bearish regime,
  - sideways quality gate,
  - bullish quality gate.
- Menampilkan distribusi score **P50 / P90 / P95 / max**.
- Menampilkan regime distribution BULLISH / SIDEWAYS / BEARISH.
- Menambahkan **threshold sensitivity 70 / 65 / 60** berupa jumlah aligned BUY dan final pre-AI eligible BUY pada threshold hipotetis.
- Threshold sensitivity hanya analisis historis; **tidak mengubah MIN_SIGNAL_CONFIDENCE production**.
- AI validator tetap tidak direplay. Forward-test PAPER tetap sumber utama untuk performa final AI-gated.

## Safety policy
- `TRADING_MODE=paper`
- `BROKER_LIVE_STAGE=LOCKED`
- `ENABLE_LIVE_EXECUTION=NO`
- Historical Validation Lab tidak memiliki order execution.
- Tidak menggunakan Indodax private API key/secret.
- Tidak ada Indodax live order sender.
- Withdrawal tetap disabled.

## Validation workflow
1. Jalankan BTCUSDT dan ETHUSDT pada window 7 hari.
2. Baca **Top Reject** dan score P95 terlebih dahulu.
3. Bandingkan threshold sensitivity 70/65/60.
4. Jangan tuning production berdasarkan satu market atau satu window saja.
5. Perubahan threshold/strategy hanya dilakukan setelah diagnostics menunjukkan pola konsisten dan Safety Core tetap terkunci.

## Development
```bash
npm test
npm run build
npx wrangler deploy --dry-run --outdir .wrangler-dry
```

Sinyal trading bersifat probabilistik dan hasil historis tidak menjamin performa masa depan.
