# KAI TRAD v1.9.2 — Indodax PAPER QC Hardening

KAI TRAD tetap **PAPER-first**. v1.9.2 mempertahankan Indodax Native Market Data dari v1.9.1 dan menambahkan quality-control guard berdasarkan hasil forward-test production.

## v1.9.2
- Primary public broker route: **Indodax**.
- PAPER market-data source: **Indodax Public REST API**.
- OHLC history tetap memakai `/tradingview/history_v2` dan ticker memakai `/api/ticker/{pair_id}`.
- Fast timeframe 5m tetap dibentuk lokal dari lima candle 1m.
- **Liquidity Data Guard:** entry BUY hanya eligible bila main TF dan fast TF masing-masing memiliki sedikitnya 60% candle dengan volume positif pada 20 candle terakhir. Candle volume 0 sesekali tetap ditoleransi.
- **Decision Log Dedup:** `WAIT_NEXT_CLOSED_CANDLE` pada candle yang sama tetap menjadi status live tetapi tidak lagi ditulis berulang ke history setiap siklus engine.
- **Internal Version Sync:** state dan `/api/health` melaporkan v1.9.2 melalui Worker QC wrapper.
- Existing strategy, multi-coin scanner, AI validator, SL 10%, TP 30%, Safety Core v2, Performance Core, Dual USD/IDR, dan PC Fund tetap dipertahankan.

## Safety policy
- `TRADING_MODE=paper`
- `BROKER_LIVE_STAGE=LOCKED`
- `ENABLE_LIVE_EXECUTION=NO`
- Withdrawal tidak digunakan.
- Tidak ada Indodax private API key/secret dan tidak ada Indodax order sender.
- Liquidity guard hanya memperketat entry; tidak membuka jalur live trading.

## Broker & data state
- **PRIMARY BROKER:** Indodax public API
- **MARKET DATA:** Indodax native public REST
- **EXECUTION:** PAPER only
- **LIQUIDITY GUARD:** ACTIVE
- **DECISION LOG DEDUP:** ACTIVE
- **LIVE:** LOCKED

## Development
```bash
npm test
npm run build
```

Sinyal trading bersifat probabilistik dan tidak menjamin hasil. Forward-test PAPER tetap menjadi dasar evaluasi sebelum perubahan risiko atau strategi berikutnya.
