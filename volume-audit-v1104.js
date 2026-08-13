import {
  CALIBRATION_PROFILES,
  buildCalibrationTimeline,
  evaluateCalibrationGate,
} from "./calibration-v1102.js";

const round = (n, d = 2) => Number(Number(n || 0).toFixed(d));

function percentile(values, p) {
  const rows = (Array.isArray(values) ? values : [])
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!rows.length) return 0;
  const idx = Math.min(rows.length - 1, Math.max(0, Math.ceil((Number(p) / 100) * rows.length) - 1));
  return rows[idx];
}

export function summarizeRawVolume(candles = [], startMs = 0) {
  const rows = candles.filter((c) => Number(c?.closeTime || c?.openTime || 0) >= Number(startMs || 0));
  const volumes = rows.map((c) => Number(c?.volume || 0)).filter(Number.isFinite);
  const zeroCount = volumes.filter((v) => v <= 0).length;
  const positiveCount = volumes.filter((v) => v > 0).length;
  return {
    samples: rows.length,
    zeroCount,
    zeroPct: rows.length ? round((zeroCount / rows.length) * 100, 1) : 0,
    positiveCount,
    positivePct: rows.length ? round((positiveCount / rows.length) * 100, 1) : 0,
    totalVolume: round(volumes.reduce((sum, v) => sum + Math.max(0, v), 0), 8),
  };
}

export function summarizeVolumeRatios(values = []) {
  const rows = values.map(Number).filter(Number.isFinite);
  const bonusCount = rows.filter((v) => v >= 1.05).length;
  const abnormalCount = rows.filter((v) => v > 6).length;
  return {
    samples: rows.length,
    p50: round(percentile(rows, 50), 2),
    p90: round(percentile(rows, 90), 2),
    p95: round(percentile(rows, 95), 2),
    max: round(rows.length ? Math.max(...rows) : 0, 2),
    bonusCount,
    bonusPct: rows.length ? round((bonusCount / rows.length) * 100, 1) : 0,
    abnormalCount,
    abnormalPct: rows.length ? round((abnormalCount / rows.length) * 100, 1) : 0,
  };
}

function volumeBonusForRatio(ratio) {
  return Number(ratio || 0) >= 1.05 ? 8 : 0;
}

export function neutralizeVolumeBonus(analysis = {}) {
  const mainRatio = Number(analysis?.main?.indicators?.volumeRatio || 0);
  const fastRatio = Number(analysis?.fast?.indicators?.volumeRatio || 0);
  const mainBonus = volumeBonusForRatio(mainRatio);
  const fastBonus = volumeBonusForRatio(fastRatio);
  const mainScore = Math.max(0, Number(analysis?.main?.buyScore || 0) - mainBonus);
  const fastScore = Math.max(0, Number(analysis?.fast?.buyScore || 0) - fastBonus);
  const weighted = Math.max(0, Math.min(100, Math.round(mainScore * 0.7 + fastScore * 0.3)));

  return {
    analysis: {
      ...analysis,
      buyConfidence: weighted,
      main: { ...analysis.main, buyScore: mainScore },
      fast: { ...analysis.fast, buyScore: fastScore },
    },
    mainBonus,
    fastBonus,
    anyBonus: mainBonus > 0 || fastBonus > 0,
    scores: { main: mainScore, fast: fastScore, weighted },
  };
}

export function isAlignedForProfile(analysis = {}, profile = CALIBRATION_PROFILES[0]) {
  return Number(analysis?.main?.buyScore || 0) >= Number(profile.mainMin || 0) &&
    Number(analysis?.fast?.buyScore || 0) >= Number(profile.fastMin || 0) &&
    Number(analysis?.buyConfidence || 0) >= Number(profile.weightedMin || 0);
}

