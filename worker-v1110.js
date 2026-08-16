import baseWorker, { TradingState as BaseTradingState } from "./worker-v1105.js";
import { computeTradePlan } from "./engine.js";
import { fetchIndodaxPairs, findIndodaxPair } from "./indodax.js";
import { buildEvidenceStats, EVIDENCE_COST_MODEL } from "./evidence-v1110.js";

const APP_VERSION = "1.11.0";
const TRADE_LOG_MAX = 500;
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const round = (n, d = 8) => Number(Number(n || 0).toFixed(d));
const nowIso = () => new Date().toISOString();
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function pushTrade(state, trade) {
  state.trades ||= [];
  state.trades.unshift(trade);
  if (state.trades.length > TRADE_LOG_MAX) state.trades.length = TRADE_LOG_MAX;
}

function evidenceConfig(env) {
  return {
    minClosed: Math.max(1, Math.round(Number(env.PAPER_EVIDENCE_MIN_CLOSED || 100))),
    targetClosed: Math.max(100, Math.round(Number(env.PAPER_EVIDENCE_TARGET_CLOSED || 200))),
    feeRatePerSide: clamp(Number(env.PAPER_FEE_RATE || 0.001), 0, 0.01),
  };
}

function fallbackQuote(price, error = null) {
  const p = Number(price || 0);
  return {
    last: p,
    bid: p,
    ask: p,
    mid: p,
    spreadPct: 0,
    spreadModeled: false,
    source: "LAST_PRICE_FALLBACK",
    error: error ? String(error).slice(0, 140) : null,
  };
}

