export const WITA_OFFSET_MS = 8 * 60 * 60 * 1000;

export function witaDayFromTs(ts = Date.now()) {
  const ms = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + WITA_OFFSET_MS).toISOString().slice(0, 10);
}

export function realizedPnlForWitaDay(trades = [], day = witaDayFromTs()) {
  if (!day || !Array.isArray(trades)) return 0;
  return trades.reduce((sum, trade) => {
    if (trade?.side !== "SELL") return sum;
    const pnl = Number(trade?.pnl);
    if (!Number.isFinite(pnl)) return sum;
    if (witaDayFromTs(trade?.at) !== day) return sum;
    return sum + pnl;
  }, 0);
}
