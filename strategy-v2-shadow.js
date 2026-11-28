export const STRATEGY_V2_POLICY = "V2_BULLISH_COST_AWARE_V1";

const round = (n, d = 6) => Number(Number(n || 0).toFixed(d));
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const iso = (ms = Date.now()) => new Date(ms).toISOString();

export function strategyV2Config(env = {}) {
  return {
    startingBalance: Math.max(100, Number(env.V2_STARTING_BALANCE || 10000)),
    minBuyConfidence: clamp(Number(env.V2_MIN_BUY_CONFIDENCE || 80), 70, 95),
    minTradeQuality: clamp(Number(env.V2_MIN_TRADE_QUALITY || 80), 65, 95),
    feeRate: clamp(Number(env.PAPER_FEE_RATE || 0.001), 0, 0.01),
    riskPerTrade: clamp(Number(env.V2_RISK_PER_TRADE || 0.005), 0.0025, 0.02),
    maxPositionPct: clamp(Number(env.V2_MAX_POSITION_PCT || 0.10), 0.05, 0.25),
    minStopPct: clamp(Number(env.V2_MIN_STOP_PCT || 0.015), 0.005, 0.10),
    maxStopPct: clamp(Number(env.V2_MAX_STOP_PCT || 0.04), 0.01, 0.15),
    atrStopMultiple: clamp(Number(env.V2_ATR_STOP_MULTIPLE || 2.0), 1, 6),
    rewardRisk: clamp(Number(env.V2_REWARD_RISK || 2.5), 1.5, 6),
    trailingActivationR: clamp(Number(env.V2_TRAILING_ACTIVATION_R || 1.25), 0.5, 4),
    minExitConfidence: clamp(Number(env.V2_MIN_EXIT_CONFIDENCE || 80), 60, 95),
    evidenceTarget: Math.max(20, Math.round(Number(env.V2_EVIDENCE_TARGET || 100))),
  };
}

export function createStrategyV2State(config, nowMs = Date.now()) {
  const starting = Number(config.startingBalance || 10000);
  return {
    policy: STRATEGY_V2_POLICY,
    mode: "SHADOW_PAPER",
    liveCapable: false,
    startedAt: iso(nowMs),
    updatedAt: iso(nowMs),
    account: {
      startingBalance: starting,
      cash: starting,
      equity: starting,
      peakEquity: starting,
      realizedPnl: 0,
      unrealizedPnl: 0,
      maxDrawdownPct: 0,
      wins: 0,
      losses: 0,
    },
    position: null,
    trades: [],
    decisions: [],
    lastDecisionCandles: {},
    performance: {
      closedTrades: 0,
      evidenceClosedTrades: 0,
      evidenceTargetClosedTrades: config.evidenceTarget,
      wins: 0,
      losses: 0,
      winRatePct: 0,
      profitFactor: 0,
      expectancyUsd: 0,
      netPnl: 0,
      maxLossStreak: 0,
      consecutiveLosses: 0,
      sampleStatus: "V2_COLLECTING_DATA",
    },
    lastDecision: null,
  };
}

export function ensureStrategyV2State(existing, config, nowMs = Date.now()) {
  const state = existing && existing.policy === STRATEGY_V2_POLICY
    ? existing
    : createStrategyV2State(config, nowMs);
  state.liveCapable = false;
  state.mode = "SHADOW_PAPER";
  state.policy = STRATEGY_V2_POLICY;
  state.account ||= createStrategyV2State(config, nowMs).account;
  state.trades ||= [];
  state.decisions ||= [];
  state.lastDecisionCandles ||= {};
  state.performance ||= {};
  return state;
}

export function rankStrategyV2Candidates(candidates = [], config = {}) {
  return (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c && c.symbol && c.analysis && c.regime)
    .map((c) => {
      const regime = typeof c.regime === "string" ? c.regime : c.regime.regime;
      const buyConfidence = Number(c.analysis?.buyConfidence || 0);
      const tradeQuality = Number(c.tradeQuality || 0);
      const bullish = regime === "BULLISH";
      const signalBuy = c.analysis?.action === "BUY";
      const normalEligible = c.entryEligible === true;
      const thresholdPass =
        buyConfidence >= Number(config.minBuyConfidence || 80) &&
        tradeQuality >= Number(config.minTradeQuality || 80);
      const costPass = c.costGuard?.allowed === true;
      return {
        ...c,
        v2Eligible: bullish && signalBuy && normalEligible && thresholdPass && costPass,
        v2Regime: regime || "UNKNOWN",
        v2BuyConfidence: buyConfidence,
        v2TradeQuality: tradeQuality,
      };
    })
    .sort((a, b) => {
      const eligible = Number(b.v2Eligible) - Number(a.v2Eligible);
      if (eligible) return eligible;
      const q = b.v2TradeQuality - a.v2TradeQuality;
      if (q) return q;
      return b.v2BuyConfidence - a.v2BuyConfidence;
    });
}

