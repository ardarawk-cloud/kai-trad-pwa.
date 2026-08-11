import {
  analyzeMultiTimeframe,
  computeTradePlan,
  computeTradeQuality,
  computePerformanceStats,
  detectMarketRegime,
  isRegimeEntryEligible,
  evaluateRiskExit,
  rankScanCandidates,
  safeConfig,
  validateExecutionRules,
  updateTrailingStop,
} from "./engine.js";
import {
  fetchKlines,
  fetchTickerPrice,
  floorToStep,
} from "./binance.js";
import {
  fetchTokocryptoSymbolRules,
  getTokocryptoFreeBalance,
  getTokocryptoSpotAccount,
  placeTokocryptoMarketBuy,
  placeTokocryptoMarketSell,
  tokocryptoPublicPreflight,
  waitForTokocryptoFill,
} from "./tokocrypto.js";
import { indodaxPublicPreflight } from "./indodax.js";

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
    version: "1.8.1",
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
      paperStartingBalanceUsd: starting,
      usdIdrRate: Number(env.USD_IDR_RATE || 17850),
      dailyGoalMinUsd: Number(env.DAILY_GOAL_MIN_USD || 3),
      dailyGoalMaxUsd: Number(env.DAILY_GOAL_MAX_USD || 5),
      pcFundTargetIdr: Number(env.PC_FUND_TARGET_IDR || 0),
      pcFundSavedIdr: Number(env.PC_FUND_SAVED_IDR || 0),
      maxConsecutiveLosses: Number(env.MAX_CONSECUTIVE_LOSSES || 3),
      lossStreakCooldownMinutes: Number(env.LOSS_STREAK_COOLDOWN_MINUTES || 240),
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
      breaker: { active: false, reason: null, until: null },
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
      consecutiveLosses: 0,
      maxConsecutiveLossesSeen: 0,
    },
    position: null,
    signal: null,
    market: { symbol: env.SYMBOL || "BTCUSDT", price: null, updatedAt: null, chart: [] },
    scanner: { updatedAt: null, symbols: [], bestSymbol: env.SYMBOL || "BTCUSDT", errors: [] },
    broker: {
      primary: String(env.PRIMARY_BROKER || "tokocrypto").toLowerCase(),
      secondary: "indodax",
      lastCheck: null,
    },
    trades: [],
    signals: [],
    decisionLog: [],
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
    const d = defaults(this.env);
    s.config.paperStartingBalanceUsd ??= d.config.paperStartingBalanceUsd;
    s.config.usdIdrRate ??= d.config.usdIdrRate;
    s.config.dailyGoalMinUsd ??= d.config.dailyGoalMinUsd;
    s.config.dailyGoalMaxUsd ??= d.config.dailyGoalMaxUsd;
    s.config.pcFundTargetIdr ??= d.config.pcFundTargetIdr;
    s.config.pcFundSavedIdr ??= d.config.pcFundSavedIdr;
    s.config.maxConsecutiveLosses ??= d.config.maxConsecutiveLosses;
    s.config.lossStreakCooldownMinutes ??= d.config.lossStreakCooldownMinutes;
    if (!Array.isArray(s.config.scannerSymbols) || !s.config.scannerSymbols.length) {
      s.config.scannerSymbols = String(this.env.SCAN_SYMBOLS || "BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT")
        .split(",").map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, 5);
    }
    s.engine.lastDecisionCandles ||= {};
    s.scanner ||= { updatedAt: null, symbols: [], bestSymbol: s.config.symbol, errors: [] };
    s.market ||= { symbol: s.config.symbol, price: null, updatedAt: null, chart: [] };
    s.decisionLog ||= [];
    s.broker ||= { primary: String(this.env.PRIMARY_BROKER || "tokocrypto").toLowerCase(), secondary: "indodax", lastCheck: null };
    s.broker.primary = String(this.env.PRIMARY_BROKER || s.broker.primary || "tokocrypto").toLowerCase();
    s.broker.secondary ||= "indodax";
    s.engine.breaker ||= { active: false, reason: null, until: null };
    s.account.consecutiveLosses ??= 0;
    s.account.maxConsecutiveLossesSeen ??= 0;
    s.market.symbol ||= s.position?.symbol || s.signal?.symbol || s.config.symbol;
    s.version = "1.8.1";
    return s;
  }

  async save(s) {
    await this.ctx.storage.put("state", s);
  }

  liveExecutionAllowed() {
    const primary = String(this.env.PRIMARY_BROKER || "tokocrypto").toLowerCase();
    return this.env.TRADING_MODE === "live" &&
      primary === "tokocrypto" &&
      this.env.BROKER_LIVE_STAGE === "APPROVED_AFTER_PREFLIGHT" &&
      this.env.ENABLE_LIVE_EXECUTION === "YES_I_ACCEPT_RISK" &&
      this.env.TOKOCRYPTO_LIVE_ACK === "I_UNDERSTAND_SPOT_RISK" &&
      Boolean(this.env.TOKOCRYPTO_API_KEY) && Boolean(this.env.TOKOCRYPTO_API_SECRET) && Boolean(this.env.ADMIN_TOKEN);
  }

  brokerCredentialsConfigured() {
    return Boolean(this.env.TOKOCRYPTO_API_KEY) && Boolean(this.env.TOKOCRYPTO_API_SECRET);
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
    if (path.endsWith("/broker/check") && request.method === "POST") return this.brokerCheck();
    if (path.endsWith("/reset") && request.method === "POST") return this.resetPaper();
    if (path.endsWith("/export")) return json(await this.state());
    return json({ error: "Not found" }, 404);
  }

  async publicState() {
    const s = await this.state();
    const performance = computePerformanceStats(s.trades || []);
    const rate = Number(s.config.usdIdrRate || 0);
    const targetMin = Number(s.config.dailyGoalMinUsd || 0);
    const targetMax = Math.max(targetMin, Number(s.config.dailyGoalMaxUsd || targetMin));
    const positiveDaily = Math.max(0, Number(s.account.dailyPnl || 0));
    const pcTarget = Number(s.config.pcFundTargetIdr || 0);
    const pcSaved = Number(s.config.pcFundSavedIdr || 0);
    return {
      ...s,
      performance,
      financeDisplay: {
        usdIdrRate: rate,
        dailyGoal: {
          minUsd: targetMin,
          maxUsd: targetMax,
          minIdr: round(targetMin * rate, 0),
          maxIdr: round(targetMax * rate, 0),
          todayUsd: round(Number(s.account.dailyPnl || 0), 2),
          todayIdr: round(Number(s.account.dailyPnl || 0) * rate, 0),
          progressPct: targetMin > 0 ? round(Math.max(0, Math.min(100, positiveDaily / targetMin * 100)), 1) : 0,
        },
        pcFund: {
          targetIdr: pcTarget,
          savedIdr: pcSaved,
          remainingIdr: Math.max(0, pcTarget - pcSaved),
          progressPct: pcTarget > 0 ? round(Math.min(100, pcSaved / pcTarget * 100), 1) : 0,
          potentialTodayIdr: round(positiveDaily * rate, 0),
        },
      },
      safety: {
        breaker: s.engine.breaker || { active: false },
        dailyLossBlocked: dailyLossBlocked(s),
        consecutiveLosses: s.account.consecutiveLosses || performance.consecutiveLosses || 0,
        maxConsecutiveLosses: s.config.maxConsecutiveLosses,
        consecutiveErrors: s.engine.consecutiveErrors || 0,
        maxExecutionErrors: 3,
        cooldownUntil: s.engine.cooldownUntil,
      },
      broker: (() => {
        const toko = s.broker?.lastCheck || null;
        const indo = s.broker?.indodaxCheck || null;
        const fallback = Boolean(toko?.checkedAt && !toko?.reachable && indo?.reachable);
        return {
          primary: fallback ? "indodax" : (s.broker?.primary || "tokocrypto"),
          secondary: fallback ? "tokocrypto" : (s.broker?.secondary || "indodax"),
          lastCheck: fallback ? indo : toko,
          credentialsConfigured: fallback ? false : this.brokerCredentialsConfigured(),
          liveStage: this.env.BROKER_LIVE_STAGE || "LOCKED",
          liveExecutionReady: this.liveExecutionAllowed(),
          withdrawalSupport: false,
          indodaxStatus: fallback
            ? (String(toko?.error || "").includes("403") ? "WAF BLOCKED" : "FAILED")
            : (indo?.reachable ? "ONLINE" : (indo?.checkedAt ? "FAILED" : "STANDBY")),
          indodaxCheck: indo,
          compatibility: s.broker?.compatibility || "NOT_CHECKED",
          tokocryptoCheck: toko,
        };
      })(),
      capabilities: {
        ai: Boolean(this.env.AI),
        adminConfigured: Boolean(this.env.ADMIN_TOKEN),
        liveExecutionReady: this.liveExecutionAllowed(),
        broker: s.broker?.primary || "tokocrypto",
        leverage: false,
        market: "spot",
      },
    };
  }

  async brokerCheck() {
    const s = await this.state();
    const checkedAt = nowIso();
    const [tokoResult, indodaxResult] = await Promise.allSettled([
      tokocryptoPublicPreflight({
        publicBaseUrl: this.env.TOKOCRYPTO_PUBLIC_BASE_URL || "https://www.tokocrypto.site",
        symbol: s.config.symbol,
      }),
      indodaxPublicPreflight({
        baseUrl: this.env.INDODAX_API_BASE_URL || "https://indodax.com",
        symbol: s.config.symbol,
      }),
    ]);

    const toko = tokoResult.status === "fulfilled"
      ? { ...tokoResult.value, checkedAt, error: null }
      : { broker: "tokocrypto", reachable: false, checkedAt, error: String(tokoResult.reason?.message || tokoResult.reason || "Tokocrypto probe failed") };
    const indodax = indodaxResult.status === "fulfilled"
      ? { ...indodaxResult.value, checkedAt, error: null }
      : { broker: "indodax", reachable: false, checkedAt, error: String(indodaxResult.reason?.message || indodaxResult.reason || "Indodax probe failed") };

    s.broker ||= { primary: "tokocrypto", secondary: "indodax", lastCheck: null };
    s.broker.lastCheck = toko;
    s.broker.indodaxCheck = indodax;
    s.broker.compatibility = toko.reachable ? "TOKOCRYPTO_PUBLIC_OK" : indodax.reachable ? "INDODAX_FALLBACK_OK" : "NO_BROKER_REACHABLE";
    s.engine.lastAction = toko.reachable || indodax.reachable ? "BROKER_COMPATIBILITY_PASS" : "BROKER_COMPATIBILITY_FAIL";
    await this.save(s);
    if (toko.reachable) return json(await this.publicState());
    if (indodax.reachable) {
      return json({ error: "Tokocrypto WAF blocked • Indodax fallback ONLINE" }, 409);
    }
    return json({ error: `Broker probe failed • Tokocrypto: ${toko.error || "FAILED"} • Indodax: ${indodax.error || "FAILED"}` }, 503);
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
    const starting = Number(s.config.paperStartingBalanceUsd || fresh.account.startingBalance);
    fresh.account.startingBalance = starting;
    fresh.account.cash = starting;
    fresh.account.equity = starting;
    fresh.account.dailyStartEquity = starting;
    fresh.account.peakEquity = starting;
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
      if (failed.engine.consecutiveErrors >= 3) {
        failed.engine.running = false;
        failed.engine.lastAction = "HALTED_AFTER_ERRORS";
        failed.engine.nextRunAt = null;
        failed.engine.breaker = { active: true, reason: "API_ERROR_STREAK", until: null };
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
    const regime = detectMarketRegime(mainCandles);
    const tradeQuality = computeTradeQuality(analysis, regime);
    const entryEligible = isRegimeEntryEligible(analysis, regime, s.config.minSignalConfidence);
    return {
      symbol,
      marketPrice,
      mainCandles,
      fastCandles,
      analysis,
      regime,
      tradeQuality,
      entryEligible,
      decisionCandle: mainCandles.at(-1).closeTime,
    };
  }

  async runCycle(manual = false) {
    let s = await this.state();
    const baseUrl = this.env.MARKET_DATA_BASE_URL || "https://data-api.binance.vision";
    const tradeBaseUrl = this.env.TRADE_BASE_URL || "https://api.binance.com";
    const scanSymbols = [...new Set((s.config.scannerSymbols || []).slice(0, 5))];
    if (s.engine.cooldownUntil && Date.now() >= Date.parse(s.engine.cooldownUntil)) {
      s.engine.cooldownUntil = null;
      if (s.engine.breaker?.reason === "LOSS_STREAK") s.engine.breaker = { active: false, reason: null, until: null };
    }

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

    const { symbol, mainCandles, marketPrice, analysis, regime, tradeQuality, entryEligible, decisionCandle } = selected;
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
        regime: x.regime?.regime || "SIDEWAYS",
        trendStrength: x.regime?.trendStrength ?? 0,
        tradeQuality: x.tradeQuality ?? 0,
        entryEligible: Boolean(x.entryEligible),
        decisionCandle: x.decisionCandle,
      })),
    };

    if (s.mode === "live" && this.liveExecutionAllowed()) {
      const tokoBaseUrl = this.env.TOKOCRYPTO_API_BASE_URL || "https://www.tokocrypto.com";
      const account = await getTokocryptoSpotAccount({ baseUrl: tokoBaseUrl, apiKey: this.env.TOKOCRYPTO_API_KEY, apiSecret: this.env.TOKOCRYPTO_API_SECRET });
      const rules = await fetchTokocryptoSymbolRules({ baseUrl: tokoBaseUrl, symbol: s.position?.symbol || symbol });
      const quoteFree = getTokocryptoFreeBalance(account, rules.quoteAsset);
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
      const abnormalMarket = Number(analysis.main?.indicators?.atrPct || 0) > 5 || Number(analysis.main?.indicators?.volumeRatio || 0) > 6;
      if (abnormalMarket) {
        reason = "ABNORMAL_MARKET_GUARD";
      } else if (!entryEligible) {
        reason = `REGIME_FILTER_${regime?.regime || "UNKNOWN"}`;
      } else if (blocked) {
        reason = "DAILY_LOSS_CIRCUIT_BREAKER";
      } else if ((s.account.consecutiveLosses || 0) >= s.config.maxConsecutiveLosses && s.engine.cooldownUntil && Date.now() < Date.parse(s.engine.cooldownUntil)) {
        reason = "LOSS_STREAK_BREAKER";
      } else if (s.engine.cooldownUntil && Date.now() < Date.parse(s.engine.cooldownUntil)) {
        reason = "COOLDOWN";
      } else {
        ai = await aiValidateEntry(this.env, s, analysis, symbol);
        if (ai.approved) {
          decided = "BUY";
          reason = "BEST_OF_5_REGIME_AI_CONFIRMED";
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
      regime,
      tradeQuality,
      entryEligible,
    };
    s.signal = signal;
    pushLimited(s.signals, signal, 100);
    pushLimited(s.decisionLog, {
      id: crypto.randomUUID(),
      at: signal.at,
      symbol,
      action: decided,
      deterministicAction: analysis.action,
      confidence: analysis.confidence,
      buyConfidence: analysis.buyConfidence,
      tradeQuality,
      regime: regime?.regime || "SIDEWAYS",
      entryEligible,
      reason,
    }, 120);

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
      const tokoBaseUrl = this.env.TOKOCRYPTO_API_BASE_URL || "https://www.tokocrypto.com";
      const rules = await fetchTokocryptoSymbolRules({ baseUrl: tokoBaseUrl, symbol });
      const guard = validateExecutionRules({ notional: plan.notional, quantity: plan.qty, price, rules });
      if (!guard.ok) throw new Error(`Execution guard blocked BUY: ${guard.errors.join(",")}`);
      const clientOrderId = `kaiB${Date.now().toString(36)}${crypto.randomUUID().slice(0, 6)}`.slice(0, 32);
      const order = await placeTokocryptoMarketBuy({
        baseUrl: tokoBaseUrl,
        apiKey: this.env.TOKOCRYPTO_API_KEY,
        apiSecret: this.env.TOKOCRYPTO_API_SECRET,
        symbol,
        quoteOrderQty: plan.notional,
        clientOrderId,
      });
      const fill = await waitForTokocryptoFill({
        baseUrl: tokoBaseUrl,
        apiKey: this.env.TOKOCRYPTO_API_KEY,
        apiSecret: this.env.TOKOCRYPTO_API_SECRET,
        order,
        fallbackPrice: price,
      });
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
      fee: round(fee, 4),
      mode: s.mode,
      reason: "BEST_OF_5_REGIME_AI_CONFIRMED",
      orderId,
    });

    if (s.mode === "live") {
      await sleep(200);
      const tokoBaseUrl = this.env.TOKOCRYPTO_API_BASE_URL || "https://www.tokocrypto.com";
      const rules = await fetchTokocryptoSymbolRules({ baseUrl: tokoBaseUrl, symbol });
      const account = await getTokocryptoSpotAccount({ baseUrl: tokoBaseUrl, apiKey: this.env.TOKOCRYPTO_API_KEY, apiSecret: this.env.TOKOCRYPTO_API_SECRET });
      s.account.cash = getTokocryptoFreeBalance(account, rules.quoteAsset);
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
      const tokoBaseUrl = this.env.TOKOCRYPTO_API_BASE_URL || "https://www.tokocrypto.com";
      const rules = await fetchTokocryptoSymbolRules({ baseUrl: tokoBaseUrl, symbol: p.symbol });
      const account = await getTokocryptoSpotAccount({ baseUrl: tokoBaseUrl, apiKey: this.env.TOKOCRYPTO_API_KEY, apiSecret: this.env.TOKOCRYPTO_API_SECRET });
      const freeBase = getTokocryptoFreeBalance(account, rules.baseAsset);
      qty = floorToStep(Math.min(p.qty, freeBase), rules.stepSize);
      const guard = validateExecutionRules({ notional: qty * marketPrice, quantity: qty, price: marketPrice, rules });
      if (!guard.ok) throw new Error(`Execution guard blocked SELL: ${guard.errors.join(",")}`);
      const clientOrderId = `kaiS${Date.now().toString(36)}${crypto.randomUUID().slice(0, 6)}`.slice(0, 32);
      const order = await placeTokocryptoMarketSell({
        baseUrl: tokoBaseUrl,
        apiKey: this.env.TOKOCRYPTO_API_KEY,
        apiSecret: this.env.TOKOCRYPTO_API_SECRET,
        symbol: p.symbol,
        quantity: qty,
        clientOrderId,
      });
      const fill = await waitForTokocryptoFill({
        baseUrl: tokoBaseUrl,
        apiKey: this.env.TOKOCRYPTO_API_KEY,
        apiSecret: this.env.TOKOCRYPTO_API_SECRET,
        order,
        fallbackPrice: marketPrice,
      });
      fillPrice = fill.price;
      proceeds = fill.quoteQty || qty * fillPrice;
      orderId = fill.orderId;
      await sleep(200);
      const refreshed = await getTokocryptoSpotAccount({ baseUrl: tokoBaseUrl, apiKey: this.env.TOKOCRYPTO_API_KEY, apiSecret: this.env.TOKOCRYPTO_API_SECRET });
      s.account.cash = getTokocryptoFreeBalance(refreshed, rules.quoteAsset);
    } else {
      fee = proceeds * 0.001;
      s.account.cash += proceeds - fee;
    }

    const pnl = (proceeds - fee) - p.cost;
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
    pushLimited(s.trades, {
      id: crypto.randomUUID(),
      at: nowIso(),
      side: "SELL",
      symbol: p.symbol,
      price: round(fillPrice, 8),
      qty: round(qty, 10),
      notional: round(proceeds, 2),
      pnl: round(pnl, 2),
      fee: round(fee, 4),
      holdingMinutes: Math.max(0, round((Date.now() - Date.parse(p.openedAt || nowIso())) / 60000, 1)),
      entryPrice: p.entryPrice,
      mode: s.mode,
      reason,
      orderId,
    });
    s.position = null;
    const baseCooldown = 15;
    const lossBreaker = (s.account.consecutiveLosses || 0) >= s.config.maxConsecutiveLosses;
    const cooldownMinutes = lossBreaker ? s.config.lossStreakCooldownMinutes : baseCooldown;
    s.engine.cooldownUntil = new Date(Date.now() + cooldownMinutes * 60_000).toISOString();
    if (lossBreaker) s.engine.breaker = { active: true, reason: "LOSS_STREAK", until: s.engine.cooldownUntil };
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
        version: "1.8.1",
        mode: env.TRADING_MODE === "live" ? "live" : "paper",
        broker: String(env.PRIMARY_BROKER || "tokocrypto").toLowerCase(),
        adminConfigured: Boolean(env.ADMIN_TOKEN),
        brokerCredentialsConfigured: Boolean(env.TOKOCRYPTO_API_KEY) && Boolean(env.TOKOCRYPTO_API_SECRET),
        liveStage: env.BROKER_LIVE_STAGE || "LOCKED",
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
