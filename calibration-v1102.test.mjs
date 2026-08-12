import test from "node:test";
import assert from "node:assert/strict";
import {
  CALIBRATION_PROFILES,
  evaluateCalibrationGate,
  runCalibrationLab,
} from "./calibration-v1102.js";

function analysis({ main = 72, fast = 60, weighted = 69, atrPct = 1, volumeRatio = 1 } = {}) {
  return {
    action: "HOLD",
    buyConfidence: weighted,
    main: { buyScore: main, indicators: { atrPct, volumeRatio } },
    fast: { buyScore: fast, indicators: {} },
  };
}

const bullish = { regime: "BULLISH", longBiasScore: 90 };
const liquid = { healthy: true };

test("calibration profiles stay ordered from locked to exploratory", () => {
  assert.deepEqual(CALIBRATION_PROFILES.map((x) => x.id), [
    "LOCKED_70",
    "CONSERVATIVE_65",
    "BALANCED_60",
    "EXPLORATORY_55",
  ]);
  assert.equal(CALIBRATION_PROFILES[0].mainMin, 70);
  assert.equal(CALIBRATION_PROFILES.at(-1).mainMin, 55);
});

test("balanced profile can accept a setup rejected by locked profile", () => {
  const locked = evaluateCalibrationGate({
    analysis: analysis({ main: 64, fast: 58, weighted: 62 }),
    regime: bullish,
    liquidity: liquid,
    profile: CALIBRATION_PROFILES[0],
  });
  const balanced = evaluateCalibrationGate({
    analysis: analysis({ main: 64, fast: 58, weighted: 62 }),
    regime: bullish,
    liquidity: liquid,
    profile: CALIBRATION_PROFILES[2],
  });
  assert.equal(locked.eligible, false);
  assert.equal(locked.code, "MAIN_SCORE");
  assert.equal(balanced.eligible, true);
});

test("bearish regime and unhealthy liquidity stay blocked in exploratory profile", () => {
  const p = CALIBRATION_PROFILES.at(-1);
  const bearish = evaluateCalibrationGate({
    analysis: analysis({ main: 85, fast: 80, weighted: 82 }),
    regime: { regime: "BEARISH", longBiasScore: 15 },
    liquidity: liquid,
    profile: p,
  });
  const illiquid = evaluateCalibrationGate({
    analysis: analysis({ main: 85, fast: 80, weighted: 82 }),
    regime: bullish,
    liquidity: { healthy: false },
    profile: p,
  });
  assert.equal(bearish.code, "BEARISH_REGIME");
  assert.equal(illiquid.code, "LIQUIDITY");
});

test("empty calibration lab never changes production settings", () => {
  const out = runCalibrationLab({ mainCandles: [], fastCandles: [], startMs: 0 });
  assert.equal(out.productionChanged, false);
  assert.equal(out.productionThreshold, 70);
  assert.equal(out.profiles.length, 4);
  assert.ok(out.profiles.every((x) => x.metrics.closedTrades === 0));
});
