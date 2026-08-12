import {
  analyzeMultiTimeframe,
  computePerformanceStats,
  computeTradePlan,
  computeTradeQuality,
  detectMarketRegime,
  isRegimeEntryEligible,
} from "./engine.js";
import { assessMultiTimeframeLiquidity } from "./qc-v192.js";

const round = (n, d = 8) => Number(Number(n || 0).toFixed(d));
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const FEE_RATE = 0.001;
const MINUTE_MS = 60_000;

function witaDay(ts) {
  return new Date(Number(ts) + 8 * 3600_000).toISOString().slice(0, 10);
}

export function normalizeBacktestConfig(input = {}) {
  const minSignalConfidence = clamp(Math.round(Number(input.minSignalConfidence || 70)), 60, 90);
  return {
    startingBalance: clamp(Number(input.startingBalance || input.paperStartingBalanceUsd || 10000), 10, 1_000_000),
    riskPerTrade: clamp(Number(input.riskPerTrade || 0.01), 0.0025, 0.02),
    maxPositionPct: clamp(Number(input.maxPositionPct || 0.20), 0.05, 0.50),
    maxDailyLossPct: clamp(Number(input.maxDailyLossPct || 0.03), 0.01, 0.08),
    minSignalConfidence,
    stopLossPct: 0.10,
    takeProfitPct: 0.30,
    maxConsecutiveLosses: clamp(Math.round(Number(input.maxConsecutiveLosses || 3)), 2, 6),
    lossStreakCooldownMinutes: clamp(Math.round(Number(input.lossStreakCooldownMinutes || 240)), 30, 1440),
  };
}

export function resolveHistoricalRiskExit(position, candle) {
  if (!position || !candle) return null;
  const low = Number(candle.low);
  const high = Number(candle.high);
  if (low <= Number(position.stopPrice)) return { reason: "STOP_LOSS", price: Number(position.stopPrice) };
  if (Number(position.trailingStopPrice) > Number(position.entryPrice) && low <= Number(position.trailingStopPrice)) {
    return { reason: "TRAILING_STOP", price: Number(position.trailingStopPrice) };
  }
  if (high >= Number(position.takeProfitPrice)) return { reason: "TAKE_PROFIT", price: Number(position.takeProfitPrice) };
  return null;
}

function markEquity(account, position, price) {
  const equity = account.cash + (position ? position.qty * Number(price) : 0);
  account.equity = equity;
  account.peakEquity = Math.max(account.peakEquity, equity);
  const dd = account.peakEquity > 0 ? ((account.peakEquity - equity) / account.peakEquity) * 100 : 0;
  account.maxDrawdownPct = Math.max(account.maxDrawdownPct, dd);
  return equity;
}

function executeBuy({ account, candle, signal, config, trades }) {
  const price = Number(candle.open);
  const plan = computeTradePlan({
    equity: account.equity,
    cash: account.cash,
    price,
    atrPct: Number(signal?.analysis?.main?.indicators?.atrPct || 0),
    riskPerTrade: config.riskPerTrade,
    maxPositionPct: config.maxPositionPct,
    stopLossPct: config.stopLossPct,
    takeProfitPct: config.takeProfitPct,
  });
  if (!Number.isFinite(plan.notional) || plan.notional <= 0 || !Number.isFinite(plan.qty) || plan.qty <= 0) return null;

  const fee = plan.notional * FEE_RATE;
  if (plan.notional + fee > account.cash) return null;
  account.cash -= plan.notional + fee;

  const position = {
    symbol: signal.symbol,
    qty: plan.qty,
    entryPrice: price,
    notional: plan.notional,
    cost: plan.notional + fee,
    stopPrice: price * (1 - config.stopLossPct),
    takeProfitPrice: price * (1 + config.takeProfitPct),
    trailingPct: config.stopLossPct,
    trailingStopPrice: price * (1 - config.stopLossPct),
    highWaterPrice: price,
    openedAt: candle.openTime,
  };

  trades.push({
    side: "BUY",
    symbol: signal.symbol,
    at: new Date(candle.openTime).toISOString(),
    price: round(price, 8),
    qty: round(plan.qty, 10),
    notional: round(plan.notional, 2),
    pnl: null,
    fee: round(fee, 4),
    reason: "PRE_AI_DETERMINISTIC_ENTRY",
    mode: "backtest",
  });
  return position;
}