function pushLimited(arr, item, max = 200) {
  arr.unshift(item);
  if (arr.length > max) arr.length = max;
}

export function computeStrategyV2Performance(trades = [], evidenceTarget = 100) {
  const closed = (Array.isArray(trades) ? trades : [])
    .filter((t) => t?.side === "SELL" && Number.isFinite(Number(t.pnl)))
    .slice()
    .sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
  const wins = closed.filter((t) => Number(t.pnl) >= 0);
  const losses = closed.filter((t) => Number(t.pnl) < 0);
  const grossProfit = wins.reduce((sum, t) => sum + Number(t.pnl), 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + Number(t.pnl), 0));
  const netPnl = closed.reduce((sum, t) => sum + Number(t.pnl), 0);
  const evidenceClosedTrades = closed.filter((t) => t.evidenceEligible === true).length;

  let consecutiveLosses = 0;
  let maxLossStreak = 0;
  for (const t of closed) {
    if (Number(t.pnl) < 0) {
      consecutiveLosses += 1;
      maxLossStreak = Math.max(maxLossStreak, consecutiveLosses);
    } else {
      consecutiveLosses = 0;
    }
  }

  const pf = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0);
  const expectancy = closed.length ? netPnl / closed.length : 0;
  const edgeProven = evidenceClosedTrades >= evidenceTarget && expectancy > 0 && (pf == null || pf > 1);

  return {
    closedTrades: closed.length,
    evidenceClosedTrades,
    evidenceTargetClosedTrades: evidenceTarget,
    wins: wins.length,
    losses: losses.length,
    winRatePct: closed.length ? round((wins.length / closed.length) * 100, 2) : 0,
    grossProfit: round(grossProfit, 2),
    grossLoss: round(grossLoss, 2),
    netPnl: round(netPnl, 2),
    profitFactor: pf == null ? null : round(pf, 3),
    expectancyUsd: round(expectancy, 3),
    maxLossStreak,
    consecutiveLosses,
    sampleStatus: edgeProven
      ? "V2_EDGE_PROVEN"
      : evidenceClosedTrades >= evidenceTarget
        ? "V2_EDGE_NOT_PROVEN"
        : "V2_COLLECTING_DATA",
  };
}

function updateAccountMark(state, markPrice) {
  const account = state.account;
  const position = state.position;
  const positionValue = position ? Number(position.qty || 0) * Number(markPrice || position.entryPrice || 0) : 0;
  account.equity = round(Number(account.cash || 0) + positionValue, 2);
  account.unrealizedPnl = position
    ? round((Number(markPrice || 0) - Number(position.entryPrice || 0)) * Number(position.qty || 0) - Number(position.entryFee || 0), 2)
    : 0;
  account.peakEquity = Math.max(Number(account.peakEquity || account.startingBalance || 0), account.equity);
  account.maxDrawdownPct = account.peakEquity > 0
    ? round(((account.peakEquity - account.equity) / account.peakEquity) * 100, 3)
    : 0;
}

