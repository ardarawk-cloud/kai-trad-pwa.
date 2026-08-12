import {
  analyzeMultiTimeframe,
  computePerformanceStats,
  computeTradePlan,
  computeTradeQuality,
  detectMarketRegime,
} from "./engine.js";
import { assessMultiTimeframeLiquidity } from "./qc-v192.js";

const FEE_RATE = 0.001;
const MINUTE_MS = 60_000;
const round = (n, d = 2) => Number(Number(n || 0).toFixed(d));

export const CALIBRATION_PROFILES = Object.freeze([
  {
    id: "LOCKED_70",
    label: "Locked 70",
    mainMin: 70,
    fastMin: 55,
    weightedMin: 70,
    sidewaysWeightedMin: 75,
    sidewaysQualityMin: 70,
    bullishQualityMin: 65,
  },
  {
    id: "CONSERVATIVE_65",
    label: "Conservative 65",
    mainMin: 65,
    fastMin: 55,
    weightedMin: 65,
    sidewaysWeightedMin: 70,
    sidewaysQualityMin: 65,
    bullishQualityMin: 62,
  },
  {
    id: "BALANCED_60",
    label: "Balanced 60",
    mainMin: 60,
    fastMin: 55,
    weightedMin: 60,
    sidewaysWeightedMin: 65,
    sidewaysQualityMin: 62,
    bullishQualityMin: 60,
  },
  {
    id: "EXPLORATORY_55",
    label: "Exploratory 55",
    mainMin: 55,
    fastMin: 50,
    weightedMin: 55,
    sidewaysWeightedMin: 60,
    sidewaysQualityMin: 58,
    bullishQualityMin: 58,
  },
]);

function witaDay(ts) {
  return new Date(Number(ts) + 8 * 3600_000).toISOString().slice(0, 10);
}

function resolveHistoricalRiskExit(position, candle) {
  if (!position || !candle) return null;
  if (Number(candle.low) <= Number(position.stopPrice)) {
    return { reason: "STOP_LOSS", price: Number(position.stopPrice) };
  }
  if (Number(position.trailingStopPrice) > Number(position.entryPrice) && Number(candle.low) <= Number(position.trailingStopPrice)) {
    return { reason: "TRAILING_STOP", price: Number(position.trailingStopPrice) };
  }
  if (Number(candle.high) >= Number(position.takeProfitPrice)) {
    return { reason: "TAKE_PROFIT", price: Number(position.takeProfitPrice) };
  }
  return null;
}

export function evaluateCalibrationGate({ analysis, regime, liquidity, profile } = {}) {
  const p = profile || CALIBRATION_PROFILES[0];
  const mainScore = Number(analysis?.main?.buyScore || 0);
  const fastScore = Number(analysis?.fast?.buyScore || 0);
  const weighted = Number(analysis?.buyConfidence || 0);
  const quality = computeTradeQuality(analysis, regime);
  const abnormal = Number(analysis?.main?.indicators?.atrPct || 0) > 5 ||
    Number(analysis?.main?.indicators?.volumeRatio || 0) > 6;

  if (mainScore < p.mainMin) return { eligible: false, aligned: false, code: "MAIN_SCORE", quality };
  if (fastScore < p.fastMin) return { eligible: false, aligned: false, code: "FAST_SCORE", quality };
  if (weighted < p.weightedMin) return { eligible: false, aligned: false, code: "WEIGHTED_CONFIDENCE", quality };

  if (abnormal) return { eligible: false, aligned: true, code: "ABNORMAL_MARKET", quality };
  if (!liquidity?.healthy) return { eligible: false, aligned: true, code: "LIQUIDITY", quality };
  if (regime?.regime === "BEARISH") return { eligible: false, aligned: true, code: "BEARISH_REGIME", quality };
  if (regime?.regime === "SIDEWAYS") {
    if (weighted < p.sidewaysWeightedMin || quality < p.sidewaysQualityMin) {
      return { eligible: false, aligned: true, code: "SIDEWAYS_QUALITY", quality };
    }
  }
  if (regime?.regime === "BULLISH" && quality < p.bullishQualityMin) {
    return { eligible: false, aligned: true, code: "BULLISH_QUALITY", quality };
  }
  return { eligible: true, aligned: true, code: "ELIGIBLE", quality };
}

