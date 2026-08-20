import baseWorker, { TradingState as BaseTradingState } from "./worker-v1112.js";
import { buildEvidenceStats } from "./evidence-v1110.js";
import { applyFeeAwareProfitLock, profitLockConfig, PROFIT_LOCK_POLICY } from "./profit-lock-v1112.js";

const APP_VERSION = "1.11.2";
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function evidenceConfig(env = {}) {
  return {
    minClosed: Math.max(1, Math.round(Number(env.PAPER_EVIDENCE_MIN_CLOSED || 100))),
    targetClosed: Math.max(100, Math.round(Number(env.PAPER_EVIDENCE_TARGET_CLOSED || 200))),
    feeRatePerSide: Math.max(0, Math.min(0.01, Number(env.PAPER_FEE_RATE || 0.001))),
  };
}

function markMigratedPositionOutOfEvidence(s) {
  const p = s?.position;
  if (!p || s.mode === "live" || p.riskPolicyVersion === PROFIT_LOCK_POLICY) return;
  p.riskPolicyVersion = PROFIT_LOCK_POLICY;
  p.riskPolicyMigratedAt = new Date().toISOString();
  p.evidenceEligible = false;
  p.evidenceInvalidReason = "RISK_POLICY_MIGRATED_MID_TRADE";
  const buy = (s.trades || []).find((t) => t?.side === "BUY" && t?.orderId === p.orderId);
  if (buy) {
    buy.evidenceEligible = false;
    buy.riskPolicyVersion = PROFIT_LOCK_POLICY;
    buy.evidenceInvalidReason = "RISK_POLICY_MIGRATED_MID_TRADE";
  }
}

export class TradingState extends BaseTradingState {
  async state() {
    const s = await super.state();
    s.version = APP_VERSION;
    if (s.mode !== "live" && s.position) {
      markMigratedPositionOutOfEvidence(s);
      s.position = applyFeeAwareProfitLock(s.position, profitLockConfig(this.env));
    }
    s.riskPolicy = {
      version: PROFIT_LOCK_POLICY,
      mode: "PAPER_EVIDENCE",
      activationPct: profitLockConfig(this.env).activationPct,
      minNetProfitPct: profitLockConfig(this.env).minNetProfitPct,
      lockShare: profitLockConfig(this.env).lockShare,
      liveGate: "LOCKED",
    };
    return s;
  }

  async executeBuy(s, analysis, marketPrice, symbol = s.signal?.symbol || s.config.symbol) {
    const result = await super.executeBuy(s, analysis, marketPrice, symbol);
    if (result.mode === "live" || !result.position) return result;
    const p = result.position;
    p.riskPolicyVersion = PROFIT_LOCK_POLICY;
    p.profitLockPolicyAttachedAt = new Date().toISOString();
    p = applyFeeAwareProfitLock(p, profitLockConfig(this.env));
    result.position = p;
    const buy = (result.trades || []).find((t) => t?.side === "BUY" && t?.orderId === p.orderId);
    if (buy) buy.riskPolicyVersion = PROFIT_LOCK_POLICY;
    return result;
  }

  async executeSell(s, marketPrice, reason) {
    const p = s.position;
    const profitLockTriggered = Boolean(
      p?.profitLockActive &&
      Number(p?.profitLockStopPrice || 0) > Number(p?.entryPrice || 0) &&
      (reason === "STOP_LOSS" || reason === "TRAILING_STOP")
    );
    const exitReason = profitLockTriggered ? "FEE_AWARE_PROFIT_LOCK" : reason;
    const policy = p?.riskPolicyVersion || null;
    const result = await super.executeSell(s, marketPrice, exitReason);
    const sell = (result.trades || []).find((t) => t?.side === "SELL" && t?.symbol === p?.symbol);
    if (sell) sell.riskPolicyVersion = policy;
    return result;
  }

  async publicState() {
    const s = await super.publicState();
    const cfg = evidenceConfig(this.env);
    const policyTrades = (s.trades || []).filter((t) => t?.side !== "SELL" || t?.riskPolicyVersion === PROFIT_LOCK_POLICY);
    const evidence = buildEvidenceStats({
      trades: policyTrades,
      account: s.account || {},
      minClosed: cfg.minClosed,
      targetClosed: cfg.targetClosed,
      feeRatePerSide: cfg.feeRatePerSide,
    });
    const allClosed = (s.trades || []).filter((t) => t?.side === "SELL" && Number.isFinite(Number(t.pnl))).length;
    evidence.riskPolicyVersion = PROFIT_LOCK_POLICY;
    evidence.legacyClosedTrades = Math.max(0, allClosed - evidence.closedTrades);
    evidence.note = evidence.closedTrades < evidence.minClosedTrades
      ? `Collect ${evidence.minClosedTrades}-${evidence.targetClosedTrades} fresh-quote PAPER closed trades under ${PROFIT_LOCK_POLICY}. Older risk-policy trades remain history only.`
      : "Evidence threshold reached under the fee-aware profit-lock cohort. LIVE remains locked pending owner review.";
    s.evidence = evidence;
    s.performance = {
      ...(s.performance || {}),
      sampleStatus: evidence.status,
      evidenceClosedTrades: evidence.closedTrades,
      evidenceTargetClosedTrades: evidence.targetClosedTrades,
      netExpectancyAfterCostsPct: evidence.netExpectancyPct,
      grossExpectancyBeforeCostsPct: evidence.grossExpectancyPct,
      avgTradingCostPct: evidence.avgTradingCostPct,
      riskPolicyVersion: PROFIT_LOCK_POLICY,
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
      const cfg = profitLockConfig(env);
      return json({
        ...data,
        version: APP_VERSION,
        feeAwareProfitLock: "ACTIVE",
        riskPolicyVersion: PROFIT_LOCK_POLICY,
        activationPct: cfg.activationPct,
        minNetProfitPct: cfg.minNetProfitPct,
        lockShare: cfg.lockShare,
        currentPositionMigration: "PROTECT_BUT_EXCLUDE_FROM_STRICT_EVIDENCE",
        liveExecution: "LOCKED",
      }, response.status);
    }
    return baseWorker.fetch(request, env);
  },
};
