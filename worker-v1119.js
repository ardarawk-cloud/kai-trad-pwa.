import baseWorker, { TradingState as BaseTradingState } from "./worker-v1118.js";
import {
  analyzeMultiTimeframe,
  computeTradeQuality,
  detectMarketRegime,
  isRegimeEntryEligible,
} from "./engine.js";
import {
  aggregateIndodaxCandles,
  getIndodaxTimeframeSpec,
  normalizeIndodaxHistoryRows,
} from "./indodax.js";
import { stampQuote } from "./quote-integrity-v1111.js";

const APP_VERSION = "1.11.8";
const BRIDGE_UNIVERSE = ["BTCUSDT", "ETHUSDT"];
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function bridgeBaseUrl(env) {
  return String(env.INDODAX_BRIDGE_URL || "https://kai-trad-indodax-bridge.ardarawk.workers.dev").replace(/\/$/, "");
}

async function fetchBridgePayload(env, symbols, { summary = false } = {}) {
  const clean = [...new Set((symbols || []).map((x) => String(x || "").trim().toUpperCase()).filter(Boolean))].slice(0, 2);
  if (!clean.length) throw new Error("Indodax bridge requires at least one symbol");

  const path = `/batch?symbols=${encodeURIComponent(clean.join(","))}${summary ? "&summary=1" : ""}`;
  let response;
  if (env.INDODAX_BRIDGE?.fetch) {
    response = await env.INDODAX_BRIDGE.fetch(new Request(`https://indodax-bridge.internal${path}`));
  } else {
    response = await fetch(`${bridgeBaseUrl(env)}${path}`, {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 0 },
    });
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(`Indodax bridge HTTP ${response.status}: ${payload?.error || "invalid response"}`);
  }
  return payload;
}

function normalizeBridgeCandles(rows, interval, limit = 200) {
  const spec = getIndodaxTimeframeSpec(interval);
  let candles = normalizeIndodaxHistoryRows(rows, spec.sourceCandleMs);
  if (spec.aggregate > 1) candles = aggregateIndodaxCandles(candles, spec.candleMs, spec.aggregate);
  candles = candles.filter((c) => c.closeTime <= Date.now()).slice(-Math.max(60, Math.min(500, Number(limit) || 200)));
  if (candles.length < 60) {
    throw new Error(`Insufficient Indodax bridge candle data for ${interval}: ${candles.length}`);
  }
  return candles;
}

function quoteFromBridge(row) {
  const ticker = row?.ticker?.body?.ticker || {};
  const last = Number(ticker.last || 0);
  const bid = Number(ticker.buy || 0);
  const ask = Number(ticker.sell || 0);
  const validSpread = last > 0 && bid > 0 && ask > 0 && ask >= bid;
  if (!(last > 0)) throw new Error("Indodax bridge ticker last price unavailable");
  const mid = validSpread ? (bid + ask) / 2 : last;
  return stampQuote({
    last,
    bid: validSpread ? bid : last,
    ask: validSpread ? ask : last,
    mid,
    spreadPct: validSpread && mid > 0 ? ((ask - bid) / mid) * 100 : 0,
    spreadModeled: validSpread,
    source: validSpread ? "INDODAX_LIVE_BID_ASK" : "INDODAX_LAST_ONLY",
    pairId: row?.pair?.id || null,
    transport: "BROWSER_RUN_BRIDGE",
  }, {
    nowMs: Date.now(),
    auditId: crypto.randomUUID(),
  });
}

export class TradingState extends BaseTradingState {
  async state() {
    const s = await super.state();
    s.version = APP_VERSION;

    const current = Array.isArray(s.config?.scannerSymbols)
      ? s.config.scannerSymbols.map((x) => String(x).toUpperCase())
      : [];
    if (current.join(",") !== BRIDGE_UNIVERSE.join(",")) {
      s.config.scannerSymbols = [...BRIDGE_UNIVERSE];
      s.scanner ||= {};
      s.scanner.cursor = 0;
      s.engine ||= {};
      s.engine.indodaxBridgeUniverseMigratedAt ||= new Date().toISOString();
      await this.save(s);
    }
    return s;
  }

  async bridgeBatch(s, requiredSymbol = null) {
    const symbols = s.position
      ? [requiredSymbol || s.position.symbol]
      : [...new Set([...(s.config?.scannerSymbols || BRIDGE_UNIVERSE), requiredSymbol].filter(Boolean))].slice(0, 2);
    const key = symbols.join(",");
    if (this._bridgeBatch?.key === key && Date.now() - this._bridgeBatch.at < 20_000) {
      return this._bridgeBatch.payload;
    }
    const payload = await fetchBridgePayload(this.env, symbols);
    this._bridgeBatch = { key, at: Date.now(), payload };
    return payload;
  }

