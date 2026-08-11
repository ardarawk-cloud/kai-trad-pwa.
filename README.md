# KAI TRAD v1.8 — Tokocrypto Broker Connector

KAI TRAD tetap **PAPER-first**. v1.8 menambahkan lapisan broker Tokocrypto tanpa membuka live trading otomatis.

## v1.8
- Primary broker connector: **Tokocrypto**.
- Secondary broker slot: **Indodax STANDBY** untuk versi berikutnya.
- Public Tokocrypto preflight: server time + symbol/rules check.
- Signed HMAC-SHA256 Tokocrypto account/order adapter sudah disiapkan di Worker.
- MARKET BUY memakai `quoteOrderQty`; MARKET SELL memakai `quantity`.
- Order fill polling + partial-fill safe handling.
- LOT_SIZE / MARKET_LOT_SIZE / NOTIONAL execution guard tetap aktif.
- Withdrawal API **tidak diimplementasikan**.
- Live trading memakai multi-lock dan default tetap **LOCKED**.
- Existing strategy, scanner, AI validator, SL 10%, TP 30%, Safety Core v2, Performance Core, Dual USD/IDR, dan PC Fund tetap dipertahankan.

## Secret policy
Jangan pernah simpan API key/secret di GitHub atau frontend. Nanti, ketika tahap read-only/live test disetujui, gunakan Cloudflare Secrets:
- `TOKOCRYPTO_API_KEY`
- `TOKOCRYPTO_API_SECRET`
- `ADMIN_TOKEN`

Default repo **tidak** berisi secret dan **tidak** mengaktifkan live order.

## Safety locks
Live hanya dapat aktif apabila SEMUA kondisi terpenuhi:
1. `TRADING_MODE=live`
2. `PRIMARY_BROKER=tokocrypto`
3. `BROKER_LIVE_STAGE=APPROVED_AFTER_PREFLIGHT`
4. `ENABLE_LIVE_EXECUTION=YES_I_ACCEPT_RISK`
5. `TOKOCRYPTO_LIVE_ACK=I_UNDERSTAND_SPOT_RISK`
6. Tokocrypto API key + secret + admin token tersedia sebagai Cloudflare secrets.

Sebelum itu, tombol/engine tetap paper dan connector hanya bisa melakukan public preflight.
