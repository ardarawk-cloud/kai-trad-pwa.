export const LOSS_RECOVERY_POLICY = "LOSS_STREAK_RECOVERY_GATE_V1";

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function closedLossRun(trades = []) {
  const closed = (Array.isArray(trades) ? trades : [])
    .filter((t) => t?.side === "SELL" && Number.isFinite(Number(t.pnl)))
    .slice()
    .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));

  let streak = 0;
  for (const trade of closed) {
    if (Number(trade.pnl) < 0) streak += 1;
    else break;
  }

  const latestClosed = closed[0] || null;
  return {
    streak,
    latestClosedAt: latestClosed?.at || null,
    latestClosedPnl: latestClosed ? Number(latestClosed.pnl) : null,
  };
}

export function lossRecoveryConfig(env = {}, state = {}) {
  return {
    maxConsecutiveLosses: Math.max(1, Math.round(num(state?.config?.maxConsecutiveLosses ?? env.MAX_CONSECUTIVE_LOSSES, 3))),
    cooldownMinutes: Math.max(15, Math.round(num(state?.config?.lossStreakCooldownMinutes ?? env.LOSS_STREAK_COOLDOWN_MINUTES, 240))),
    probationMinConfidence: Math.max(70, Math.min(95, Math.round(num(env.LOSS_RECOVERY_MIN_CONFIDENCE, 80)))),
    probationMinQuality: Math.max(65, Math.min(95, Math.round(num(env.LOSS_RECOVERY_MIN_QUALITY, 80)))),
  };
}

export function assessLossRecoveryGate({
  trades = [],
  signal = null,
  config = {},
  nowMs = Date.now(),
} = {}) {
  const run = closedLossRun(trades);
  const threshold = Math.max(1, num(config.maxConsecutiveLosses, 3));
  const cooldownMinutes = Math.max(15, num(config.cooldownMinutes, 240));

  if (run.streak < threshold) {
    return {
      policy: LOSS_RECOVERY_POLICY,
      active: false,
      entryBlocked: false,
      allowProbation: false,
      phase: "NORMAL",
      closedLossStreak: run.streak,
      threshold,
      latestClosedAt: run.latestClosedAt,
      cooldownUntil: null,
      probationMinConfidence: num(config.probationMinConfidence, 80),
      probationMinQuality: num(config.probationMinQuality, 80),
    };
  }

  const latestMs = Date.parse(run.latestClosedAt || "");
  const cooldownUntilMs = Number.isFinite(latestMs) ? latestMs + cooldownMinutes * 60_000 : nowMs + cooldownMinutes * 60_000;
  const cooldownUntil = new Date(cooldownUntilMs).toISOString();

  if (nowMs < cooldownUntilMs) {
    return {
      policy: LOSS_RECOVERY_POLICY,
      active: true,
      entryBlocked: true,
      allowProbation: false,
      phase: "COOLDOWN",
      reason: "LOSS_STREAK_RECOVERY_COOLDOWN",
      closedLossStreak: run.streak,
      threshold,
      latestClosedAt: run.latestClosedAt,
      cooldownUntil,
      probationMinConfidence: num(config.probationMinConfidence, 80),
      probationMinQuality: num(config.probationMinQuality, 80),
    };
  }

  const regime = typeof signal?.regime === "string" ? signal.regime : signal?.regime?.regime;
  const buyConfidence = num(signal?.buyConfidence, 0);
  const tradeQuality = num(signal?.tradeQuality, 0);
  const entryEligible = signal?.entryEligible === true;
  const probationMinConfidence = num(config.probationMinConfidence, 80);
  const probationMinQuality = num(config.probationMinQuality, 80);
  const allowProbation =
    regime === "BULLISH" &&
    entryEligible &&
    buyConfidence >= probationMinConfidence &&
    tradeQuality >= probationMinQuality;

  return {
    policy: LOSS_RECOVERY_POLICY,
    active: true,
    entryBlocked: !allowProbation,
    allowProbation,
    phase: allowProbation ? "PROBATION_READY" : "WAIT_BULLISH_PROBATION",
    reason: allowProbation ? "LOSS_STREAK_PROBATION_READY" : "LOSS_STREAK_RECOVERY_GATE",
    closedLossStreak: run.streak,
    threshold,
    latestClosedAt: run.latestClosedAt,
    cooldownUntil,
    regime: regime || "UNKNOWN",
    buyConfidence,
    tradeQuality,
    entryEligible,
    probationMinConfidence,
    probationMinQuality,
  };
}
