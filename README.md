# KAI TRAD v1.9 — Indodax Primary PAPER Hardening

KAI TRAD tetap **PAPER-first**. v1.9 menyelaraskan aplikasi ke **Indodax sebagai primary public broker route** tanpa membuka live trading otomatis.

## v1.9
- Primary public compatibility/preflight: **Indodax**.
- Secondary compatibility route: **Tokocrypto**.
- Indodax public preflight memakai endpoint resmi untuk server time dan daftar pair.
- Symbol support diverifikasi sebelum UI menyatakan pair siap.
- Existing strategy, scanner, AI validator, SL 10%, TP 30%, Safety Core v2, Performance Core, Dual USD/IDR, dan PC Fund tetap dipertahankan.
- Service-worker cache diperbaiki agar modul broker ikut tersedia bersama PWA shell.
- Automated tests mencakup engine dan normalisasi/pencocokan pair Indodax.
- GitHub Actions CI menjalankan test + build pada perubahan repo.

## Safety policy
- `TRADING_MODE=paper`
- `BROKER_LIVE_STAGE=LOCKED`
- `ENABLE_LIVE_EXECUTION=NO`
- Withdrawal tidak digunakan.
- v1.9 tidak menambahkan pengirim order Indodax dan tidak membutuhkan API key/secret untuk public preflight.
- Jangan simpan API key/secret di GitHub atau frontend.

## Broker state
- **PRIMARY:** Indodax public API
- **SECONDARY:** Tokocrypto compatibility probe
- **EXECUTION:** PAPER only
- **LIVE:** LOCKED

## Development
```bash
npm test
npm run build
```

Sinyal trading bersifat probabilistik dan tidak menjamin hasil. Forward-test PAPER harus menjadi dasar evaluasi sebelum perubahan risiko atau strategi berikutnya.
