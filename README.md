# KAI TRAD v1.10.4 — Volume Integrity & Signal Coupling Audit

KAI TRAD tetap **PAPER-first**. v1.10.4 mempertahankan Historical Replay, Rejection Diagnostics, Calibration Lab, Post-Alignment Funnel, Safety Core, dan forward-test production, lalu menambahkan audit khusus untuk memeriksa apakah bonus volume pada scoring berinteraksi buruk dengan Abnormal Market dan Liquidity Guard.

## v1.10.4
- Mengukur zero-volume ratio pada main TF 15m dan fast TF 5m.
- Mengukur distribusi `volumeRatio` P50/P90/P95/max serta frekuensi bonus volume dan abnormal-volume threshold.
- Membandingkan setiap calibration profile dengan dua jalur:
  - **CURRENT** — scoring historis saat ini.
  - **VOLUME-NEUTRAL** — hanya menghapus bonus `+8` volume confirmation dari main/fast score.
- Menghitung kandidat alignment yang hanya muncul karena bonus volume (`volume-created aligned`).
- Mengukur berapa volume-created candidate yang kemudian diblokir oleh `ABNORMAL_MARKET` atau `LIQUIDITY`.
- Abnormal, liquidity, regime, quality, cooldown, dan daily-loss guard **tetap aktif** pada jalur audit.
- Audit hanya historical/read-only dan tidak mempromosikan profile atau parameter secara otomatis.

## Kenapa audit ini diperlukan
BTCUSDT dan ETHUSDT 7 hari pada v1.10.3 menunjukkan semua kandidat yang sudah lolos score alignment berhenti pada dua gate pertama: `ABNORMAL_MARKET` dan `LIQUIDITY`. v1.10.4 menguji apakah bonus volume ikut menciptakan kandidat yang langsung dibunuh oleh kedua guard tersebut sebelum kita mengubah strategi production.

## Safety policy
- `TRADING_MODE=paper`
- `BROKER_LIVE_STAGE=LOCKED`
- `ENABLE_LIVE_EXECUTION=NO`
- `MIN_SIGNAL_CONFIDENCE=70` tetap production.
- Liquidity Guard tetap aktif.
- Audit tidak memiliki order execution.
- Tidak menggunakan Indodax private API key/secret.
- Tidak ada Indodax live order sender.

## Validation workflow
1. Jalankan BTCUSDT 7 hari.
2. Baca **Volume Integrity & Signal Coupling**.
3. Catat zero-volume main/fast, ratio P95/max, CURRENT vs NEUTRAL, volume-created, dan guard-blocked coupling.
4. Ulangi ETHUSDT 7 hari.
5. Baru tentukan apakah formula volume, data-quality guard, atau keduanya perlu dikalibrasi.

## Development
```bash
npm test
npm run build
npx wrangler deploy --dry-run --outdir .wrangler-dry
```

Sinyal trading bersifat probabilistik. Hasil historis tidak menjamin performa masa depan.