export function strategyV2OpenPosition(state, candidate, config, nowMs = Date.now()) {
  const quote = candidate?.marketQuote || {};
  const ask = Number(quote.ask || candidate.marketPrice || 0);
  if (!(ask > 0)) return { opened: false, reason: "V2_INVALID_ENTRY_QUOTE" };

  const atrPct = Math.max(0, Number(candidate.analysis?.main?.indicators?.atrPct || 0)) / 100;
  const stopPct = clamp(
    atrPct * Number(config.atrStopMultiple || 2),
    Number(config.minStopPct || 0.015),
    Number(config.maxStopPct || 0.04),
  );
  const takeProfitPct = clamp(stopPct * Number(config.rewardRisk || 2.5), stopPct * 1.5, 0.15);
  const riskCapital = Number(state.account.equity || 0) * Number(config.riskPerTrade || 0.005);
  const byRisk = stopPct > 0 ? riskCapital / stopPct : 0;
  const byCap = Number(state.account.equity || 0) * Number(config.maxPositionPct || 0.10);
  const maxCashNotional = Number(state.account.cash || 0) / (1 + Number(config.feeRate || 0));
  const notional = Math.max(0, Math.min(byRisk, byCap, maxCashNotional));
  if (notional < 10) return { opened: false, reason: "V2_NOTIONAL_TOO_SMALL" };

  const qty = notional / ask;
  const entryFee = notional * Number(config.feeRate || 0);
  const orderId = `v2-${nowMs}-${candidate.symbol}`;
  state.account.cash = round(Number(state.account.cash || 0) - notional - entryFee, 6);
  state.position = {
    orderId,
    symbol: candidate.symbol,
    openedAt: iso(nowMs),
    entryPrice: round(ask, 8),
    qty: round(qty, 10),
    notional: round(notional, 2),
    entryFee: round(entryFee, 6),
    stopPct: round(stopPct, 6),
    takeProfitPct: round(takeProfitPct, 6),
    stopPrice: round(ask * (1 - stopPct), 8),
    takeProfitPrice: round(ask * (1 + takeProfitPct), 8),
    highWaterPrice: round(ask, 8),
    trailingStopPrice: null,
    recoveryProbe: false,
    entryCostGuard: candidate.costGuard || null,
    entryBuyConfidence: Number(candidate.analysis?.buyConfidence || 0),
    entryTradeQuality: Number(candidate.tradeQuality || 0),
    entryRegime: candidate.v2Regime || candidate.regime?.regime || "UNKNOWN",
  };

  pushLimited(state.trades, {
    id: orderId,
    at: iso(nowMs),
    side: "BUY",
    mode: "V2_SHADOW",
    symbol: candidate.symbol,
    price: round(ask, 8),
    qty: round(qty, 10),
    notional: round(notional, 2),
    fee: round(entryFee, 6),
    pnl: null,
    reason: "V2_BULLISH_COST_AWARE_ENTRY",
    evidenceEligible: candidate.costGuard?.allowed === true,
  }, 300);

  updateAccountMark(state, Number(quote.bid || candidate.marketPrice || ask));
  return { opened: true, reason: "V2_BULLISH_COST_AWARE_ENTRY" };
}

export function strategyV2ClosePosition(state, candidate, config, reason, nowMs = Date.now()) {
  const position = state.position;
  if (!position) return { closed: false, reason: "V2_NO_POSITION" };
  const quote = candidate?.marketQuote || {};
  const bid = Number(quote.bid || candidate?.marketPrice || 0);
  if (!(bid > 0)) return { closed: false, reason: "V2_INVALID_EXIT_QUOTE" };

  const exitNotional = Number(position.qty || 0) * bid;
  const exitFee = exitNotional * Number(config.feeRate || 0);
  const entryCost = Number(position.notional || 0) + Number(position.entryFee || 0);
  const exitProceeds = exitNotional - exitFee;
  const pnl = exitProceeds - entryCost;
  const holdingMinutes = Math.max(0, (nowMs - Date.parse(position.openedAt || nowMs)) / 60000);

  state.account.cash = round(Number(state.account.cash || 0) + exitProceeds, 6);
  state.account.realizedPnl = round(Number(state.account.realizedPnl || 0) + pnl, 2);
  if (pnl >= 0) state.account.wins = Number(state.account.wins || 0) + 1;
  else state.account.losses = Number(state.account.losses || 0) + 1;

  pushLimited(state.trades, {
    id: `v2-close-${nowMs}-${position.symbol}`,
    at: iso(nowMs),
    side: "SELL",
    mode: "V2_SHADOW",
    symbol: position.symbol,
    price: round(bid, 8),
    qty: position.qty,
    notional: round(exitNotional, 2),
    fee: round(exitFee, 6),
    pnl: round(pnl, 2),
    holdingMinutes: round(holdingMinutes, 1),
    reason,
    evidenceEligible: position.entryCostGuard?.allowed === true,
    entryBuyConfidence: position.entryBuyConfidence,
    entryTradeQuality: position.entryTradeQuality,
    entryRegime: position.entryRegime,
  }, 300);

  state.position = null;
  updateAccountMark(state, 0);
  return { closed: true, reason, pnl: round(pnl, 2) };
}