function executeSell({ account, position, price, atMs, reason, trades, config }) {
  const proceeds = position.qty * Number(price);
  const fee = proceeds * FEE_RATE;
  account.cash += proceeds - fee;
  const pnl = (proceeds - fee) - position.cost;
  account.realizedPnl += pnl;

  if (pnl >= 0) account.consecutiveLosses = 0;
  else account.consecutiveLosses += 1;

  trades.push({
    side: "SELL",
    symbol: position.symbol,
    at: new Date(atMs).toISOString(),
    price: round(price, 8),
    qty: round(position.qty, 10),
    notional: round(proceeds, 2),
    pnl: round(pnl, 2),
    fee: round(fee, 4),
    holdingMinutes: Math.max(0, round((atMs - position.openedAt) / MINUTE_MS, 1)),
    entryPrice: round(position.entryPrice, 8),
    reason,
    mode: "backtest",
  });

  const lossBreaker = account.consecutiveLosses >= config.maxConsecutiveLosses;
  const cooldownMinutes = lossBreaker ? config.lossStreakCooldownMinutes : 15;
  return {
    position: null,
    cooldownUntil: atMs + cooldownMinutes * MINUTE_MS,
    pnl,
  };
}

export function runStrategyReplay({
  symbol = "BTCUSDT",
  mainCandles = [],
  fastCandles = [],
  startMs = 0,
  config: configInput = {},
} = {}) {
  const config = normalizeBacktestConfig(configInput);
  const main = [...mainCandles].sort((a, b) => a.openTime - b.openTime);
  const fast = [...fastCandles].sort((a, b) => a.openTime - b.openTime);
  if (main.length < 80 || fast.length < 80) throw new Error("Insufficient candles for strategy replay");

  const account = {
    cash: config.startingBalance,
    equity: config.startingBalance,
    realizedPnl: 0,
    peakEquity: config.startingBalance,
    maxDrawdownPct: 0,
    consecutiveLosses: 0,
    dailyStartEquity: config.startingBalance,
    dailyDate: witaDay(main[0].openTime),
  };
  const trades = [];
  const counters = {
    decisions: 0,
    rawBuySignals: 0,
    eligibleBuySignals: 0,
    liquidityBlocked: 0,
    regimeBlocked: 0,
    abnormalBlocked: 0,
    cooldownBlocked: 0,
    dailyLossBlocked: 0,
  };

  let position = null;
  let pendingBuy = null;
  let pendingSell = null;
  let cooldownUntil = 0;
  let fastEnd = 0;
  let lastEvaluatedAt = null;

  for (let i = 0; i < main.length; i++) {
    const candle = main[i];
    while (fastEnd < fast.length && fast[fastEnd].closeTime <= candle.closeTime) fastEnd += 1;

    const day = witaDay(candle.openTime);
    if (day !== account.dailyDate) {
      account.dailyDate = day;
      account.dailyStartEquity = account.equity;
    }

    if (pendingSell && position) {
      const sold = executeSell({
        account,
        position,
        price: candle.open,
        atMs: candle.openTime,
        reason: pendingSell.reason,
        trades,
        config,
      });
      position = sold.position;
      cooldownUntil = sold.cooldownUntil;
      pendingSell = null;
    }

    if (pendingBuy && !position) {
      position = executeBuy({ account, candle, signal: pendingBuy, config, trades });
      pendingBuy = null;
    }

    if (position) {
      const riskExit = resolveHistoricalRiskExit(position, candle);
      if (riskExit) {
        const sold = executeSell({
          account,
          position,
          price: riskExit.price,
          atMs: candle.closeTime,
          reason: riskExit.reason,
          trades,
          config,
        });
        position = sold.position;
        cooldownUntil = sold.cooldownUntil;
      } else {
        position.highWaterPrice = Math.max(position.highWaterPrice, Number(candle.high));
        position.trailingStopPrice = Math.max(
          position.trailingStopPrice,
          position.highWaterPrice * (1 - position.trailingPct),
        );
      }
    }

    markEquity(account, position, candle.close);
    if (candle.closeTime < Number(startMs || 0)) continue;
    if (i < 69 || fastEnd < 70) continue;

    const mainWindow = main.slice(Math.max(0, i - 139), i + 1);
    const fastWindow = fast.slice(Math.max(0, fastEnd - 140), fastEnd);
    if (mainWindow.length < 70 || fastWindow.length < 70) continue;

    const analysis = analyzeMultiTimeframe(mainWindow, fastWindow, config.minSignalConfidence);
    const regime = detectMarketRegime(mainWindow);
    let tradeQuality = computeTradeQuality(analysis, regime);
    let entryEligible = isRegimeEntryEligible(analysis, regime, config.minSignalConfidence);
    const liquidity = assessMultiTimeframeLiquidity(mainWindow, fastWindow);
    if (!liquidity.healthy) {
      entryEligible = false;
      tradeQuality = Math.min(tradeQuality, 35);
    }

    counters.decisions += 1;
    lastEvaluatedAt = candle.closeTime;

    if (position) {
      if (analysis.action === "SELL") pendingSell = { reason: "MULTI_TIMEFRAME_EXIT" };
      continue;
    }

    if (analysis.action !== "BUY") continue;
    counters.rawBuySignals += 1;

    const abnormal = Number(analysis.main?.indicators?.atrPct || 0) > 5 ||
      Number(analysis.main?.indicators?.volumeRatio || 0) > 6;
    if (abnormal) {
      counters.abnormalBlocked += 1;
      continue;
    }
    if (!liquidity.healthy) {
      counters.liquidityBlocked += 1;
      continue;
    }
    if (!entryEligible) {
      counters.regimeBlocked += 1;
      continue;
    }
    if (candle.closeTime < cooldownUntil) {
      counters.cooldownBlocked += 1;
      continue;
    }
    const dailyLossPct = account.dailyStartEquity > 0
      ? Math.max(0, (account.dailyStartEquity - account.equity) / account.dailyStartEquity)
      : 0;
    if (dailyLossPct >= config.maxDailyLossPct) {
      counters.dailyLossBlocked += 1;
      continue;
    }

    counters.eligibleBuySignals += 1;
    pendingBuy = {
      symbol,
      analysis,
      regime,
      tradeQuality,
      liquidity,
      signalAt: candle.closeTime,
    };
  }

  if (position) {
    const finalCandle = main.at(-1);
    executeSell({
      account,
      position,
      price: finalCandle.close,
      atMs: finalCandle.closeTime,
      reason: "END_OF_WINDOW",
      trades,
      config,
    });
    position = null;
    markEquity(account, null, finalCandle.close);
  }

  const performance = computePerformanceStats(trades);
  const returnPct = config.startingBalance > 0
    ? ((account.equity - config.startingBalance) / config.startingBalance) * 100
    : 0;

  return {
    version: "1.10.0",
    mode: "HISTORICAL_DETERMINISTIC_PRE_AI",
    symbol,
    source: "INDODAX_PUBLIC_OHLC",
    aiValidation: "NOT_REPLAYED",
    interpretation: "Deterministic strategy-core replay before the runtime AI veto. Forward-test PAPER remains the source of truth for AI-gated performance.",
    config,
    sample: {
      mainCandles: main.length,
      fastCandles: fast.length,
      decisions: counters.decisions,
      evaluatedFrom: Number(startMs || 0) ? new Date(Number(startMs)).toISOString() : null,
      evaluatedTo: lastEvaluatedAt ? new Date(lastEvaluatedAt).toISOString() : null,
    },
    counters,
    metrics: {
      startingBalance: round(config.startingBalance, 2),
      endingEquity: round(account.equity, 2),
      netPnl: round(account.equity - config.startingBalance, 2),
      returnPct: round(returnPct, 2),
      closedTrades: performance.closedTrades,
      winRatePct: performance.winRatePct,
      profitFactor: performance.profitFactor,
      expectancyUsd: performance.expectancyUsd,
      avgWinUsd: performance.avgWinUsd,
      avgLossUsd: performance.avgLossUsd,
      avgHoldMinutes: performance.avgHoldMinutes,
      maxDrawdownPct: round(account.maxDrawdownPct, 2),
      estimatedFeesUsd: performance.estimatedFeesUsd,
      sampleStatus: performance.closedTrades >= 30
        ? "BUILDING_CONFIDENCE"
        : performance.closedTrades >= 10
          ? "EXPLORATORY_SAMPLE"
          : "INSUFFICIENT_TRADES",
    },
    trades: trades.slice(-40),
  };
}
