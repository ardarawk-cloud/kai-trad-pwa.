KAI TRAD v1.8 — TOKOCRYPTO BROKER CONNECTOR

GITHUB — PRODUCTION
1. Replace/upload semua file paket ini ke root repo.
2. Jangan upload node_modules.
3. Commit: KAI TRAD v1.8 Tokocrypto Connector

CLOUDFLARE — PRODUCTION
1. Tunggu GitHub auto-deploy selesai.
2. Jangan ubah secret atau live switch pada tahap ini.
3. Pastikan deployment Active 100%.

PWA — PRODUCTION
1. Tutup lalu buka KAI TRAD.
2. Jika cache lama masih tampil, refresh sekali.
3. Cari panel BROKER CONNECTOR v1.8.
4. Tekan CHECK TOKOCRYPTO.
5. PASS yang diharapkan: PUBLIC API = ONLINE dan badge CONNECTOR READY.

PENTING
- TRADING_MODE tetap PAPER.
- Live trading tetap LOCKED.
- Tidak ada withdrawal API di connector.
- API key/secret nanti masuk Cloudflare Secrets, bukan GitHub.
