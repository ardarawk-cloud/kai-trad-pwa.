# KAI TRAD v1.10.2 — Scoring & Entry Calibration Lab

KAI TRAD tetap **PAPER-first**. v1.10.2 mempertahankan Historical Replay, Rejection Diagnostics, Safety Core, dan forward-test production, lalu menambahkan **Scoring & Entry Calibration Lab** untuk membandingkan beberapa entry-gate profile tanpa mengubah strategi production.

## v1.10.2
- Satu kali Historical Replay memakai dataset Indodax yang sama untuk baseline, rejection diagnostics, dan calibration profiles.
- Calibration profile yang dibandingkan:
  - **LOCKED_70** — gate production saat ini.
  - **CONSERVATIVE_65** — sedikit lebih longgar.
  - **BALANCED_60** — profile eksplorasi menengah.
  - **EXPLORATORY_55** — profile lab paling longgar.
- Semua profile tetap memblokir bearish regime, abnormal market, dan liquidity yang tidak sehat.
- Replay tetap memakai entry pada candle berikutnya setelah keputusan, fee PAPER 0.1% per side, SL 10%, TP 30%, trailing 10%, daily-loss guard, dan loss-streak cooldown.
- Output setiap profile: aligned signals, eligible signals, closed trades, win rate, profit factor, expectancy, net P&L, max drawdown, fee estimate, dan sample status.
- Tidak ada profile yang otomatis dipilih atau dipromosikan ke production.
- `MIN_SIGNAL_CONFIDENCE` production tetap **70**.
- AI validator tidak direplay; forward-test PAPER tetap diperlukan sebelum perubahan production apa pun.

## Tujuan kalibrasi
Hasil BTCUSDT dan ETHUSDT 7 hari pada v1.10.1 menunjukkan zero eligible BUY dengan pola rejection berbeda. v1.10.2 menguji apakah masalah dapat diperbaiki hanya lewat entry-gate calibration atau apakah scoring formula perlu didesain ulang.

Interpretasi utama:
1. Jika profile lebih longgar tetap menghasilkan 0 trade, scoring formula perlu dibedah lebih dalam.
2. Jika trade muncul tetapi expectancy negatif atau drawdown memburuk, melonggarkan gate bukan solusi.
3. Jika satu atau lebih profile menghasilkan sampel yang sehat, profile tersebut tetap harus diuji pada market/window lain dan forward-test PAPER sebelum dipertimbangkan untuk production.

## Safety policy
- `TRADING_MODE=paper`
- `BROKER_LIVE_STAGE=LOCKED`
- `ENABLE_LIVE_EXECUTION=NO`
- `MIN_SIGNAL_CONFIDENCE=70` tetap production.
- Calibration Lab hanya historical/read-only.
- Tidak ada order execution dari calibration endpoint.
- Tidak menggunakan Indodax private API key/secret.
- Tidak ada Indodax live order sender.
- Withdrawal tetap disabled.

## Validation workflow
1. Jalankan BTCUSDT 7 hari.
2. Baca Rejection Diagnostics dan tabel Calibration Profiles.
3. Jalankan ETHUSDT 7 hari.
4. Bandingkan trade count, expectancy, profit factor, dan max drawdown lintas profile dan market.
5. Jangan mengubah production hanya karena satu profile terlihat bagus pada satu window.

## Development
```bash
npm test
npm run build
npx wrangler deploy --dry-run --outdir .wrangler-dry
```

Sinyal trading bersifat probabilistik. Hasil historis tidak menjamin performa masa depan.
