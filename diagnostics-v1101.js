import {
  analyzeMultiTimeframe,
  computeTradeQuality,
  detectMarketRegime,
} from "./engine.js";
import { assessMultiTimeframeLiquidity } from "./qc-v192.js";

const round = (n, d = 2) => Number(Number(n || 0).toFixed(d));

function pct(count, total) {
  return total > 0 ? round((Number(count || 0) / total) * 100, 1) : 0;
}

function percentile(values, p) {
  if (!Array.isArray(values) || !values.length) return 0;
  const sorted = [...values].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return round(sorted[index], 1);
}

export function classifyEntryDecision({ analysis, regime, liquidity, minSignalConfidence = 70 } = {}) {
  const threshold = Number(minSignalConfidence || 70);
  const fastThreshold = Math.max(55, threshold - 15);
  const mainScore = Number(analysis?.main?.buyScore || 0);
  const fastScore = Number(analysis?.fast?.buyScore || 0);
  const buyConfidence = Number(analysis?.buyConfidence || 0);
  const quality = computeTradeQuality(analysis, regime);
  const abnormal = Number(analysis?.main?.indicators?.atrPct || 0) > 5 ||
    Number(analysis?.main?.indicators?.volumeRatio || 0) > 6;

  if (mainScore < threshold) return { code: "MAIN_SCORE", quality, mainScore, fastScore, buyConfidence };
  if (fastScore < fastThreshold) return { code: "FAST_SCORE", quality, mainScore, fastScore, buyConfidence };
  if (buyConfidence < threshold) return { code: "WEIGHTED_CONFIDENCE", quality, mainScore, fastScore, buyConfidence };
  if (abnormal) return { code: "ABNORMAL_MARKET", quality, mainScore, fastScore, buyConfidence };
  if (!liquidity?.healthy) return { code: "LIQUIDITY", quality, mainScore, fastScore, buyConfidence };
  if (regime?.regime === "BEARISH") return { code: "BEARISH_REGIME", quality, mainScore, fastScore, buyConfidence };
  if (regime?.regime === "SIDEWAYS" && (buyConfidence < Math.min(95, threshold + 5) || quality < 70)) {
    return { code: "SIDEWAYS_QUALITY", quality, mainScore, fastScore, buyConfidence };
  }
  if (regime?.regime === "BULLISH" && quality < 65) {
    return { code: "BULLISH_QUALITY", quality, mainScore, fastScore, buyConfidence };
  }
  return { code: "ELIGIBLE", quality, mainScore, fastScore, buyConfidence };
}

export function diagnoseEntryRejections({
  mainCandles = [],
  fastCandles = [],
  startMs = 0,
  minSignalConfidence = 70,
  thresholds = [70, 65, 60],
} = {}) {
  const main = [...mainCandles].sort((a, b) => a.openTime - b.openTime);
  const fast = [...fastCandles].sort((a, b) => a.openTime - b.openTime);
  const counts = {
    MAIN_SCORE: 0,
    FAST_SCORE: 0,
    WEIGHTED_CONFIDENCE: 0,
    ABNORMAL_MARKET: 0,
    LIQUIDITY: 0,
    BEARISH_REGIME: 0,
    SIDEWAYS_QUALITY: 0,
    BULLISH_QUALITY: 0,
    ELIGIBLE: 0,
  };
  const regimes = { BULLISH: 0, SIDEWAYS: 0, BEARISH: 0 };
  const scores = { main: [], fast: [], weighted: [], quality: [] };
  const sensitivity = Object.fromEntries(thresholds.map((t) => [String(t), { rawAligned: 0, eligible: 0 }]));
  let decisions = 0;
  let fastEnd = 0;

  for (let i = 0; i < main.length; i++) {
    const candle = main[i];
    while (fastEnd < fast.length && fast[fastEnd].closeTime <= candle.closeTime) fastEnd += 1;
    if (candle.closeTime < Number(startMs || 0)) continue;
    if (i < 69 || fastEnd < 70) continue;

    const mainWindow = main.slice(Math.max(0, i - 139), i + 1);
    const fastWindow = fast.slice(Math.max(0, fastEnd - 140), fastEnd);
    if (mainWindow.length < 70 || fastWindow.length < 70) continue;

    const analysis = analyzeMultiTimeframe(mainWindow, fastWindow, Number(minSignalConfidence || 70));
    const regime = detectMarketRegime(mainWindow);
    const liquidity = assessMultiTimeframeLiquidity(mainWindow, fastWindow);
    const classified = classifyEntryDecision({ analysis, regime, liquidity, minSignalConfidence });

    decisions += 1;
    counts[classified.code] = (counts[classified.code] || 0) + 1;
    regimes[regime.regime] = (regimes[regime.regime] || 0) + 1;
    scores.main.push(classified.mainScore);
    scores.fast.push(classified.fastScore);
    scores.weighted.push(classified.buyConfidence);
    scores.quality.push(classified.quality);

    const abnormal = Number(analysis.main?.indicators?.atrPct || 0) > 5 ||
      Number(analysis.main?.indicators?.volumeRatio || 0) > 6;
    for (const threshold of thresholds) {
      const key = String(threshold);
      const fastThreshold = Math.max(55, threshold - 15);
      const aligned = analysis.main.buyScore >= threshold &&
        analysis.fast.buyScore >= fastThreshold &&
        analysis.buyConfidence >= threshold;
      if (!aligned) continue;
      sensitivity[key].rawAligned += 1;
      if (abnormal || !liquidity.healthy || regime.regime === "BEARISH") continue;
      const quality = computeTradeQuality(analysis, regime);
      if (regime.regime === "SIDEWAYS" && (analysis.buyConfidence < Math.min(95, threshold + 5) || quality < 70)) continue;
      if (regime.regime === "BULLISH" && quality < 65) continue;
      sensitivity[key].eligible += 1;
    }
  }

  const rejectionRows = Object.entries(counts)
    .filter(([code]) => code !== "ELIGIBLE")
    .map(([code, count]) => ({ code, count, pct: pct(count, decisions) }))
    .sort((a, b) => b.count - a.count);

  return {
    version: "1.10.1",
    decisions,
    threshold: Number(minSignalConfidence || 70),
    fastThreshold: Math.max(55, Number(minSignalConfidence || 70) - 15),
    counts,
    topReject: rejectionRows[0] || { code: "NONE", count: 0, pct: 0 },
    rejectionRows,
    regimes: Object.fromEntries(Object.entries(regimes).map(([key, count]) => [key, { count, pct: pct(count, decisions) }])),
    scoreDistribution: {
      main: { max: Math.max(0, ...scores.main), p50: percentile(scores.main, 50), p90: percentile(scores.main, 90), p95: percentile(scores.main, 95) },
      fast: { max: Math.max(0, ...scores.fast), p50: percentile(scores.fast, 50), p90: percentile(scores.fast, 90), p95: percentile(scores.fast, 95) },
      weighted: { max: Math.max(0, ...scores.weighted), p50: percentile(scores.weighted, 50), p90: percentile(scores.weighted, 90), p95: percentile(scores.weighted, 95) },
      quality: { max: Math.max(0, ...scores.quality), p50: percentile(scores.quality, 50), p90: percentile(scores.quality, 90), p95: percentile(scores.quality, 95) },
    },
    thresholdSensitivity: sensitivity,
  };
}
