const round = (n, d = 1) => Number(Number(n || 0).toFixed(d));

const POST_ALIGNMENT_CODES = [
  "ABNORMAL_MARKET",
  "LIQUIDITY",
  "BEARISH_REGIME",
  "SIDEWAYS_QUALITY",
  "BULLISH_QUALITY",
];

function pct(count, total) {
  return total > 0 ? round((Number(count || 0) / Number(total)) * 100, 1) : 0;
}

function nonNegative(n) {
  return Math.max(0, Number(n || 0));
}

export function buildProfileFunnel(profile = {}) {
  const blocked = profile.blocked || {};
  const aligned = nonNegative(profile.alignedSignals);
  const abnormalBlocked = nonNegative(blocked.ABNORMAL_MARKET);
  const liquidityBlocked = nonNegative(blocked.LIQUIDITY);
  const bearishBlocked = nonNegative(blocked.BEARISH_REGIME);
  const sidewaysQualityBlocked = nonNegative(blocked.SIDEWAYS_QUALITY);
  const bullishQualityBlocked = nonNegative(blocked.BULLISH_QUALITY);
  const cooldownBlocked = nonNegative(blocked.COOLDOWN);
  const dailyLossBlocked = nonNegative(blocked.DAILY_LOSS);

  const afterAbnormal = nonNegative(aligned - abnormalBlocked);
  const afterLiquidity = nonNegative(afterAbnormal - liquidityBlocked);
  const afterBearish = nonNegative(afterLiquidity - bearishBlocked);
  const afterQuality = nonNegative(afterBearish - sidewaysQualityBlocked - bullishQualityBlocked);
  const preRiskEligible = Number.isFinite(Number(blocked.ELIGIBLE))
    ? nonNegative(blocked.ELIGIBLE)
    : afterQuality;
  const afterCooldown = nonNegative(preRiskEligible - cooldownBlocked);
  const afterDailyLoss = nonNegative(afterCooldown - dailyLossBlocked);
  const finalEligible = nonNegative(profile.eligibleSignals);

  const postBlockers = [
    ["ABNORMAL_MARKET", abnormalBlocked],
    ["LIQUIDITY", liquidityBlocked],
    ["BEARISH_REGIME", bearishBlocked],
    ["SIDEWAYS_QUALITY", sidewaysQualityBlocked],
    ["BULLISH_QUALITY", bullishQualityBlocked],
    ["COOLDOWN", cooldownBlocked],
    ["DAILY_LOSS", dailyLossBlocked],
  ].map(([code, count]) => ({ code, count, pct: pct(count, aligned) }))
    .sort((a, b) => b.count - a.count);

  const dominant = postBlockers[0] || { code: "NONE", count: 0, pct: 0 };
  const accountedBeforeRisk = POST_ALIGNMENT_CODES.reduce((sum, code) => sum + nonNegative(blocked[code]), 0) + preRiskEligible;

  return {
    id: profile.id || "UNKNOWN",
    label: profile.label || profile.id || "Unknown",
    aligned,
    blockers: {
      abnormalMarket: abnormalBlocked,
      liquidity: liquidityBlocked,
      bearishRegime: bearishBlocked,
      sidewaysQuality: sidewaysQualityBlocked,
      bullishQuality: bullishQualityBlocked,
      cooldown: cooldownBlocked,
      dailyLoss: dailyLossBlocked,
    },
    survivors: {
      aligned,
      afterAbnormal,
      afterLiquidity,
      afterBearish,
      afterQuality,
      preRiskEligible,
      afterCooldown,
      afterDailyLoss,
      finalEligible,
    },
    dominantBlocker: dominant,
    integrity: {
      alignedAccounted: accountedBeforeRisk === aligned,
      preRiskMatchesQualitySurvivors: preRiskEligible === afterQuality,
      finalMatchesRiskSurvivors: finalEligible === afterDailyLoss,
    },
  };
}

export function buildPostAlignmentFunnel(calibration = {}) {
  const profiles = Array.isArray(calibration?.profiles) ? calibration.profiles : [];
  const rows = profiles.map(buildProfileFunnel);
  return {
    version: "1.10.3",
    mode: "POST_ALIGNMENT_FUNNEL_DIAGNOSTICS",
    productionChanged: false,
    rows,
    interpretation: "Counts show where aligned historical entry candidates are first rejected after score alignment. Production strategy is unchanged.",
  };
}
