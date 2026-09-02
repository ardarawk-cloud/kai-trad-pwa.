export const LOSS_STREAK_DISPLAY_POLICY = "ACCOUNT_ACTIVE_STREAK_V1";

export function canonicalActiveLossStreak(state) {
  const raw = Number(state?.account?.consecutiveLosses ?? 0);
  return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
}

export function historicalMaxLossStreak(state) {
  const raw = Number(state?.account?.maxConsecutiveLossesSeen ?? 0);
  return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
}
