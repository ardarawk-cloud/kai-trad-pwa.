export const SAFETY_COST_POLICY = "HARD_BREAKER_COST_GUARD_V1";
export const VERIFIED_FRESH_QUOTE = "VERIFIED_FRESH";

const round = (n, d = 6) => Number(Number(n || 0).toFixed(d));
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function safetyCostConfig(env = {}, state = {}) {
  return {
    maxConsecutiveLosses: Math.max(1, Math.round(Number(state?.config?.maxConsecutiveLosses ?? env.MAX_CONSECUTIVE_LOSSES ?? 3))),
    cooldownMinutes: Math.max(15, Math.round(Number(state?.config?.lossStreakCooldownMinutes ?? env.LOSS_STREAK_COOLDOWN_MINUTES ?? 240))),
    feeRatePerSide: clamp(Number(env.PAPER_FEE_RATE ?? 0.001), 0, 0.01),
    maxProjectedRoundTripCostPct: clamp(Number(env.PAPER_COST_GUARD_MAX_ROUND_TRIP_PCT ?? 0.60), 0.05, 5),
    minExpectedEdgePct: clamp(Number(env.PAPER_COST_GUARD_MIN_EXPECTED_EDGE_PCT ?? 1.00), 0.10, 20),
    atrEdgeMultiple: clamp(Number(env.PAPER_COST_GUARD_ATR_EDGE_MULTIPLE ?? 6), 1, 50),
    minEdgeToCostRatio: clamp(Number(env.PAPER_COST_GUARD_MIN_EDGE_TO_COST_RATIO ?? 2.0), 1, 20),
  };
}

export function reconcileLossBreaker(state, cfg, nowMs = Date.now()) {
  state.engine ||= {};
  state.account ||= {};
  state.engine.breaker ||= { active: false, reason: null, until: null };

  const maxLosses = Math.max(1, Number(cfg.maxConsecutiveLosses || 3));
  const cooldownMinutes = Math.max(15, Number(cfg.cooldownMinutes || 240));
  const losses = Math.max(0, Number(state.account.consecutiveLosses || 0));
  const breaker = state.engine.breaker || {};
  const breakerUntilMs = Date.parse(breaker.until || state.engine.cooldownUntil || "");
  const isoNow = new Date(nowMs).toISOString();

  if (breaker.active && breaker.reason === "LOSS_STREAK") {
    if (Number.isFinite(breakerUntilMs) && nowMs >= breakerUntilMs) {
      state.account.consecutiveLosses = 0;
      state.engine.cooldownUntil = null;
      state.engine.breaker = { active: false, reason: null, until: null };
      state.engine.lossBreakerRecoveredAt = isoNow;
      return { changed: true, active: false, recovered: true, reason: "LOSS_STREAK_RECOVERED", consecutiveLosses: 0 };
    }

    let until = breaker.until || state.engine.cooldownUntil;
    if (!Number.isFinite(breakerUntilMs)) {
      until = new Date(nowMs + cooldownMinutes * 60_000).toISOString();
      state.engine.cooldownUntil = until;
      state.engine.breaker = { active: true, reason: "LOSS_STREAK", until };
      return { changed: true, active: true, recovered: false, reason: "LOSS_STREAK_BREAKER", until, consecutiveLosses: losses };
    }

    if (state.engine.cooldownUntil !== until) state.engine.cooldownUntil = until;
    return { changed: false, active: true, recovered: false, reason: "LOSS_STREAK_BREAKER", until, consecutiveLosses: losses };
  }

  if (losses >= maxLosses) {
    const existingUntilMs = Date.parse(state.engine.cooldownUntil || "");
    const until = Number.isFinite(existingUntilMs) && existingUntilMs > nowMs
      ? state.engine.cooldownUntil
      : new Date(nowMs + cooldownMinutes * 60_000).toISOString();
    state.engine.cooldownUntil = until;
    state.engine.breaker = { active: true, reason: "LOSS_STREAK", until };
    state.engine.lossBreakerTrippedAt = isoNow;
    return { changed: true, active: true, recovered: false, reason: "LOSS_STREAK_BREAKER", until, consecutiveLosses: losses };
  }

  return { changed: false, active: false, recovered: false, reason: null, consecutiveLosses: losses };
}

export function assessEntryCostGuard({ quote, analysis, config }) {
  const bid = Number(quote?.bid || 0);
  const ask = Number(quote?.ask || 0);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
  const fresh = quote?.quoteIntegrity === VERIFIED_FRESH_QUOTE;
  const liveSpread = quote?.spreadModeled === true && String(quote?.source || "").startsWith("INDODAX_LIVE_BID_ASK");
  const validBook = bid > 0 && ask > 0 && ask >= bid && mid > 0;
  const atrPct = Math.max(0, Number(analysis?.main?.indicators?.atrPct || 0));
  const expectedEdgePct = Math.max(Number(config.minExpectedEdgePct || 1), atrPct * Number(config.atrEdgeMultiple || 6));

  if (!fresh || !liveSpread || !validBook) {
    return {
      allowed: false,
      reason: "EXECUTION_COST_QUOTE_UNVERIFIED",
      projectedRoundTripCostPct: null,
      spreadPct: null,
      feeRoundTripPct: round(Number(config.feeRatePerSide || 0) * 200, 4),
      expectedEdgePct: round(expectedEdgePct, 4),
      edgeToCostRatio: null,
    };
  }

  const spreadPct = ((ask - bid) / mid) * 100;
  const feeRoundTripPct = Number(config.feeRatePerSide || 0) * 200;
  const projectedRoundTripCostPct = spreadPct + feeRoundTripPct;
  const edgeToCostRatio = projectedRoundTripCostPct > 0 ? expectedEdgePct / projectedRoundTripCostPct : Infinity;

  let reason = "EXECUTION_COST_GUARD_PASS";
  let allowed = true;
  if (projectedRoundTripCostPct > Number(config.maxProjectedRoundTripCostPct || 0.60)) {
    allowed = false;
    reason = "EXECUTION_COST_TOO_HIGH";
  } else if (edgeToCostRatio < Number(config.minEdgeToCostRatio || 2)) {
    allowed = false;
    reason = "EXECUTION_COST_EXCEEDS_EDGE_BUDGET";
  }

  return {
    allowed,
    reason,
    projectedRoundTripCostPct: round(projectedRoundTripCostPct, 4),
    spreadPct: round(spreadPct, 4),
    feeRoundTripPct: round(feeRoundTripPct, 4),
    expectedEdgePct: round(expectedEdgePct, 4),
    edgeToCostRatio: Number.isFinite(edgeToCostRatio) ? round(edgeToCostRatio, 3) : null,
    maxProjectedRoundTripCostPct: Number(config.maxProjectedRoundTripCostPct || 0.60),
    minEdgeToCostRatio: Number(config.minEdgeToCostRatio || 2),
  };
}
