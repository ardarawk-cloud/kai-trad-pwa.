import baseWorker, { TradingState as BaseTradingState } from "./worker-v1120.js";
import {
  LOSS_RECOVERY_POLICY,
  assessLossRecoveryGate,
  lossRecoveryConfig,
} from "./loss-recovery-v1120.js";

const APP_VERSION = "1.12.0";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function patchRecoveryBlockedEntry(state, symbol, gate) {
  const reason = gate.phase === "COOLDOWN"
    ? "LOSS_STREAK_RECOVERY_COOLDOWN"
    : "LOSS_STREAK_RECOVERY_GATE";
  const payload = {
    allowed: false,
    reason,
    policy: LOSS_RECOVERY_POLICY,
    phase: gate.phase,
    closedLossStreak: gate.closedLossStreak,
    threshold: gate.threshold,
    cooldownUntil: gate.cooldownUntil,
    probationMinConfidence: gate.probationMinConfidence,
    probationMinQuality: gate.probationMinQuality,
    at: new Date().toISOString(),
    symbol,
  };

  state.engine ||= {};
  state.engine.lastRecoveryGate = payload;

  if (state.signal?.symbol === symbol) {
    state.signal.action = "HOLD";
    state.signal.reason = reason;
    state.signal.entryEligible = false;
    state.signal.recoveryGate = payload;
  }

  const signalId = state.signal?.id;
  const loggedSignal = signalId ? (state.signals || []).find((x) => x?.id === signalId) : null;
  if (loggedSignal) {
    loggedSignal.action = "HOLD";
    loggedSignal.reason = reason;
    loggedSignal.entryEligible = false;
    loggedSignal.recoveryGate = payload;
  }

  const decision = (state.decisionLog || []).find(
    (x) => x?.symbol === symbol && x?.at === state.signal?.at
  ) || state.decisionLog?.[0];
  if (decision?.symbol === symbol) {
    decision.action = "HOLD";
    decision.reason = reason;
    decision.entryEligible = false;
    decision.recoveryGate = payload;
  }

  return payload;
}

export class TradingState extends BaseTradingState {
  recoveryGate(s, nowMs = Date.now()) {
    return assessLossRecoveryGate({
      trades: s?.trades || [],
      signal: s?.signal || null,
      config: lossRecoveryConfig(this.env, s),
      nowMs,
    });
  }

  async executeBuy(s, analysis, marketPrice, symbol = s.signal?.symbol || s.config.symbol) {
    if (s.mode === "paper") {
      const gate = this.recoveryGate(s);
      if (gate.active && !gate.allowProbation) {
        patchRecoveryBlockedEntry(s, symbol, gate);
        return s;
      }

      if (gate.active && gate.allowProbation) {
        s.engine ||= {};
        s.engine.lastRecoveryGate = {
          ...gate,
          policy: LOSS_RECOVERY_POLICY,
          decision: "PROBATION_ENTRY_ALLOWED",
          at: new Date().toISOString(),
          symbol,
        };
      }
    }

    const result = await super.executeBuy(s, analysis, marketPrice, symbol);

    if (s.mode === "paper" && result.position) {
      const gate = this.recoveryGate(result);
      if (gate.active) {
        result.position.recoveryProbe = true;
        result.position.recoveryPolicy = LOSS_RECOVERY_POLICY;
        const buy = (result.trades || []).find(
          (t) => t?.side === "BUY" && t?.orderId === result.position?.orderId
        );
        if (buy) {
          buy.recoveryProbe = true;
          buy.recoveryPolicy = LOSS_RECOVERY_POLICY;
        }
      }
    }

    return result;
  }

  async publicState() {
    const s = await super.publicState();
    const gate = this.recoveryGate(s);
    const legacyBlocked = Boolean(s.safety?.breaker?.active || s.safety?.dailyLossBlocked);
    const entryBlocked = legacyBlocked || gate.entryBlocked;

    s.version = APP_VERSION;
    s.safety = {
      ...(s.safety || {}),
      closedLossStreak: gate.closedLossStreak,
      entryBlocked,
      recoveryGate: gate,
      recoveryPolicy: LOSS_RECOVERY_POLICY,
      engineBehaviorWhileBlocked: "SCAN_CONTINUES_RECOVERY_GATE",
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
        lossRecoveryPolicy: LOSS_RECOVERY_POLICY,
        recoveryMinConfidence: Number(env.LOSS_RECOVERY_MIN_CONFIDENCE || 80),
        recoveryMinQuality: Number(env.LOSS_RECOVERY_MIN_QUALITY || 80),
        strictEvidenceReset: false,
        liveExecution: "LOCKED",
      }, response.status);
    }
    return baseWorker.fetch(request, env);
  },
};
