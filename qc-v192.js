export const APP_VERSION = "1.9.2";

export function assessLiquidity(candles, { lookback = 20, minActiveRatio = 0.60 } = {}) {
  const rows = Array.isArray(candles) ? candles.slice(-Math.max(1, lookback)) : [];
  const volumes = rows.map((c) => Number(c?.volume || 0)).filter(Number.isFinite);
  const activeCount = volumes.filter((v) => v > 0).length;
  const activeRatio = rows.length ? activeCount / rows.length : 0;
  const totalVolume = volumes.reduce((sum, v) => sum + Math.max(0, v), 0);
  const healthy = rows.length >= Math.min(10, lookback) && activeRatio >= minActiveRatio && totalVolume > 0;
  return {
    healthy,
    sampleSize: rows.length,
    activeCount,
    activeRatio,
    activePct: Math.round(activeRatio * 1000) / 10,
    totalVolume,
    lastVolume: rows.length ? Number(rows.at(-1)?.volume || 0) : 0,
    lookback,
    minActiveRatio,
  };
}

export function assessMultiTimeframeLiquidity(mainCandles, fastCandles, options) {
  const main = assessLiquidity(mainCandles, options);
  const fast = assessLiquidity(fastCandles, options);
  return {
    healthy: main.healthy && fast.healthy,
    main,
    fast,
  };
}

export function shouldDeduplicateWait({ previousDecisionCandle, currentDecisionCandle, reason }) {
  return reason === "WAIT_NEXT_CLOSED_CANDLE" &&
    previousDecisionCandle != null &&
    currentDecisionCandle != null &&
    previousDecisionCandle === currentDecisionCandle;
}
