import baseWorker, { TradingState as BaseTradingState } from "./worker-v1113.js";
import {
  SAFETY_COST_POLICY,
  assessEntryCostGuard,
  reconcileLossBreaker,
  safetyCostConfig,
} from "./safety-cost-guard-v1113.js";

const APP_VERSION = "1.11.3";
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function patchBlockedEntry(state, symbol, guard) {
  const at = new Date().toISOString();
  const payload = { ...guard, symbol, at, policy: SAFETY_COST_POLICY };
  state.engine ||= {};
  state.engine.lastEntryCostGuard = payload;

  if (state.signal?.symbol === symbol) {
    state.signal.action = "HOLD";
    state.signal.reason = guard.reason;
    state.signal.entryEligible = false;
    state.signal.entryCostGuard = payload;
  }

  const signalId = state.signal?.id;
  const loggedSignal = signalId ? (state.signals || []).find((x) => x?.id === signalId) : null;
  if (loggedSignal) {
    loggedSignal.action = "HOLD";
    loggedSignal.reason = guard.reason;
    loggedSignal.entryEligible = false;
    loggedSignal.entryCostGuard = payload;
  }

  const decision = (state.decisionLog || []).find((x) => x?.symbol === symbol && x?.at === state.signal?.at) || state.decisionLog?.[0];
  if (decision?.symbol === symbol) {
    decision.action = "HOLD";
    decision.reason = guard.reason;
    decision.entryEligible = false;
    decision.entryCostGuard = payload;
  }
  return payload;
}

export class TradingState extends BaseTradingState {
  async state() {
    const s = await super.state();
    const cfg = safetyCostConfig(this.env, s);
    const breaker = reconcileLossBreaker(s, cfg, Date.now());
    s.version = APP_VERSION;
    s.safetyCostPolicy = {
      version: SAFETY_COST_POLICY,
      hardLossBreaker: "ENFORCED",
      maxConsecutiveLosses: cfg.maxConsecutiveLosses,
      cooldownMinutes: cfg.cooldownMinutes,
      entryCostGuard: "ENFORCED",
      maxProjectedRoundTripCostPct: cfg.maxProjectedRoundTripCostPct,
      minExpectedEdgePct: cfg.minExpectedEdgePct,
      atrEdgeMultiple: cfg.atrEdgeMultiple,
      minEdgeToCostRatio: cfg.minEdgeToCostRatio,
      liveGate: "LOCKED",
    };
    if (breaker.changed) await this.ctx.storage.put("state", s);
    return s;
  }

  async runCycle(manual = false) {
    this._entryCostGuardBlocked = null;
    const s = await super.runCycle(manual);
    if (this._entryCostGuardBlocked && !s.position) {
      s.engine.lastAction = "HOLD";
      s.engine.lastEntryCostGuard = this._entryCostGuardBlocked;
      await this.save(s);
    }
    return s;
  }

  async executeBuy(s, analysis, marketPrice, symbol = s.signal?.symbol || s.config.symbol) {
    const cfg = safetyCostConfig(this.env, s);
    const breaker = reconcileLossBreaker(s, cfg, Date.now());
    if (breaker.active) {
      const blocked = patchBlockedEntry(s, symbol, {
        allowed: false,
        reason: "LOSS_STREAK_BREAKER",
        consecutiveLosses: Number(s.account?.consecutiveLosses || 0),
        maxConsecutiveLosses: cfg.maxConsecutiveLosses,
        cooldownUntil: s.engine?.cooldownUntil || null,
      });
      this._entryCostGuardBlocked = blocked;
      return s;
    }

    const quote = this.quoteFor(symbol, marketPrice);
    const guard = assessEntryCostGuard({ quote, analysis, config: cfg });
    const assessment = { ...guard, symbol, at: new Date().toISOString(), policy: SAFETY_COST_POLICY };
    s.engine ||= {};
    s.engine.lastEntryCostGuard = assessment;

    if (!guard.allowed) {
      const blocked = patchBlockedEntry(s, symbol, guard);
      this._entryCostGuardBlocked = blocked;
      return s;
    }

    const result = await super.executeBuy(s, analysis, marketPrice, symbol);
    if (result.position) {
      result.position.entrySafetyPolicyVersion = SAFETY_COST_POLICY;
      result.position.entryCostGuard = assessment;
      const buy = (result.trades || []).find((t) => t?.side === "BUY" && t?.orderId === result.position?.orderId);
      if (buy) {
        buy.entrySafetyPolicyVersion = SAFETY_COST_POLICY;
        buy.projectedRoundTripCostPct = guard.projectedRoundTripCostPct;
        buy.expectedEdgePct = guard.expectedEdgePct;
        buy.edgeToCostRatio = guard.edgeToCostRatio;
      }
    }
    return result;
  }

  async executeSell(s, marketPrice, reason) {
    const result = await super.executeSell(s, marketPrice, reason);
    const cfg = safetyCostConfig(this.env, result);
    reconcileLossBreaker(result, cfg, Date.now());
    return result;
  }

  async publicState() {
    const s = await super.publicState();
    const cfg = safetyCostConfig(this.env, s);
    s.version = APP_VERSION;
    s.safety = {
      ...(s.safety || {}),
      hardLossBreaker: "ENFORCED",
      lossBreakerTripped: Boolean(s.engine?.breaker?.active && s.engine?.breaker?.reason === "LOSS_STREAK"),
      entryCostGuard: "ENFORCED",
      costGuardMaxRoundTripPct: cfg.maxProjectedRoundTripCostPct,
      costGuardMinEdgeToCostRatio: cfg.minEdgeToCostRatio,
      lastEntryCostGuard: s.engine?.lastEntryCostGuard || null,
    };
    s.executionCostGuard = {
      policy: SAFETY_COST_POLICY,
      status: "ACTIVE",
      quoteRequirement: "VERIFIED_FRESH_INDODAX_BID_ASK",
      feeRatePerSidePct: Number((cfg.feeRatePerSide * 100).toFixed(4)),
      maxProjectedRoundTripCostPct: cfg.maxProjectedRoundTripCostPct,
      minExpectedEdgePct: cfg.minExpectedEdgePct,
      atrEdgeMultiple: cfg.atrEdgeMultiple,
      minEdgeToCostRatio: cfg.minEdgeToCostRatio,
      lastAssessment: s.engine?.lastEntryCostGuard || null,
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
      const cfg = safetyCostConfig(env, {});
      return json({
        ...data,
        version: APP_VERSION,
        safetyCostPolicy: SAFETY_COST_POLICY,
        hardLossBreaker: "ENFORCED",
        lossStreakCooldownMinutes: cfg.cooldownMinutes,
        preEntryCostGuard: "ACTIVE",
        maxProjectedRoundTripCostPct: cfg.maxProjectedRoundTripCostPct,
        minExpectedEdgePct: cfg.minExpectedEdgePct,
        atrEdgeMultiple: cfg.atrEdgeMultiple,
        minEdgeToCostRatio: cfg.minEdgeToCostRatio,
        strictEvidenceReset: false,
        liveExecution: "LOCKED",
      }, response.status);
    }
    return baseWorker.fetch(request, env);
  },
};
