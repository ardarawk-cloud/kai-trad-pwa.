import test from "node:test";
import assert from "node:assert/strict";
import { classifyEntryDecision } from "./diagnostics-v1101.js";

function analysis({ main = 75, fast = 65, weighted = 72, atrPct = 1, volumeRatio = 1.1 } = {}) {
  return {
    action: "HOLD",
    buyConfidence: weighted,
    main: { buyScore: main, indicators: { atrPct, volumeRatio } },
    fast: { buyScore: fast, indicators: {} },
  };
}

const healthyLiquidity = { healthy: true };
const bullish = { regime: "BULLISH", longBiasScore: 90 };

test("diagnostics identify main score as first blocker", () => {
  const out = classifyEntryDecision({
    analysis: analysis({ main: 69, fast: 80, weighted: 75 }),
    regime: bullish,
    liquidity: healthyLiquidity,
    minSignalConfidence: 70,
  });
  assert.equal(out.code, "MAIN_SCORE");
});

test("diagnostics identify fast score after main passes", () => {
  const out = classifyEntryDecision({
    analysis: analysis({ main: 80, fast: 54, weighted: 72 }),
    regime: bullish,
    liquidity: healthyLiquidity,
    minSignalConfidence: 70,
  });
  assert.equal(out.code, "FAST_SCORE");
});

test("diagnostics identify weighted confidence after frame gates pass", () => {
  const out = classifyEntryDecision({
    analysis: analysis({ main: 70, fast: 55, weighted: 66 }),
    regime: bullish,
    liquidity: healthyLiquidity,
    minSignalConfidence: 70,
  });
  assert.equal(out.code, "WEIGHTED_CONFIDENCE");
});

test("diagnostics keep liquidity and regime blockers separate", () => {
  const liquidBlocked = classifyEntryDecision({
    analysis: analysis({ main: 85, fast: 80, weighted: 83 }),
    regime: bullish,
    liquidity: { healthy: false },
    minSignalConfidence: 70,
  });
  assert.equal(liquidBlocked.code, "LIQUIDITY");

  const regimeBlocked = classifyEntryDecision({
    analysis: analysis({ main: 85, fast: 80, weighted: 83 }),
    regime: { regime: "BEARISH", longBiasScore: 15 },
    liquidity: healthyLiquidity,
    minSignalConfidence: 70,
  });
  assert.equal(regimeBlocked.code, "BEARISH_REGIME");
});
