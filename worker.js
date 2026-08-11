import {
  analyzeMultiTimeframe,
  computeTradePlan,
  evaluateRiskExit,
  rankScanCandidates,
  safeConfig,
  updateTrailingStop,
} from "./engine.js";
import {
  fetchKlines,
  fetchTickerPrice,
  fetchSymbolRules,
  floorToStep,
  getFreeBalance,
  getSpotAccount,
  parseFill,
  placeMarketBuy,
  placeMarketSell,
} from "./binance.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const round = (n, d = 8) => Number(Number(n || 0).toFixed(d));
const nowIso = () => new Date().toISOString();
const witaDay = (ts = Date.now()) => new Date(ts + 8 * 3600_000).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function defaults(env) {
  const starting = Number(env.STARTING_BALANCE || 10000);
  return {
    version: "1.4.0",
    mode: env.TRADING_MODE === "live" ? "live" : "paper",
    createdAt: nowIso(),
    config: {
      symbol: env.SYMBOL || "BTCUSDT",
      scannerSymbols: String(env.SCAN_SYMBOLS || "BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT")
        .split(",").map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, 5),
      interval: env.INTERVAL || "15m",
      fastInterval: env.FAST_INTERVAL || "5m",
      riskPerTrade: Number(env.RISK_PER_TRADE || 0.01),
      stopLossPct: 0.10,
      takeProfitPct: 0.30,
      maxPositionPct: Number(env.MAX_POSITION_PCT || 0.2),
      maxDailyLossPct: Number(env.MAX_DAILY_LOSS_PCT || 0.03),
      minSignalConfidence: Number(env.MIN_SIGNAL_CONFIDENCE || 70),
      aiValidation: String(env.AI_VALIDATION || "true") === "true",
    },
    engine: {
      running: false,
      lastCycleAt: null,
      nextRunAt: null,
      lastAction: "IDLE",
      lastError: null,
      consecutiveErrors: 0,
      cycles: 0,
      cooldownUntil: null,
      lastDecisionCandle: null,
      lastDecisionCandles: {},
    },
    account: {
      startingBalance: starting,
      cash: starting,
      equity: starting,
      realizedPnl: 0,
      unrealizedPnl: 0,
      dailyDate: witaDay(),
      dailyStartEquity: starting,
      dailyPnl: 0,
      peakEquity: starting,
      maxDrawdownPct: 0,
      wins: 0,
      losses: 0,
    },
    position: null,
    signal: null,
    market: { symbol: env.SYMBOL || "BTCUSDT", price: null, updatedAt: null, chart: [] },
    scanner: { updatedAt: null, symbols: [], bestSymbol: env.SYMBOL || "BTCUSDT", errors: [] },
    trades: [],
    signals: [],
  };
}

function updateAccountMetrics(state, price) {
  const a = state.account;
  const today = witaDay();
  if (a.dailyDate !== today) {
    a.dailyDate = today;
    a.dailyStartEquity = a.equity;
    a.dailyPnl = 0;
  }

  if (state.position && Number.isFinite(price)) {
    const marketValue = state.position.qty * price;
    a.unrealizedPnl = marketValue - state.position.notional;
    a.equity = a.cash + marketValue;
  } else {
    a.unrealizedPnl = 0;
    a.equity = a.cash;
  }
  a.dailyPnl = a.equity - a.dailyStartEquity;
  a.peakEquity = Math.max(a.peakEquity, a.equity);
  const dd = a.peakEquity > 0 ? ((a.peakEquity - a.equity) / a.peakEquity) * 100 : 0;
  a.maxDrawdownPct = Math.max(a.maxDrawdownPct, dd);
  a.cash = round(a.cash, 2);
  a.equity = round(a.equity, 2);
  a.realizedPnl = round(a.realizedPnl, 2);
  a.unrealizedPnl = round(a.unrealizedPnl, 2);
  a.dailyPnl = round(a.dailyPnl, 2);
  a.maxDrawdownPct = round(a.maxDrawdownPct, 2);
}

