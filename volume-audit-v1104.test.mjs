import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeRawVolume,
  summarizeVolumeRatios,
  neutralizeVolumeBonus,
  auditVolumeCouplingForProfile,
} from "./volume-audit-v1104.js";
import { CALIBRATION_PROFILES } from "./calibration-v1102.js";

const profile70 = CALIBRATION_PROFILES[0];

function item({ mainScore, fastScore, weighted, mainRatio, fastRatio, liquidity = true } = {}) {
  return {
    analysis: {
      buyConfidence: weighted,
      main: {
        buyScore: mainScore,
        indicators: { volumeRatio: mainRatio, atrPct: 1 },
      },
      fast: {
        buyScore: fastScore,
        indicators: { volumeRatio: fastRatio, atrPct: 1 },
      },
    },
    regime: { regime: "BULLISH", longBiasScore: 90 },
    liquidity: { healthy: liquidity },
  };
}

test("summarizeRawVolume reports sparse volume accurately", () => {
  const rows = [
    { closeTime: 100, volume: 0 },
    { closeTime: 200, volume: 2 },
    { closeTime: 300, volume: 0 },
    { closeTime: 400, volume: 6 },
  ];
  const result = summarizeRawVolume(rows, 100);
  assert.equal(result.samples, 4);
  assert.equal(result.zeroCount, 2);
  assert.equal(result.zeroPct, 50);
  assert.equal(result.positivePct, 50);
});

test("summarizeVolumeRatios tracks bonus and abnormal thresholds", () => {
  const result = summarizeVolumeRatios([0, 1, 1.05, 2, 7]);
  assert.equal(result.bonusCount, 3);
  assert.equal(result.abnormalCount, 1);
  assert.equal(result.max, 7);
});

test("neutralizeVolumeBonus removes only +8 confirmation bonus per frame", () => {
  const current = item({ mainScore: 78, fastScore: 63, weighted: 74, mainRatio: 1.2, fastRatio: 0.9 });
  const neutral = neutralizeVolumeBonus(current.analysis);
  assert.equal(neutral.mainBonus, 8);
  assert.equal(neutral.fastBonus, 0);
  assert.equal(neutral.analysis.main.buyScore, 70);
  assert.equal(neutral.analysis.fast.buyScore, 63);
  assert.equal(neutral.analysis.buyConfidence, 68);
});

test("audit identifies volume-created alignment that is then blocked by liquidity", () => {
  const timeline = [
    item({ mainScore: 78, fastScore: 63, weighted: 74, mainRatio: 1.2, fastRatio: 1.2, liquidity: false }),
    item({ mainScore: 82, fastScore: 62, weighted: 76, mainRatio: 0.9, fastRatio: 0.9, liquidity: true }),
  ];
  const result = auditVolumeCouplingForProfile(timeline, profile70);
  assert.equal(result.currentAligned, 2);
  assert.equal(result.neutralAligned, 1);
  assert.equal(result.volumeCreatedAligned, 1);
  assert.equal(result.volumeCreatedBlockedLiquidity, 1);
  assert.equal(result.guardBlockedVolumeCreated, 1);
  assert.equal(result.guardBlockedPctOfVolumeCreated, 100);
});