async function fetchIndodaxQuote(baseUrl, symbol) {
  const url = new URL(baseUrl);
  if (!url.hostname.toLowerCase().endsWith("indodax.com")) return null;
  const pairs = await fetchIndodaxPairs(baseUrl);
  const pair = findIndodaxPair(pairs, symbol);
  if (!pair) throw new Error(`Indodax pair unavailable: ${symbol}`);
  const res = await fetch(new URL(`/api/ticker/${pair.id}`, baseUrl), {
    headers: { Accept: "application/json", "User-Agent": "KAI-TRAD/1.11.0" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Indodax ticker HTTP ${res.status}`);
  const last = Number(data?.ticker?.last || 0);
  const bid = Number(data?.ticker?.buy || 0);
  const ask = Number(data?.ticker?.sell || 0);
  if (!(last > 0)) throw new Error("Indodax ticker last unavailable");
  const validSpread = bid > 0 && ask > 0 && ask >= bid;
  const mid = validSpread ? (bid + ask) / 2 : last;
  return {
    last,
    bid: validSpread ? bid : last,
    ask: validSpread ? ask : last,
    mid,
    spreadPct: validSpread && mid > 0 ? ((ask - bid) / mid) * 100 : 0,
    spreadModeled: validSpread,
    source: validSpread ? "INDODAX_LIVE_BID_ASK" : "INDODAX_LAST_ONLY",
    pairId: pair.id,
  };
}

export class TradingState extends BaseTradingState {
  async state() {
    const s = await super.state();
    s.version = APP_VERSION;
    const cfg = evidenceConfig(this.env);
    s.costModel = {
      version: EVIDENCE_COST_MODEL,
      paperFeeRatePerSide: cfg.feeRatePerSide,
      spreadModel: "INDODAX_LIVE_BID_ASK",
      tradeLogMax: TRADE_LOG_MAX,
    };
    s.evidencePolicy = {
      program: "KAI_SANBAN_100_200",
      minClosedTrades: cfg.minClosed,
      targetClosedTrades: cfg.targetClosed,
      liveGate: "LOCKED",
      ownerApprovalRequired: true,
    };
    return s;
  }

  liveExecutionAllowed() {
    return super.liveExecutionAllowed() && this.env.KAI_SANBAN_LIVE_GATE === "OWNER_APPROVED_AFTER_EVIDENCE";
  }

  async scanSymbol(baseUrl, s, symbol) {
    const result = await super.scanSymbol(baseUrl, s, symbol);
    let quote = fallbackQuote(result.marketPrice);
    try {
      quote = (await fetchIndodaxQuote(baseUrl, symbol)) || quote;
    } catch (e) {
      quote = fallbackQuote(result.marketPrice, e?.message || e);
    }
    this._evidenceQuotes ||= new Map();
    this._evidenceQuotes.set(symbol, quote);
    result.marketQuote = quote;
    if (quote.last > 0) result.marketPrice = quote.last;
    return result;
  }

  quoteFor(symbol, marketPrice) {
    return this._evidenceQuotes?.get(symbol) || fallbackQuote(marketPrice);
  }

  async executeBuy(s, analysis, marketPrice, symbol = s.signal?.symbol || s.config.symbol) {
    if (s.mode === "live") return super.executeBuy(s, analysis, marketPrice, symbol);

    const quote = this.quoteFor(symbol, marketPrice);
    const fillPrice = quote.spreadModeled ? quote.ask : Number(marketPrice);
    const referencePrice = quote.spreadModeled ? quote.mid : Number(marketPrice);
    const plan = computeTradePlan({
      equity: s.account.equity,
      cash: s.account.cash,
      price: fillPrice,
      atrPct: analysis.main.indicators.atrPct,
      riskPerTrade: s.config.riskPerTrade,
      maxPositionPct: s.config.maxPositionPct,
      stopLossPct: s.config.stopLossPct,
      takeProfitPct: s.config.takeProfitPct,
    });
    if (plan.notional < 10) throw new Error("Trade notional below minimum safety threshold");

    const { feeRatePerSide } = evidenceConfig(this.env);
    const notional = plan.notional;
    const qty = notional / fillPrice;
    const fee = notional * feeRatePerSide;
    const entrySpreadCost = quote.spreadModeled ? Math.max(0, (fillPrice - referencePrice) * qty) : 0;
    const evidenceEligible = quote.spreadModeled;
    const costModelVersion = evidenceEligible ? EVIDENCE_COST_MODEL : "V2_FEE_ONLY_FALLBACK";
    const orderId = `paper-${Date.now()}`;

    s.account.cash -= notional + fee;
    s.position = {
      symbol,
      qty: round(qty, 10),
      entryPrice: round(fillPrice, 8),
      notional: round(notional, 2),
      cost: round(notional + fee, 2),
      stopPct: plan.stopPct,
      takeProfitPct: plan.takeProfitPct,
      trailingPct: plan.trailingPct,
      stopPrice: round(fillPrice * (1 - plan.stopPct), 8),
      takeProfitPrice: round(fillPrice * (1 + plan.takeProfitPct), 8),
      trailingStopPrice: round(fillPrice * (1 - plan.trailingPct), 8),
      highWaterPrice: round(fillPrice, 8),
      openedAt: nowIso(),
      orderId,
      entryFee: round(fee, 6),
      entryReferencePrice: round(referencePrice, 8),
      entrySpreadCost: round(entrySpreadCost, 6),
      costModelVersion,
      evidenceEligible,
      quoteSource: quote.source,
    };

    pushTrade(s, {
      id: crypto.randomUUID(),
      at: nowIso(),
      side: "BUY",
      symbol,
      price: round(fillPrice, 8),
      referencePrice: round(referencePrice, 8),
      qty: round(qty, 10),
      notional: round(notional, 2),
      pnl: null,
      fee: round(fee, 4),
      spreadCost: round(entrySpreadCost, 4),
      spreadPct: round(quote.spreadPct, 4),
      mode: s.mode,
      reason: "BEST_OF_5_REGIME_AI_CONFIRMED",
      orderId,
      costModelVersion,
      evidenceEligible,
    });
    return s;
  }

  async executeSell(s, marketPrice, reason) {
    if (s.mode === "live") return super.executeSell(s, marketPrice, reason);

    const p = s.position;
    const quote = this.quoteFor(p.symbol, marketPrice);
    const fillPrice = quote.spreadModeled ? quote.bid : Number(marketPrice);
    const referencePrice = quote.spreadModeled ? quote.mid : Number(marketPrice);
    const qty = Number(p.qty);
    const proceeds = qty * fillPrice;
    const { feeRatePerSide } = evidenceConfig(this.env);
    const fee = proceeds * feeRatePerSide;
    const exitSpreadCost = quote.spreadModeled ? Math.max(0, (referencePrice - fillPrice) * qty) : 0;
    const entryFee = Number(p.entryFee || 0);
    const entrySpreadCost = Number(p.entrySpreadCost || 0);
    const pnl = (proceeds - fee) - Number(p.cost || 0);
    const evidenceEligible = p.evidenceEligible === true && quote.spreadModeled === true && p.costModelVersion === EVIDENCE_COST_MODEL;
    const costModelVersion = evidenceEligible ? EVIDENCE_COST_MODEL : String(p.costModelVersion || "LEGACY_OR_FALLBACK");
    const tradingCostUsd = entryFee + fee + entrySpreadCost + exitSpreadCost;
    const grossPnlBeforeCosts = pnl + tradingCostUsd;
    const entryNotional = Number(p.notional || 0);
    const netPnlPct = entryNotional > 0 ? pnl / entryNotional * 100 : 0;
    const grossPnlPct = entryNotional > 0 ? grossPnlBeforeCosts / entryNotional * 100 : 0;
    const tradingCostPct = entryNotional > 0 ? tradingCostUsd / entryNotional * 100 : 0;
    const orderId = `paper-${Date.now()}`;

    s.account.cash += proceeds - fee;
    s.account.realizedPnl += pnl;
    if (pnl >= 0) {
      s.account.wins += 1;
      s.account.consecutiveLosses = 0;
      if (s.engine.breaker?.reason === "LOSS_STREAK") s.engine.breaker = { active: false, reason: null, until: null };
    } else {
      s.account.losses += 1;
      s.account.consecutiveLosses = (s.account.consecutiveLosses || 0) + 1;
      s.account.maxConsecutiveLossesSeen = Math.max(s.account.maxConsecutiveLossesSeen || 0, s.account.consecutiveLosses);
    }

    pushTrade(s, {
      id: crypto.randomUUID(),
      at: nowIso(),
      side: "SELL",
      symbol: p.symbol,
      price: round(fillPrice, 8),
      referencePrice: round(referencePrice, 8),
      qty: round(qty, 10),
      notional: round(proceeds, 2),
      entryNotional: round(entryNotional, 2),
      pnl: round(pnl, 2),
      fee: round(fee, 4),
      entryFee: round(entryFee, 4),
      spreadCost: round(exitSpreadCost, 4),
      entrySpreadCost: round(entrySpreadCost, 4),
      tradingCostUsd: round(tradingCostUsd, 4),
      tradingCostPct: round(tradingCostPct, 5),
      grossPnlBeforeCosts: round(grossPnlBeforeCosts, 4),
      grossPnlPct: round(grossPnlPct, 5),
      netPnlPct: round(netPnlPct, 5),
      spreadPct: round(quote.spreadPct, 4),
      holdingMinutes: Math.max(0, round((Date.now() - Date.parse(p.openedAt || nowIso())) / 60000, 1)),
      entryPrice: p.entryPrice,
      entryReferencePrice: p.entryReferencePrice || p.entryPrice,
      mode: s.mode,
      reason,
      orderId,
      costModelVersion,
      evidenceEligible,
    });

    s.position = null;
    const baseCooldown = 15;
    const lossBreaker = (s.account.consecutiveLosses || 0) >= s.config.maxConsecutiveLosses;
    const cooldownMinutes = lossBreaker ? s.config.lossStreakCooldownMinutes : baseCooldown;
    s.engine.cooldownUntil = new Date(Date.now() + cooldownMinutes * 60_000).toISOString();
    if (lossBreaker) s.engine.breaker = { active: true, reason: "LOSS_STREAK", until: s.engine.cooldownUntil };
    return s;
  }

  async publicState() {
    const s = await super.publicState();
    const cfg = evidenceConfig(this.env);
    s.evidence = buildEvidenceStats({
      trades: s.trades || [],
      account: s.account || {},
      minClosed: cfg.minClosed,
      targetClosed: cfg.targetClosed,
      feeRatePerSide: cfg.feeRatePerSide,
    });
    s.performance = {
      ...(s.performance || {}),
      sampleStatus: s.evidence.status,
      evidenceClosedTrades: s.evidence.closedTrades,
      evidenceTargetClosedTrades: s.evidence.targetClosedTrades,
      netExpectancyAfterCostsPct: s.evidence.netExpectancyPct,
      grossExpectancyBeforeCostsPct: s.evidence.grossExpectancyPct,
      avgTradingCostPct: s.evidence.avgTradingCostPct,
    };
    return s;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      const cfg = evidenceConfig(env);
      const gateApproved = env.KAI_SANBAN_LIVE_GATE === "OWNER_APPROVED_AFTER_EVIDENCE";
      return json({
        ok: true,
        service: "KAI TRAD",
        version: APP_VERSION,
        mode: env.TRADING_MODE === "live" ? "live" : "paper",
        broker: String(env.PRIMARY_BROKER || "indodax").toLowerCase(),
        marketDataProvider: "INDODAX_NATIVE",
        ticker403Mitigation: "INDODAX_NATIVE_TICKER",
        evidenceProgram: {
          mode: "KAI_SANBAN_100_200",
          minClosedTrades: cfg.minClosed,
          targetClosedTrades: cfg.targetClosed,
          feeRatePerSidePct: round(cfg.feeRatePerSide * 100, 4),
          spreadModel: "INDODAX_LIVE_BID_ASK",
          tradeLogMax: TRADE_LOG_MAX,
        },
        liveStage: env.BROKER_LIVE_STAGE || "LOCKED",
        kaiSanbanLiveGate: gateApproved ? "OWNER_APPROVED_AFTER_EVIDENCE" : "LOCKED",
        liveExecutionEnabled: gateApproved && env.ENABLE_LIVE_EXECUTION === "YES_I_ACCEPT_RISK",
        manifestBuildGuard: "REQUIRED",
        liquidityGuard: "OBSERVE_ONLY_PAPER_EVIDENCE",
        time: new Date().toISOString(),
      });
    }
    return baseWorker.fetch(request, env);
  },
};
