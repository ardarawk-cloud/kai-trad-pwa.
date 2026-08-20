const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const round = (n, d = 8) => Number(Number(n || 0).toFixed(d));

export const PROFIT_LOCK_POLICY = "FEE_AWARE_PROFIT_LOCK_V1";

export function profitLockConfig(env = {}) {
  return {
    activationPct: clamp(Number(env.PAPER_PROFIT_LOCK_ACTIVATION_PCT || 0.02), 0.005, 0.10),
    minNetProfitPct: clamp(Number(env.PAPER_PROFIT_LOCK_MIN_NET_PCT || 0.0025), 0.0005, 0.02),
    lockShare: clamp(Number(env.PAPER_PROFIT_LOCK_SHARE || 0.50), 0.20, 0.90),
    exitSpreadBufferPct: clamp(Number(env.PAPER_PROFIT_LOCK_EXIT_SPREAD_BUFFER_PCT || 0.0005), 0, 0.02),
    minGapFromHighPct: clamp(Number(env.PAPER_PROFIT_LOCK_MIN_GAP_PCT || 0.0025), 0.001, 0.05),
  };
}

function halfSpreadPct(position) {
  const bid = Number(position?.entryBid || 0);
  const ask = Number(position?.entryAsk || 0);
  if (bid > 0 && ask >= bid && ask + bid > 0) return (ask - bid) / (ask + bid);
  const notional = Number(position?.notional || 0);
  const spreadCost = Number(position?.entrySpreadCost || 0);
  return notional > 0 ? Math.max(0, spreadCost / notional) : 0;
}

export function applyFeeAwareProfitLock(position, config = {}) {
  if (!position) return position;
  const entryPrice = Number(position.entryPrice || 0);
  const highWater = Math.max(Number(position.highWaterPrice || entryPrice), entryPrice);
  const qty = Number(position.qty || 0);
  const notional = Number(position.notional || 0);
  const cost = Number(position.cost || notional || 0);
  if (!(entryPrice > 0 && highWater > 0 && qty > 0 && notional > 0 && cost > 0)) return position;

  const cfg = {
    activationPct: clamp(Number(config.activationPct ?? 0.02), 0.005, 0.10),
    minNetProfitPct: clamp(Number(config.minNetProfitPct ?? 0.0025), 0.0005, 0.02),
    lockShare: clamp(Number(config.lockShare ?? 0.50), 0.20, 0.90),
    exitSpreadBufferPct: clamp(Number(config.exitSpreadBufferPct ?? 0.0005), 0, 0.02),
    minGapFromHighPct: clamp(Number(config.minGapFromHighPct ?? 0.0025), 0.001, 0.05),
  };

  const entryFeeRate = notional > 0
    ? clamp(Number(position.entryFee || 0) / notional, 0, 0.01)
    : 0.001;
  const entryHalfSpreadPct = halfSpreadPct(position);
  const estimatedExitHalfSpreadPct = Math.max(entryHalfSpreadPct, cfg.exitSpreadBufferPct);
  const estimatedRoundTripCostPct = entryFeeRate * 2 + entryHalfSpreadPct + estimatedExitHalfSpreadPct;
  const runupPct = highWater / entryPrice - 1;

  if (runupPct < cfg.activationPct) {
    return {
      ...position,
      riskPolicyVersion: position.riskPolicyVersion || PROFIT_LOCK_POLICY,
      profitLockActive: false,
      profitLockActivationPct: cfg.activationPct,
      profitLockEstimatedCostPct: round(estimatedRoundTripCostPct, 6),
    };
  }

  const netRunupPct = Math.max(0, runupPct - estimatedRoundTripCostPct);
  const lockedNetPct = Math.max(cfg.minNetProfitPct, netRunupPct * cfg.lockShare);
  const desiredNetUsd = notional * lockedNetPct;
  const estimatedExitFeeRate = entryFeeRate;
  const targetExitBid = (cost + desiredNetUsd) / (qty * Math.max(0.90, 1 - estimatedExitFeeRate));
  const targetMarkPrice = targetExitBid / Math.max(0.90, 1 - estimatedExitHalfSpreadPct);
  const legacyTrailing = highWater * (1 - Number(position.trailingPct || 0.10));
  const maxAllowedLock = highWater * (1 - cfg.minGapFromHighPct);
  const previousLock = Math.max(Number(position.trailingStopPrice || 0), Number(position.profitLockStopPrice || 0));
  const lockPrice = Math.min(maxAllowedLock, Math.max(previousLock, legacyTrailing, targetMarkPrice));

  return {
    ...position,
    riskPolicyVersion: position.riskPolicyVersion || PROFIT_LOCK_POLICY,
    profitLockActive: true,
    profitLockActivationPct: cfg.activationPct,
    profitLockMinNetPct: cfg.minNetProfitPct,
    profitLockShare: cfg.lockShare,
    profitLockEstimatedCostPct: round(estimatedRoundTripCostPct, 6),
    profitLockEstimatedExitHalfSpreadPct: round(estimatedExitHalfSpreadPct, 6),
    profitLockNetRunupPct: round(netRunupPct, 6),
    profitLockLockedNetPct: round(lockedNetPct, 6),
    profitLockStopPrice: round(lockPrice, 8),
    trailingStopPrice: round(Math.max(Number(position.trailingStopPrice || 0), lockPrice), 8),
    stopPrice: round(Math.max(Number(position.stopPrice || 0), lockPrice), 8),
  };
}
