import baseWorker, { TradingState as BaseTradingState } from "./worker-v1121.js";
import {
  assessEntryCostGuard,
  safetyCostConfig,
} from "./safety-cost-guard-v1113.js";
import {
  STRATEGY_V2_POLICY,
  ensureStrategyV2State,
  strategyV2Config,
  updateStrategyV2Shadow,
} from "./strategy-v2-shadow.js";

const APP_VERSION = "1.13.0";
const V2_UNIVERSE = ["BTCUSDT", "ETHUSDT"];

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

export class TradingState extends BaseTradingState {
  async state() {
    const s = await super.state();
    const cfg = strategyV2Config(this.env);
    const existed = Boolean(s.strategyV2?.policy === STRATEGY_V2_POLICY);
    s.strategyV2 = ensureStrategyV2State(s.strategyV2, cfg, Date.now());
    s.version = APP_VERSION;
    if (!existed) {
      s.strategyV2.migration = {
        createdFromVersion: "1.12.0",
        historicalV1Imported: false,
        forwardOnly: true,
      };
      await this.save(s);
    }
    return s;
  }

  // Always fetch the two-market bridge batch, even while V1 has a position.
  // This lets V2 remain independent without opening extra Browser Run sessions.
  async bridgeBatch(s, requiredSymbol = null) {
    const shadow = { ...s, position: null };
    return super.bridgeBatch(shadow, requiredSymbol);
  }

  async scanSymbol(baseUrl, s, symbol) {
    const candidate = await super.scanSymbol(baseUrl, s, symbol);
    this._v2Candidates ||= new Map();
    this._v2Candidates.set(symbol, candidate);
    return candidate;
  }

  async runCycle(manual = false) {
    this._v2Candidates = new Map();
    let s = await super.runCycle(manual);

    if (s.mode !== "paper") return s;

    const scanErrors = [];
    // When V1 holds one symbol, the base engine only evaluates that symbol.
    // The bridge batch already contains both markets, so fill the missing V2
    // candidate from the same cached payload without another browser session.
    for (const symbol of V2_UNIVERSE) {
      if (this._v2Candidates.has(symbol)) continue;
      try {
        await this.scanSymbol(null, { ...s, position: null }, symbol);
      } catch (error) {
        scanErrors.push({
          symbol,
          error: String(error?.message || error || "V2 scan failed").slice(0, 180),
        });
      }
    }

    const v2cfg = strategyV2Config(this.env);
    const costCfg = safetyCostConfig(this.env, s);
    const candidates = [...this._v2Candidates.values()].map((candidate) => ({
      ...candidate,
      costGuard: assessEntryCostGuard({
        quote: candidate.marketQuote,
        analysis: candidate.analysis,
        config: costCfg,
      }),
    }));

    s.strategyV2 = ensureStrategyV2State(s.strategyV2, v2cfg, Date.now());
    updateStrategyV2Shadow(s.strategyV2, candidates, v2cfg, Date.now());
    s.strategyV2.scan = {
      at: new Date().toISOString(),
      universe: [...V2_UNIVERSE],
      scanned: candidates.map((x) => x.symbol),
      errors: scanErrors,
      transport: "SHARED_INDODAX_BROWSER_BRIDGE_BATCH",
      extraBrowserSessions: 0,
    };
    s.strategyV2.rules = {
      bullishOnly: true,
      minBuyConfidence: v2cfg.minBuyConfidence,
      minTradeQuality: v2cfg.minTradeQuality,
      riskPerTradePct: Number((v2cfg.riskPerTrade * 100).toFixed(2)),
      maxPositionPct: Number((v2cfg.maxPositionPct * 100).toFixed(1)),
      rewardRisk: v2cfg.rewardRisk,
      costGuardRequired: true,
      liveExecution: "IMPOSSIBLE",
    };

    await this.save(s);
    return s;
  }

  async resetPaper() {
    const before = await this.state();
    const preservedV2 = before.strategyV2;
    await super.resetPaper();
    const fresh = await super.state();
    fresh.strategyV2 = preservedV2;
    fresh.engine ||= {};
    fresh.engine.v2PreservedAcrossV1ResetAt = new Date().toISOString();
    await this.save(fresh);
    return json(await this.publicState());
  }

  async publicState() {
    const s = await super.publicState();
    const cfg = strategyV2Config(this.env);
    const v2 = ensureStrategyV2State(s.strategyV2, cfg, Date.now());
    s.version = APP_VERSION;
    s.strategyV2 = {
      ...v2,
      policy: STRATEGY_V2_POLICY,
      mode: "SHADOW_PAPER",
      liveCapable: false,
      forwardOnly: true,
      evidenceGate: {
        checkpoint: 50,
        verdict: cfg.evidenceTarget,
        current: Number(v2.performance?.evidenceClosedTrades || 0),
        edgeProven: v2.performance?.sampleStatus === "V2_EDGE_PROVEN",
      },
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
      const cfg = strategyV2Config(env);
      return json({
        ...data,
        version: APP_VERSION,
        strategyV2: "ACTIVE_SHADOW_PAPER",
        strategyV2Policy: STRATEGY_V2_POLICY,
        v2Universe: V2_UNIVERSE,
        v2MinBuyConfidence: cfg.minBuyConfidence,
        v2MinTradeQuality: cfg.minTradeQuality,
        v2EvidenceTarget: cfg.evidenceTarget,
        v2LiveExecution: "IMPOSSIBLE",
        v1EvidencePreserved: true,
        liveExecution: "LOCKED",
      }, response.status);
    }
    return baseWorker.fetch(request, env);
  },
};