export function buildCalibrationTimeline({ mainCandles = [], fastCandles = [], startMs = 0 } = {}) {
  const main = [...mainCandles].sort((a, b) => a.openTime - b.openTime);
  const fast = [...fastCandles].sort((a, b) => a.openTime - b.openTime);
  const timeline = [];
  let fastEnd = 0;

  for (let i = 0; i < main.length; i++) {
    const candle = main[i];
    while (fastEnd < fast.length && fast[fastEnd].closeTime <= candle.closeTime) fastEnd += 1;
    if (candle.closeTime < Number(startMs || 0)) continue;
    if (i < 69 || fastEnd < 70) continue;

    const mainWindow = main.slice(Math.max(0, i - 139), i + 1);
    const fastWindow = fast.slice(Math.max(0, fastEnd - 140), fastEnd);
    if (mainWindow.length < 70 || fastWindow.length < 70) continue;

    const analysis = analyzeMultiTimeframe(mainWindow, fastWindow, 70);
    const regime = detectMarketRegime(mainWindow);
    const liquidity = assessMultiTimeframeLiquidity(mainWindow, fastWindow);
    timeline.push({
      candle,
      analysis,
      regime,
      liquidity,
      quality: computeTradeQuality(analysis, regime),
    });
  }
  return timeline;
}

function markEquity(account, position, price) {
  account.equity = account.cash + (position ? position.qty * Number(price) : 0);
  account.peakEquity = Math.max(account.peakEquity, account.equity);
  const dd = account.peakEquity > 0 ? ((account.peakEquity - account.equity) / account.peakEquity) * 100 : 0;
  account.maxDrawdownPct = Math.max(account.maxDrawdownPct, dd);
}

function openPosition({ account, signal, candle, config, trades }) {
  const price = Number(candle.open);
  const plan = computeTradePlan({
    equity: account.equity,
    cash: account.cash,
    price,
    atrPct: Number(signal.analysis?.main?.indicators?.atrPct || 0),
    riskPerTrade: config.riskPerTrade,
    maxPositionPct: config.maxPositionPct,
    stopLossPct: 0.10,
    takeProfitPct: 0.30,
  });
  if (!Number.isFinite(plan.notional) || plan.notional <= 0 || plan.notional + plan.notional * FEE_RATE > account.cash) return null;

  const fee = plan.notional * FEE_RATE;
  account.cash -= plan.notional + fee;
  trades.push({
    side: "BUY",
    at: new Date(candle.openTime).toISOString(),
    price,
    qty: plan.qty,
    notional: plan.notional,
    pnl: null,
    fee,
    mode: "calibration",
    reason: signal.profileId,
  });

  return {
    qty: plan.qty,
    entryPrice: price,
    notional: plan.notional,
    cost: plan.notional + fee,
    stopPrice: price * 0.90,
    takeProfitPrice: price * 1.30,
    trailingPct: 0.10,
    trailingStopPrice: price * 0.90,
    highWaterPrice: price,
    openedAt: candle.openTime,
  };
}

function closePosition({ account, position, price, atMs, reason, trades }) {
  const proceeds = position.qty * Number(price);
  const fee = proceeds * FEE_RATE;
  account.cash += proceeds - fee;
  const pnl = (proceeds - fee) - position.cost;
  account.realizedPnl += pnl;
  account.consecutiveLosses = pnl < 0 ? account.consecutiveLosses + 1 : 0;
  trades.push({
    side: "SELL",
    at: new Date(atMs).toISOString(),
    price: Number(price),
    qty: position.qty,
    notional: proceeds,
    pnl,
    fee,
    holdingMinutes: Math.max(0, (atMs - position.openedAt) / MINUTE_MS),
    entryPrice: position.entryPrice,
    mode: "calibration",
    reason,
  });
}

