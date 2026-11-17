import baseWorker, { TradingState as BaseTradingState } from "./worker-v1119.js";

const APP_VERSION = "1.11.9";
const PAPER_MIN_CONFIDENCE_FLOOR = 70;
const LEGACY_AI_REASON = "BEST_OF_5_REGIME_AI_CONFIRMED";
const NO_AI_REASON = "REGIME_SIGNAL_CONFIRMED";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

export class TradingState extends BaseTradingState {
  async state() {
    const s = await super.state();
    let changed = false;
    s.version = APP_VERSION;

    // The persisted PAPER state was still running the old 60-confidence trial
    // threshold even though production defaults are 70. Raise only the floor;
    // do not reset account, trades, decisions, evidence or breaker history.
    if (s.mode === "paper" && Number(s.config?.minSignalConfidence || 0) < PAPER_MIN_CONFIDENCE_FLOOR) {
      s.config.minSignalConfidence = PAPER_MIN_CONFIDENCE_FLOOR;
      s.engine ||= {};
      s.engine.entryThresholdPolicy = "PAPER_MIN_CONFIDENCE_70";
      s.engine.entryThresholdMigratedAt ||= new Date().toISOString();
      changed = true;
    }

    if (changed) await this.save(s);
    return s;
  }

  async executeBuy(s, analysis, marketPrice, symbol = s.signal?.symbol || s.config.symbol) {
    const result = await super.executeBuy(s, analysis, marketPrice, symbol);
    if (!result.config?.aiValidation && result.position?.orderId) {
      const buy = (result.trades || []).find(
        (t) => t?.side === "BUY" && t?.orderId === result.position?.orderId
      );
      if (buy?.reason === LEGACY_AI_REASON) buy.reason = NO_AI_REASON;
    }
    return result;
  }

  async runCycle(manual = false) {
    const s = await super.runCycle(manual);
    let changed = false;

    if (!s.config?.aiValidation && s.signal?.reason === LEGACY_AI_REASON) {
      s.signal.reason = NO_AI_REASON;
      const signal = (s.signals || []).find((x) => x?.id === s.signal?.id);
      if (signal) signal.reason = NO_AI_REASON;
      const decision = (s.decisionLog || []).find(
        (x) => x?.symbol === s.signal?.symbol && x?.at === s.signal?.at
      );
      if (decision) decision.reason = NO_AI_REASON;
      changed = true;
    }

    if (changed) await this.save(s);
    return s;
  }

  async publicState() {
    const s = await super.publicState();
    const closedLossStreak = Math.max(0, Number(s.performance?.consecutiveLosses || 0));
    const activeLossStreak = Math.max(0, Number(s.safety?.consecutiveLosses || 0));
    const entryBlocked = Boolean(s.safety?.breaker?.active || s.safety?.dailyLossBlocked);

    s.version = APP_VERSION;
    s.safety = {
      ...(s.safety || {}),
      activeLossStreak,
      closedLossStreak,
      entryBlocked,
      engineBehaviorWhileBlocked: "SCAN_CONTINUES_ENTRY_BLOCKED",
    };
    s.strategyGuard = {
      policy: "PAPER_MIN_CONFIDENCE_70",
      minSignalConfidence: Number(s.config?.minSignalConfidence || PAPER_MIN_CONFIDENCE_FLOOR),
      thresholdFloor: PAPER_MIN_CONFIDENCE_FLOOR,
      historicalStatePreserved: true,
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
        paperMinConfidenceFloor: PAPER_MIN_CONFIDENCE_FLOOR,
        safetyUiSemantics: "SCAN_CONTINUES_ENTRY_BLOCKED",
        strictEvidenceReset: false,
        liveExecution: "LOCKED",
      }, response.status);
    }
    return baseWorker.fetch(request, env);
  },
};