function dailyLossBlocked(state) {
  const a = state.account;
  if (!a.dailyStartEquity) return false;
  const lossPct = Math.max(0, -a.dailyPnl / a.dailyStartEquity);
  return lossPct >= state.config.maxDailyLossPct;
}

function pushLimited(arr, item, max = 100) {
  arr.unshift(item);
  if (arr.length > max) arr.length = max;
}

async function aiValidateEntry(env, state, analysis, symbol = state.config.symbol) {
  if (!state.config.aiValidation) return { approved: true, confidence: 100, reason: "AI validation disabled" };
  if (!env.AI) return { approved: false, confidence: 0, reason: "AI binding unavailable" };

  const snapshot = {
    symbol,
    interval: state.config.interval,
    deterministicSignal: analysis.action,
    deterministicConfidence: analysis.confidence,
    price: analysis.price,
    main: analysis.main.indicators,
    fast: analysis.fast.indicators,
  };
  const prompt = [
    "You are a conservative trading risk validator, not an order generator.",
    "Review only the numeric snapshot. Approve a BUY only when trend, momentum and volatility are mutually consistent.",
    "When uncertain, reject. Never invent news or external facts.",
    'Return ONLY JSON: {"approve":boolean,"confidence":number,"risk":"short text"}',
    JSON.stringify(snapshot),
  ].join("\n");

  try {
    const out = await env.AI.run(env.AI_MODEL || "@cf/zai-org/glm-4.7-flash", {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 120,
      temperature: 0.1,
    });
    const text = typeof out === "string" ? out : (out?.response || out?.result?.response || JSON.stringify(out));
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) return { approved: false, confidence: 0, reason: "AI response not parseable" };
    const parsed = JSON.parse(match[0]);
    const confidence = Math.max(0, Math.min(100, Number(parsed.confidence || 0)));
    return {
      approved: parsed.approve === true && confidence >= 60,
      confidence,
      reason: String(parsed.risk || "AI validation completed").slice(0, 180),
    };
  } catch (e) {
    return { approved: false, confidence: 0, reason: `AI unavailable: ${e.message}` };
  }
}