export function auditVolumeCouplingForProfile(timeline = [], profile = CALIBRATION_PROFILES[0]) {
  const counters = {
    currentAligned: 0,
    neutralAligned: 0,
    currentEligible: 0,
    neutralEligible: 0,
    alignedWithAnyVolumeBonus: 0,
    volumeCreatedAligned: 0,
    volumeCreatedBlockedAbnormal: 0,
    volumeCreatedBlockedLiquidity: 0,
    volumeCreatedBlockedOther: 0,
    volumeCreatedEligible: 0,
  };

  for (const item of timeline) {
    const currentAligned = isAlignedForProfile(item.analysis, profile);
    const neutral = neutralizeVolumeBonus(item.analysis);
    const neutralAligned = isAlignedForProfile(neutral.analysis, profile);
    if (currentAligned) counters.currentAligned += 1;
    if (neutralAligned) counters.neutralAligned += 1;

    const currentGate = evaluateCalibrationGate({
      analysis: item.analysis,
      regime: item.regime,
      liquidity: item.liquidity,
      profile,
    });
    const neutralGate = evaluateCalibrationGate({
      analysis: neutral.analysis,
      regime: item.regime,
      liquidity: item.liquidity,
      profile,
    });
    if (currentGate.eligible) counters.currentEligible += 1;
    if (neutralGate.eligible) counters.neutralEligible += 1;

    if (!currentAligned) continue;
    if (neutral.anyBonus) counters.alignedWithAnyVolumeBonus += 1;
    if (neutralAligned) continue;

    counters.volumeCreatedAligned += 1;
    if (currentGate.code === "ABNORMAL_MARKET") counters.volumeCreatedBlockedAbnormal += 1;
    else if (currentGate.code === "LIQUIDITY") counters.volumeCreatedBlockedLiquidity += 1;
    else if (currentGate.eligible) counters.volumeCreatedEligible += 1;
    else counters.volumeCreatedBlockedOther += 1;
  }

  const guardBlocked = counters.volumeCreatedBlockedAbnormal + counters.volumeCreatedBlockedLiquidity;
  return {
    id: profile.id,
    label: profile.label,
    ...counters,
    volumeCreatedPctOfAligned: counters.currentAligned
      ? round((counters.volumeCreatedAligned / counters.currentAligned) * 100, 1)
      : 0,
    guardBlockedVolumeCreated: guardBlocked,
    guardBlockedPctOfVolumeCreated: counters.volumeCreatedAligned
      ? round((guardBlocked / counters.volumeCreatedAligned) * 100, 1)
      : 0,
  };
}

export function runVolumeIntegrityAudit({
  mainCandles = [],
  fastCandles = [],
  startMs = 0,
  profiles = CALIBRATION_PROFILES,
} = {}) {
  const timeline = buildCalibrationTimeline({ mainCandles, fastCandles, startMs });
  const mainRatios = timeline.map((item) => Number(item.analysis?.main?.indicators?.volumeRatio || 0));
  const fastRatios = timeline.map((item) => Number(item.analysis?.fast?.indicators?.volumeRatio || 0));
  const rows = profiles.map((profile) => auditVolumeCouplingForProfile(timeline, profile));
  const totalCreated = rows.reduce((sum, row) => sum + row.volumeCreatedAligned, 0);
  const totalGuardBlocked = rows.reduce((sum, row) => sum + row.guardBlockedVolumeCreated, 0);

  return {
    version: "1.10.4",
    mode: "HISTORICAL_VOLUME_AUDIT_ONLY",
    productionChanged: false,
    rawVolume: {
      main: summarizeRawVolume(mainCandles, startMs),
      fast: summarizeRawVolume(fastCandles, startMs),
    },
    volumeRatio: {
      main: summarizeVolumeRatios(mainRatios),
      fast: summarizeVolumeRatios(fastRatios),
    },
    profiles: rows,
    summary: {
      decisions: timeline.length,
      volumeCreatedAlignedAcrossProfiles: totalCreated,
      volumeCreatedGuardBlockedAcrossProfiles: totalGuardBlocked,
      couplingObserved: totalCreated > 0,
      guardConflictObserved: totalGuardBlocked > 0,
    },
    interpretation: "Volume-neutral scoring removes only the +8 volume confirmation bonus. Abnormal and liquidity guards remain active in both paths. No production rule is changed.",
  };
}