  async scanSymbol(_baseUrl, s, symbol) {
    const payload = await this.bridgeBatch(s, symbol);
    const row = payload?.symbols?.[symbol];
    if (!row?.supported) throw new Error(`Indodax bridge pair unavailable: ${symbol}`);

    for (const [name, part] of [["ticker", row.ticker], ["main", row.main], ["fast", row.fast]]) {
      if (Number(part?.status || 0) !== 200) {
        throw new Error(`Indodax bridge ${name} HTTP ${part?.status || 0} for ${symbol}`);
      }
    }

    const mainCandles = normalizeBridgeCandles(row.main.body, s.config.interval, 200);
    const fastCandles = normalizeBridgeCandles(row.fast.body, s.config.fastInterval, 200);
    const marketQuote = quoteFromBridge(row);
    const marketPrice = marketQuote.last;
    const analysis = analyzeMultiTimeframe(mainCandles, fastCandles, s.config.minSignalConfidence);
    const regime = detectMarketRegime(mainCandles);
    const tradeQuality = computeTradeQuality(analysis, regime);
    const entryEligible = isRegimeEntryEligible(analysis, regime, s.config.minSignalConfidence);

    this._evidenceQuotes ||= new Map();
    this._evidenceQuotes.set(symbol, marketQuote);

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
      marketQuote,
    };
  }

  async brokerCheck() {
    const s = await this.state();
    const checkedAt = new Date().toISOString();
    try {
      const payload = await fetchBridgePayload(this.env, [s.config.symbol], { summary: true });
      const row = payload?.symbols?.[s.config.symbol];
      const reachable = Boolean(
        row?.supported &&
        Number(row.tickerStatus) === 200 &&
        Number(row.mainStatus) === 200 &&
        Number(row.fastStatus) === 200
      );
      const indodax = {
        broker: "indodax",
        reachable,
        checkedAt,
        endpointHost: "kai-trad-indodax-bridge",
        transport: "BROWSER_RUN_BRIDGE",
        latencyMs: Number(payload.durationMs || 0),
        symbol: s.config.symbol,
        symbolSupported: Boolean(row?.supported),
        pairId: row?.pair?.id || null,
        tickerId: row?.pair?.ticker_id || null,
        error: reachable ? null : (row?.error || "Indodax bridge market-data check failed"),
      };

      s.broker ||= {};
      s.broker.primary = "indodax";
      s.broker.secondary = "tokocrypto";
      s.broker.indodaxCheck = indodax;
      s.broker.compatibility = reachable ? "INDODAX_BROWSER_BRIDGE_OK" : "NO_BROKER_REACHABLE";
      s.engine.lastAction = reachable ? "BROKER_COMPATIBILITY_PASS" : "BROKER_COMPATIBILITY_FAIL";
      await this.save(s);

      if (!reachable) return json({ error: indodax.error }, 503);
      return json(await this.publicState());
    } catch (error) {
      s.broker ||= {};
      s.broker.primary = "indodax";
      s.broker.secondary = "tokocrypto";
      s.broker.indodaxCheck = {
        broker: "indodax",
        reachable: false,
        checkedAt,
        endpointHost: "kai-trad-indodax-bridge",
        transport: "BROWSER_RUN_BRIDGE",
        error: String(error?.message || error || "Indodax bridge failed"),
      };
      s.broker.compatibility = "NO_BROKER_REACHABLE";
      s.engine.lastAction = "BROKER_COMPATIBILITY_FAIL";
      await this.save(s);
      return json({ error: s.broker.indodaxCheck.error }, 503);
    }
  }

  async start() {
    const s = await this.state();
    if (s.mode === "live" && !this.liveExecutionAllowed()) {
      return json({ error: "Live execution is locked. Evidence and owner approval are still required." }, 409);
    }

    // Recover only the stale API-error halt. Trade history/evidence/account state
    // remain untouched.
    if (s.engine?.breaker?.reason === "API_ERROR_STREAK") {
      s.engine.breaker = { active: false, reason: null, until: null };
    }
    s.engine.running = true;
    s.engine.lastError = null;
    s.engine.consecutiveErrors = 0;
    s.engine.lastAction = "STARTED_AFTER_INDODAX_BRIDGE";
    s.engine.nextRunAt = await this.schedule(2);
    await this.save(s);
    return json(await this.publicState());
  }

  async publicState() {
    const s = await super.publicState();
    const indo = s.broker?.indodaxCheck || null;
    s.version = APP_VERSION;
    s.broker = {
      ...(s.broker || {}),
      primary: "indodax",
      secondary: "tokocrypto",
      lastCheck: indo || s.broker?.lastCheck || null,
      credentialsConfigured: false,
      liveStage: this.env.BROKER_LIVE_STAGE || "LOCKED",
      liveExecutionReady: false,
      withdrawalSupport: false,
      indodaxStatus: indo?.reachable ? "ONLINE • BRIDGE" : (indo?.checkedAt ? "FAILED" : "BRIDGE READY"),
      indodaxCheck: indo,
      compatibility: indo?.reachable ? "INDODAX_BROWSER_BRIDGE_OK" : (s.broker?.compatibility || "NOT_CHECKED"),
      transport: "BROWSER_RUN_BRIDGE",
    };
    s.safety = {
      ...(s.safety || {}),
      indodaxTransport: "BROWSER_RUN_BRIDGE",
      api403Bypass: "ACTIVE",
      strictEvidenceReset: false,
    };
    return s;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      const response = await baseWorker.fetch(request, env);
      const data = await response.json().catch(() => ({}));
      return json({
        ...data,
        version: APP_VERSION,
        indodaxTransport: "BROWSER_RUN_BRIDGE",
        indodaxBridge: "ACTIVE",
        bridgeUniverse: BRIDGE_UNIVERSE,
        engineIntervalSeconds: Number(env.ENGINE_INTERVAL_SECONDS || 900),
        strictEvidenceReset: false,
        liveExecution: "LOCKED",
      }, response.status);
    }
    return baseWorker.fetch(request, env);
  },
};