export function updateStrategyV2Shadow(state, candidates = [], config, nowMs = Date.now()) {
  const ranked = rankStrategyV2Candidates(candidates, config);
  const candidateBySymbol = new Map(ranked.map((x) => [x.symbol, x]));
  let action = "HOLD";
  let reason = "V2_NO_QUALIFIED_SETUP";
  let symbol = ranked[0]?.symbol || state.position?.symbol || null;

  if (state.position) {
    const current = candidateBySymbol.get(state.position.symbol);
    if (current) {
      const bid = Number(current.marketQuote?.bid || current.marketPrice || 0);
      if (bid > 0) {
        state.position.highWaterPrice = Math.max(Number(state.position.highWaterPrice || state.position.entryPrice), bid);
        const activation = Number(state.position.entryPrice) * (1 + Number(state.position.stopPct) * Number(config.trailingActivationR || 1.25));
        if (state.position.highWaterPrice >= activation) {
          const candidateTrail = bid * (1 - Number(state.position.stopPct));
          state.position.trailingStopPrice = round(Math.max(Number(state.position.trailingStopPrice || 0), candidateTrail), 8);
        }
        updateAccountMark(state, bid);

        const regime = current.regime?.regime || current.regime || "UNKNOWN";
        const exitConfidence = Number(current.analysis?.exitConfidence || 0);
        if (bid <= Number(state.position.stopPrice)) {
          action = "SELL"; reason = "V2_STOP_LOSS";
        } else if (state.position.trailingStopPrice && bid <= Number(state.position.trailingStopPrice) && bid > Number(state.position.entryPrice)) {
          action = "SELL"; reason = "V2_TRAILING_STOP";
        } else if (bid >= Number(state.position.takeProfitPrice)) {
          action = "SELL"; reason = "V2_TAKE_PROFIT";
        } else if (regime === "BEARISH") {
          action = "SELL"; reason = "V2_BEARISH_REGIME_EXIT";
        } else if (current.analysis?.action === "SELL" && exitConfidence >= Number(config.minExitConfidence || 80)) {
          action = "SELL"; reason = "V2_HIGH_CONFIDENCE_EXIT";
        } else {
          reason = "V2_POSITION_MONITORING";
        }

        if (action === "SELL") {
          strategyV2ClosePosition(state, current, config, reason, nowMs);
        }
      }
    } else {
      reason = "V2_POSITION_MARKET_NOT_SCANNED";
    }
  } else {
    const best = ranked[0] || null;
    symbol = best?.symbol || null;
    if (best) {
      const candle = best.decisionCandle;
      const previous = state.lastDecisionCandles?.[best.symbol];
      if (previous === candle) {
        reason = "V2_WAIT_NEXT_CLOSED_CANDLE";
      } else {
        state.lastDecisionCandles ||= {};
        state.lastDecisionCandles[best.symbol] = candle;
        if (best.v2Eligible) {
          const opened = strategyV2OpenPosition(state, best, config, nowMs);
          action = opened.opened ? "BUY" : "HOLD";
          reason = opened.reason;
        } else if (best.v2Regime !== "BULLISH") {
          reason = "V2_BULLISH_ONLY";
        } else if (best.v2BuyConfidence < Number(config.minBuyConfidence || 80)) {
          reason = "V2_CONFIDENCE_TOO_LOW";
        } else if (best.v2TradeQuality < Number(config.minTradeQuality || 80)) {
          reason = "V2_QUALITY_TOO_LOW";
        } else if (!best.costGuard?.allowed) {
          reason = best.costGuard?.reason || "V2_COST_GUARD_BLOCK";
        } else {
          reason = "V2_BASE_ENTRY_NOT_ELIGIBLE";
        }
      }
    }
  }

  state.performance = computeStrategyV2Performance(state.trades, config.evidenceTarget);
  state.updatedAt = iso(nowMs);
  state.lastDecision = {
    at: iso(nowMs),
    action,
    reason,
    symbol,
    positionSymbol: state.position?.symbol || null,
    closedTrades: state.performance.closedTrades,
    evidenceClosedTrades: state.performance.evidenceClosedTrades,
  };
  pushLimited(state.decisions, state.lastDecision, 160);
  return state;
}
