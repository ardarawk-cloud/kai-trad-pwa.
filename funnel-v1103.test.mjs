import test from "node:test";
import assert from "node:assert/strict";
import { buildPostAlignmentFunnel, buildProfileFunnel } from "./funnel-v1103.js";

test("profile funnel accounts for post-alignment blockers in order", () => {
  const row = buildProfileFunnel({
    id: "EXPLORATORY_55",
    label: "Exploratory 55",
    alignedSignals: 105,
    eligibleSignals: 5,
    blocked: {
      ABNORMAL_MARKET: 5,
      LIQUIDITY: 10,
      BEARISH_REGIME: 30,
      SIDEWAYS_QUALITY: 35,
      BULLISH_QUALITY: 15,
      ELIGIBLE: 10,
      COOLDOWN: 3,
      DAILY_LOSS: 2,
    },
  });

  assert.equal(row.survivors.aligned, 105);
  assert.equal(row.survivors.afterAbnormal, 100);
  assert.equal(row.survivors.afterLiquidity, 90);
  assert.equal(row.survivors.afterBearish, 60);
  assert.equal(row.survivors.afterQuality, 10);
  assert.equal(row.survivors.preRiskEligible, 10);
  assert.equal(row.survivors.afterCooldown, 7);
  assert.equal(row.survivors.afterDailyLoss, 5);
  assert.equal(row.survivors.finalEligible, 5);
  assert.equal(row.dominantBlocker.code, "SIDEWAYS_QUALITY");
  assert.equal(row.integrity.alignedAccounted, true);
  assert.equal(row.integrity.preRiskMatchesQualitySurvivors, true);
  assert.equal(row.integrity.finalMatchesRiskSurvivors, true);
});

test("lab funnel preserves one row per calibration profile", () => {
  const out = buildPostAlignmentFunnel({
    profiles: [
      { id: "LOCKED_70", alignedSignals: 2, eligibleSignals: 0, blocked: { BEARISH_REGIME: 2, ELIGIBLE: 0 } },
      { id: "BALANCED_60", alignedSignals: 7, eligibleSignals: 0, blocked: { SIDEWAYS_QUALITY: 7, ELIGIBLE: 0 } },
    ],
  });
  assert.equal(out.version, "1.10.3");
  assert.equal(out.productionChanged, false);
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].dominantBlocker.code, "BEARISH_REGIME");
  assert.equal(out.rows[1].dominantBlocker.code, "SIDEWAYS_QUALITY");
});
