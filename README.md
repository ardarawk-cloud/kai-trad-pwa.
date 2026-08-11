# KAI TRAD v1.9.1 — Indodax Native Market Data PAPER

KAI TRAD tetap **PAPER-first**. v1.9.1 memindahkan sumber market-data publik untuk scanner, signal engine, dan chart dari Binance ke **Indodax** tanpa membuka live trading otomatis.

## v1.9.1
- Primary public broker route: **Indodax**.
- PAPER market-data source: **Indodax Public REST API**.
- OHLC history memakai endpoint resmi `/tradingview/history_v2`.
- Ticker memakai endpoint resmi `/api/ticker/{pair_id}`.
- Pair selalu diverifikasi dari `/api/pairs`; pair yang tidak tersedia akan dilewati scanner, bukan ditebak atau diganti ke quote currency lain.
- Main timeframe 15m/30m/1h memakai timeframe resmi Indodax secara langsung.
- Fast timeframe 5m dibentuk lokal dari lima candle 1m resmi Indodax karena public OHLC REST resmi tidak mendokumentasikan tf=5.
- Existing strategy, multi-coin scanner, AI validator, SL 10%, TP 30%, Safety Core v2, Performance Core, Dual USD/IDR, dan PC Fund tetap dipertahankan.
- Binance market-data code dipertahankan hanya sebagai compatibility path; environment PAPER aktif mengarah ke `https://indodax.com`.

## Safety policy
- `TRADING_MODE=paper`
- `BROKER_LIVE_STAGE=LOCKED`
- `ENABLE_LIVE_EXECUTION=NO`
- Withdrawal tidak digunakan.
- v1.9.1 tidak menambahkan pengirim order Indodax dan tidak membutuhkan API key/secret untuk market data publik.
- Jangan simpan API key/secret di GitHub atau frontend.

## Broker & data state
- **PRIMARY BROKER:** Indodax public API
- **MARKET DATA:** Indodax native public REST
- **SECONDARY:** Tokocrypto compatibility probe
- **EXECUTION:** PAPER only
- **LIVE:** LOCKED

## Development
```bash
npm test
npm run build
```

Sinyal trading bersifat probabilistik dan tidak menjamin hasil. Forward-test PAPER harus menjadi dasar evaluasi sebelum perubahan risiko atau strategi berikutnya.