export function simulateCalibrationProfile({
  timeline = [],
  profile,
  config = {},
} = {}) {
  const p = profile || CALIBRATION_PROFILES[0];
  const startingBalance = Number(config.startingBalance || config.paperStartingBalanceUsd || 10000);
  const riskPerTrade = Number(config.riskPerTrade || 0.01);
  const maxPositionPct = Number(config.maxPositionPct || 0.20);
  const maxDailyLossPct = Number(config.maxDailyLossPct || 0.03);
  const maxConsecutiveLosses = Number(config.maxConsecutiveLosses || 3);
  const lossStreakCooldownMinutes = Number(config.lossStreakCooldownMinutes || 240);

  const account = {
    cash: startingBalance,
    equity: startingBalance,
    realizedPnl: 0,
    peakEquity: startingBalance,
    maxDrawdownPct: 0,
    consecutiveLosses: 0,
    dailyStartEquity: startingBalance,
    dailyDate: timeline[0] ? witaDay(timeline[0].candle.openTime) : null,
  };
  const trades = [];
  const blocked = {};
  let alignedSignals = 0;
  let eligibleSignals = 0;
  let position = null;
  let pendingBuy = null;
  let pendingSell = null;
  let cooldownUntil = 0;

  for (const item of timeline) {
    const candle = item.candle;
    const day = witaDay(candle.openTime);
    if (day !== account.dailyDate) {
      account.dailyDate = day;
      account.dailyStartEquity = account.equity;
    }

    if (pendingSell && position) {
      closePosition({ account, position, price: candle.open, atMs: candle.openTime, reason: pendingSell, trades });
      position = null;
      const lossBreaker = account.consecutiveLosses >= maxConsecutiveLosses;
      cooldownUntil = candle.openTime + (lossBreaker ? lossStreakCooldownMinutes : 15) * MINUTE_MS;
      pendingSell = null;
    }

    if (pendingBuy && !position) {
      position = openPosition({
        account,
        signal: pendingBuy,
        candle,
        config: { riskPerTrade, maxPositionPct },
        trades,
      });
      pendingBuy = null;
    }

    if (position) {
      const riskExit = resolveHistoricalRiskExit(position, candle);
      if (riskExit) {
        closePosition({ account, position, price: riskExit.price, atMs: candle.closeTime, reason: riskExit.reason, trades });
        position = null;
        const lossBreaker = account.consecutiveLosses >= maxConsecutiveLosses;
        cooldownUntil = candle.closeTime + (lossBreaker ? lossStreakCooldownMinutes : 15) * MINUTE_MS;
      } else {
        position.highWaterPrice = Math.max(position.highWaterPrice, Number(candle.high));
        position.trailingStopPrice = Math.max(position.trailingStopPrice, position.highWaterPrice * (1 - position.trailingPct));
      }
    }

    markEquity(account, position, candle.close);

    if (position) {
      if (item.analysis.action === "SELL") pendingSell = "MULTI_TIMEFRAME_EXIT";
      continue;
    }

    const gate = evaluateCalibrationGate({
      analysis: item.analysis,
      regime: item.regime,
      liquidity: item.liquidity,
      profile: p,
    });
    blocked[gate.code] = (blocked[gate.code] || 0) + 1;
    if (gate.aligned) alignedSignals += 1;
    if (!gate.eligible) continue;

    if (candle.closeTime < cooldownUntil) {
      blocked.COOLDOWN = (blocked.COOLDOWN || 0) + 1;
      continue;
    }
    const dailyLossPct = account.dailyStartEquity > 0
      ? Math.max(0, (account.dailyStartEquity - account.equity) / account.dailyStartEquity)
      : 0;
    if (dailyLossPct >= maxDailyLossPct) {
      blocked.DAILY_LOSS = (blocked.DAILY_LOSS || 0) + 1;
      continue;
    }

    eligibleSignals += 1;
    pendingBuy = { profileId: p.id, analysis: item.analysis };
  }

  if (position && timeline.length) {
    const finalCandle = timeline.at(-1).candle;
    closePosition({ account, position, price: finalCandle.close, atMs: finalCandle.closeTime, reason: "END_OF_WINDOW", trades });
    position = null;
    markEquity(account, null, finalCandle.close);
  }

  const performance = computePerformanceStats(trades);
  return {
    id: p.id,
    label: p.label,
    gates: p,
    decisions: timeline.length,
    alignedSignals,
    eligibleSignals,
    blocked,
    metrics: {
      closedTrades: performance.closedTrades,
      wins: performance.wins,
      losses: performance.losses,
      winRatePct: performance.winRatePct,
      profitFactor: performance.profitFactor,
      expectancyUsd: performance.expectancyUsd,
      netPnl: round(account.equity - startingBalance, 2),
      returnPct: startingBalance > 0 ? round(((account.equity - startingBalance) / startingBalance) * 100, 2) : 0,
      maxDrawdownPct: round(account.maxDrawdownPct, 2),
      estimatedFeesUsd: performance.estimatedFeesUsd,
      sampleStatus: performance.closedTrades >= 30
        ? "BUILDING_CONFIDENCE"
        : performance.closedTrades >= 10
          ? "EXPLORATORY_SAMPLE"
          : "LOW_SAMPLE",
    },
  };
}

export function runCalibrationLab({
  mainCandles = [],
  fastCandles = [],
  startMs = 0,
  config = {},
  profiles = CALIBRATION_PROFILES,
} = {}) {
  const timeline = buildCalibrationTimeline({ mainCandles, fastCandles, startMs });
  const results = profiles.map((profile) => simulateCalibrationProfile({ timeline, profile, config }));
  return {
    version: "1.10.2",
    mode: "HISTORICAL_CALIBRATION_ONLY",
    productionChanged: false,
    productionThreshold: 70,
    decisions: timeline.length,
    profiles: results,
    interpretation: "Calibration profiles are historical experiments only. No profile is promoted to production automatically.",
  };
}