export class TradingState {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    ctx.blockConcurrencyWhile(async () => {
      const existing = await ctx.storage.get("state");
      if (!existing) await ctx.storage.put("state", defaults(env));
    });
  }

  async state() {
    const s = await this.ctx.storage.get("state");
    s.mode = this.env.TRADING_MODE === "live" ? "live" : "paper";
    // Locked policy requested for every automatic trade, including persisted state after upgrades.
    s.config.stopLossPct = 0.10;
    s.config.takeProfitPct = 0.30;
    if (!Array.isArray(s.config.scannerSymbols) || !s.config.scannerSymbols.length) {
      s.config.scannerSymbols = String(this.env.SCAN_SYMBOLS || "BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT")
        .split(",").map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, 5);
    }
    s.engine.lastDecisionCandles ||= {};
    s.scanner ||= { updatedAt: null, symbols: [], bestSymbol: s.config.symbol, errors: [] };
    s.market ||= { symbol: s.config.symbol, price: null, updatedAt: null, chart: [] };
    s.market.symbol ||= s.position?.symbol || s.signal?.symbol || s.config.symbol;
    s.version = "1.4.0";
    return s;
  }

  async save(s) {
    await this.ctx.storage.put("state", s);
  }

  liveExecutionAllowed() {
    return this.env.TRADING_MODE === "live" &&
      this.env.ENABLE_LIVE_EXECUTION === "YES_I_ACCEPT_RISK" &&
      Boolean(this.env.BINANCE_API_KEY) && Boolean(this.env.BINANCE_API_SECRET) && Boolean(this.env.ADMIN_TOKEN);
  }

  async schedule(seconds = Number(this.env.ENGINE_INTERVAL_SECONDS || 60)) {
    const at = Date.now() + Math.max(30, seconds) * 1000;
    await this.ctx.storage.setAlarm(at);
    return new Date(at).toISOString();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.endsWith("/state")) return json(await this.publicState());
    if (path.endsWith("/start") && request.method === "POST") return this.start();
    if (path.endsWith("/stop") && request.method === "POST") return this.stop();
    if (path.endsWith("/run") && request.method === "POST") return this.manualRun();
    if (path.endsWith("/config") && request.method === "POST") return this.updateConfig(request);
    if (path.endsWith("/reset") && request.method === "POST") return this.resetPaper();
    if (path.endsWith("/export")) return json(await this.state());
    return json({ error: "Not found" }, 404);
  }

  async publicState() {
    const s = await this.state();
    return {
      ...s,
      capabilities: {
        ai: Boolean(this.env.AI),
        adminConfigured: Boolean(this.env.ADMIN_TOKEN),
        liveExecutionReady: this.liveExecutionAllowed(),
        leverage: false,
        market: "spot",
      },
    };
  }

  async start() {
    const s = await this.state();
    if (s.mode === "live" && !this.liveExecutionAllowed()) {
      return json({ error: "Live execution is locked. Required secrets/switch are not complete." }, 409);
    }
    s.engine.running = true;
    s.engine.lastError = null;
    s.engine.consecutiveErrors = 0;
    s.engine.nextRunAt = await this.schedule(2);
    s.engine.lastAction = "STARTED";
    await this.save(s);
    return json(await this.publicState());
  }

  async stop() {
    const s = await this.state();
    s.engine.running = false;
    s.engine.nextRunAt = null;
    s.engine.lastAction = "STOPPED";
    await this.ctx.storage.deleteAlarm();
    await this.save(s);
    return json(await this.publicState());
  }

  async manualRun() {
    try {
      await this.runCycle(true);
      return json(await this.publicState());
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  async updateConfig(request) {
    const input = await request.json().catch(() => ({}));
    const s = await this.state();
    if (s.position && input.symbol && String(input.symbol).toUpperCase() !== s.config.symbol) {
      return json({ error: "Close the active position before changing symbol." }, 409);
    }
    s.config = safeConfig(input, s.config);
    s.engine.lastAction = "CONFIG_UPDATED";
    await this.save(s);
    return json(await this.publicState());
  }

  async resetPaper() {
    const s = await this.state();
    if (s.mode !== "paper") return json({ error: "Reset is disabled in live mode." }, 409);
    const fresh = defaults(this.env);
    fresh.config = s.config;
    fresh.engine.running = false;
    await this.ctx.storage.deleteAlarm();
    await this.save(fresh);
    return json(await this.publicState());
  }

  async alarm() {
    const s = await this.state();
    if (!s.engine.running) return;
    try {
      await this.runCycle(false);
    } catch (e) {
      const failed = await this.state();
      failed.engine.lastError = e.message;
      failed.engine.consecutiveErrors = (failed.engine.consecutiveErrors || 0) + 1;
      failed.engine.lastAction = "ERROR";
      if (failed.engine.consecutiveErrors >= 5) {
        failed.engine.running = false;
        failed.engine.lastAction = "HALTED_AFTER_ERRORS";
        failed.engine.nextRunAt = null;
      }
      await this.save(failed);
    }
    const latest = await this.state();
    if (latest.engine.running) {
      latest.engine.nextRunAt = await this.schedule();
      await this.save(latest);
    }
  }

  async scanSymbol(baseUrl, s, symbol) {
    const [mainCandles, fastCandles, marketPrice] = await Promise.all([
      fetchKlines(baseUrl, symbol, s.config.interval, 200),
      fetchKlines(baseUrl, symbol, s.config.fastInterval, 200),
      fetchTickerPrice(baseUrl, symbol),
    ]);
    const analysis = analyzeMultiTimeframe(mainCandles, fastCandles, s.config.minSignalConfidence);
    return {
      symbol,
      marketPrice,
      mainCandles,
      fastCandles,
      analysis,
      decisionCandle: mainCandles.at(-1).closeTime,
    };
  }

  async runCycle(manual = false) {
    let s = await this.state();
    const baseUrl = this.env.MARKET_DATA_BASE_URL || "https://data-api.binance.vision";
    const tradeBaseUrl = this.env.TRADE_BASE_URL || "https://api.binance.com";
    const scanSymbols = [...new Set((s.config.scannerSymbols || []).slice(0, 5))];

    let selected;
    let ranked = [];
    const scanErrors = [];

    if (s.position) {
      selected = await this.scanSymbol(baseUrl, s, s.position.symbol);
      ranked = [selected];
    } else {
      const results = await Promise.allSettled(scanSymbols.map((symbol) => this.scanSymbol(baseUrl, s, symbol)));
      const successful = [];
      results.forEach((result, i) => {
        if (result.status === "fulfilled") successful.push(result.value);
        else scanErrors.push({ symbol: scanSymbols[i], error: String(result.reason?.message || result.reason || "scan failed").slice(0, 120) });
      });
      if (!successful.length) throw new Error(`Multi-coin scan failed: ${scanErrors.map((x) => `${x.symbol} ${x.error}`).join(" | ")}`);
      ranked = rankScanCandidates(successful);
      selected = ranked[0];
    }

    const { symbol, mainCandles, marketPrice, analysis, decisionCandle } = selected;
    s.market = {
      symbol,
      price: marketPrice,
      updatedAt: nowIso(),
      chart: [
        ...mainCandles.slice(-40).map((c) => ({ t: c.closeTime, o: c.open, h: c.high, l: c.low, c: c.close })),
        {
          t: Date.now(),
          o: mainCandles.at(-1).close,
          h: Math.max(mainCandles.at(-1).close, marketPrice),
          l: Math.min(mainCandles.at(-1).close, marketPrice),
          c: marketPrice,
        },
      ],
    };
    s.scanner = {
      updatedAt: nowIso(),
      bestSymbol: symbol,
      errors: scanErrors,
      symbols: ranked.map((x, index) => ({
        rank: index + 1,
        symbol: x.symbol,
        action: x.analysis.action,
        confidence: x.analysis.confidence,
        buyConfidence: x.analysis.buyConfidence,
        exitConfidence: x.analysis.exitConfidence,
        price: x.marketPrice,
        rsi: x.analysis.main.indicators.rsi,
        atrPct: x.analysis.main.indicators.atrPct,
        decisionCandle: x.decisionCandle,
      })),
    };

    if (s.mode === "live" && this.liveExecutionAllowed()) {
      const account = await getSpotAccount({ baseUrl: tradeBaseUrl, apiKey: this.env.BINANCE_API_KEY, apiSecret: this.env.BINANCE_API_SECRET });
      const rules = await fetchSymbolRules(baseUrl, s.position?.symbol || symbol);
      const quoteFree = getFreeBalance(account, rules.quoteAsset);
      if (!s.position) {
        s.account.cash = quoteFree;
        if (!s.account.liveSynced) {
          s.account.startingBalance = quoteFree;
          s.account.equity = quoteFree;
          s.account.dailyStartEquity = quoteFree;
          s.account.peakEquity = quoteFree;
          s.account.liveSynced = true;
        }
      }
    }

    if (s.position) s.position = updateTrailingStop(s.position, marketPrice);
    updateAccountMetrics(s, marketPrice);

    const riskExit = evaluateRiskExit(s.position, marketPrice);
    const blocked = dailyLossBlocked(s);
    const lastDecision = s.engine.lastDecisionCandles?.[symbol] || s.engine.lastDecisionCandle;
    let decided = "HOLD";
    let reason = s.position ? "POSITION_MONITORING" : "NO_QUALIFIED_SETUP_ACROSS_5_MARKETS";
    let ai = null;

    if (s.position && riskExit) {
      decided = "SELL";
      reason = riskExit.reason;
    } else if (lastDecision === decisionCandle) {
      reason = "WAIT_NEXT_CLOSED_CANDLE";
    } else if (s.position && analysis.action === "SELL") {
      decided = "SELL";
      reason = "MULTI_TIMEFRAME_EXIT";
    } else if (!s.position && analysis.action === "BUY") {
      if (blocked) {
        reason = "DAILY_LOSS_CIRCUIT_BREAKER";
      } else if (s.engine.cooldownUntil && Date.now() < Date.parse(s.engine.cooldownUntil)) {
        reason = "COOLDOWN";
      } else {
        ai = await aiValidateEntry(this.env, s, analysis, symbol);
        if (ai.approved) {
          decided = "BUY";
          reason = "BEST_OF_5_ENSEMBLE_CONFIRMED";
        } else {
          reason = "BEST_OF_5_AI_VETO";
        }
      }
    }

    if (!riskExit && lastDecision !== decisionCandle) {
      s.engine.lastDecisionCandles ||= {};
      s.engine.lastDecisionCandles[symbol] = decisionCandle;
      s.engine.lastDecisionCandle = decisionCandle;
    }

    const signal = {
      id: crypto.randomUUID(),
      at: nowIso(),
      symbol,
      deterministicAction: analysis.action,
      action: decided,
      confidence: analysis.confidence,
      buyConfidence: analysis.buyConfidence,
      exitConfidence: analysis.exitConfidence,
      price: marketPrice,
      candleClosePrice: analysis.price,
      decisionCandle,
      reason,
      ai,
      indicators: analysis.main.indicators,
      scannerRank: s.scanner.symbols.find((x) => x.symbol === symbol)?.rank || 1,
    };
    s.signal = signal;
    pushLimited(s.signals, signal, 100);

    if (decided === "BUY") s = await this.executeBuy(s, analysis, marketPrice, symbol);
    if (decided === "SELL" && s.position) s = await this.executeSell(s, marketPrice, reason);

    updateAccountMetrics(s, marketPrice);
    s.engine.lastCycleAt = nowIso();
    s.engine.lastAction = decided;
    s.engine.lastError = null;
    s.engine.consecutiveErrors = 0;
    s.engine.cycles = (s.engine.cycles || 0) + 1;
    if (manual && !s.engine.running) s.engine.nextRunAt = null;
    await this.save(s);
    return s;
  }

  async executeBuy(s, analysis, marketPrice, symbol = s.signal?.symbol || s.config.symbol) {
    const price = marketPrice;
    const plan = computeTradePlan({
      equity: s.account.equity,
      cash: s.account.cash,
      price,
      atrPct: analysis.main.indicators.atrPct,
      riskPerTrade: s.config.riskPerTrade,
      maxPositionPct: s.config.maxPositionPct,
      stopLossPct: s.config.stopLossPct,
      takeProfitPct: s.config.takeProfitPct,
    });
    if (plan.notional < 10) throw new Error("Trade notional below minimum safety threshold");

    let fillPrice = price;
    let qty = plan.qty;
    let notional = plan.notional;
    let orderId = `paper-${Date.now()}`;
    let fee = 0;

    if (s.mode === "live") {
      if (!this.liveExecutionAllowed()) throw new Error("Live execution lock is not satisfied");
      const order = await placeMarketBuy({
        baseUrl: this.env.TRADE_BASE_URL || "https://api.binance.com",
        apiKey: this.env.BINANCE_API_KEY,
        apiSecret: this.env.BINANCE_API_SECRET,
        symbol,
        quoteOrderQty: plan.notional,
      });
      const fill = parseFill(order, price);
      fillPrice = fill.price;
      qty = fill.executedQty;
      notional = fill.quoteQty || plan.notional;
      orderId = fill.orderId;
    } else {
      fee = notional * 0.001;
      s.account.cash -= notional + fee;
    }

    const stopPct = plan.stopPct;
    const takeProfitPct = plan.takeProfitPct;
    const trailingPct = plan.trailingPct;
    s.position = {
      symbol,
      qty: round(qty, 10),
      entryPrice: round(fillPrice, 8),
      notional: round(notional, 2),
      cost: round(notional + fee, 2),
      stopPct,
      takeProfitPct,
      trailingPct,
      stopPrice: round(fillPrice * (1 - stopPct), 8),
      takeProfitPrice: round(fillPrice * (1 + takeProfitPct), 8),
      trailingStopPrice: round(fillPrice * (1 - trailingPct), 8),
      highWaterPrice: round(fillPrice, 8),
      openedAt: nowIso(),
      orderId,
    };
    pushLimited(s.trades, {
      id: crypto.randomUUID(),
      at: nowIso(),
      side: "BUY",
      symbol,
      price: round(fillPrice, 8),
      qty: round(qty, 10),
      notional: round(notional, 2),
      pnl: null,
      mode: s.mode,
      reason: "BEST_OF_5_ENSEMBLE_CONFIRMED",
      orderId,
    });

    if (s.mode === "live") {
      await sleep(200);
      const rules = await fetchSymbolRules(this.env.MARKET_DATA_BASE_URL || "https://data-api.binance.vision", symbol);
      const account = await getSpotAccount({ baseUrl: this.env.TRADE_BASE_URL || "https://api.binance.com", apiKey: this.env.BINANCE_API_KEY, apiSecret: this.env.BINANCE_API_SECRET });
      s.account.cash = getFreeBalance(account, rules.quoteAsset);
    }
    return s;
  }

  async executeSell(s, marketPrice, reason) {
    const p = s.position;
    let fillPrice = marketPrice;
    let qty = p.qty;
    let proceeds = qty * fillPrice;
    let fee = 0;
    let orderId = `paper-${Date.now()}`;

    if (s.mode === "live") {
      if (!this.liveExecutionAllowed()) throw new Error("Live execution lock is not satisfied");
      const marketBaseUrl = this.env.MARKET_DATA_BASE_URL || "https://data-api.binance.vision";
      const tradeBaseUrl = this.env.TRADE_BASE_URL || "https://api.binance.com";
      const rules = await fetchSymbolRules(marketBaseUrl, p.symbol);
      const account = await getSpotAccount({ baseUrl: tradeBaseUrl, apiKey: this.env.BINANCE_API_KEY, apiSecret: this.env.BINANCE_API_SECRET });
      const freeBase = getFreeBalance(account, rules.baseAsset);
      qty = floorToStep(Math.min(p.qty, freeBase), rules.stepSize);
      if (qty < rules.minQty || qty <= 0) throw new Error("Live sell quantity is below exchange minimum");
      const order = await placeMarketSell({
        baseUrl: tradeBaseUrl,
        apiKey: this.env.BINANCE_API_KEY,
        apiSecret: this.env.BINANCE_API_SECRET,
        symbol: p.symbol,
        quantity: qty,
      });
      const fill = parseFill(order, marketPrice);
      fillPrice = fill.price;
      proceeds = fill.quoteQty || qty * fillPrice;
      orderId = fill.orderId;
      await sleep(200);
      const refreshed = await getSpotAccount({ baseUrl: tradeBaseUrl, apiKey: this.env.BINANCE_API_KEY, apiSecret: this.env.BINANCE_API_SECRET });
      s.account.cash = getFreeBalance(refreshed, rules.quoteAsset);
    } else {
      fee = proceeds * 0.001;
      s.account.cash += proceeds - fee;
    }

    const pnl = (proceeds - fee) - p.cost;
    s.account.realizedPnl += pnl;
    if (pnl >= 0) s.account.wins += 1;
    else s.account.losses += 1;
    pushLimited(s.trades, {
      id: crypto.randomUUID(),
      at: nowIso(),
      side: "SELL",
      symbol: p.symbol,
      price: round(fillPrice, 8),
      qty: round(qty, 10),
      notional: round(proceeds, 2),
      pnl: round(pnl, 2),
      mode: s.mode,
      reason,
      orderId,
    });
    s.position = null;
    s.engine.cooldownUntil = new Date(Date.now() + 15 * 60_000).toISOString();
    return s;
  }
}

function authorized(request, env) {
  if (!env.ADMIN_TOKEN) return true;
  const auth = request.headers.get("authorization") || "";
  const direct = request.headers.get("x-admin-token") || "";
  return auth === `Bearer ${env.ADMIN_TOKEN}` || direct === env.ADMIN_TOKEN;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "KAI TRAD",
        version: "1.4.0",
        mode: env.TRADING_MODE === "live" ? "live" : "paper",
        adminConfigured: Boolean(env.ADMIN_TOKEN),
        liveExecutionEnabled: env.ENABLE_LIVE_EXECUTION === "YES_I_ACCEPT_RISK",
        time: nowIso(),
      });
    }

    if (url.pathname.startsWith("/api/")) {
      if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
      const id = env.TRADING_STATE.idFromName("primary");
      const stub = env.TRADING_STATE.get(id);
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
