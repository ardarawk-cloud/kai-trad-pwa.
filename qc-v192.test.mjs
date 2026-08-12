import test from "node:test";
import assert from "node:assert/strict";
import {
  assessLiquidity,
  assessMultiTimeframeLiquidity,
  shouldDeduplicateWait,
} from "./qc-v192.js";

function volumes(values) {
  return values.map((volume, i) => ({
    openTime: i * 60_000,
    closeTime: (i + 1) * 60_000 - 1,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume,
  }));
}

test("liquidity guard tolerates occasional zero-volume candles", () => {
  const rows = volumes([100, 0, 110, 120, 90, 80, 0, 75, 130, 100, 95, 105, 0, 100, 120, 90, 110, 80, 100, 95]);
  const result = assessLiquidity(rows);
  assert.equal(result.healthy, true);
  assert.equal(result.activePct, 85);
});

test("liquidity guard blocks sparse volume history", () => {
  const rows = volumes([0, 0, 100, 0, 0, 0, 90, 0, 0, 0, 0, 80, 0, 0, 0, 0, 70, 0, 0, 0]);
  const result = assessLiquidity(rows);
  assert.equal(result.healthy, false);
  assert.ok(result.activePct < 60);
});

test("multi-timeframe liquidity requires both frames healthy", () => {
  const healthy = volumes(Array(20).fill(100));
  const sparse = volumes(Array(20).fill(0).map((v, i) => i % 4 === 0 ? 100 : v));
  assert.equal(assessMultiTimeframeLiquidity(healthy, healthy).healthy, true);
  assert.equal(assessMultiTimeframeLiquidity(healthy, sparse).healthy, false);
});

test("closed-candle wait is deduplicated only for the same candle", () => {
  assert.equal(shouldDeduplicateWait({ previousDecisionCandle: 1000, currentDecisionCandle: 1000, reason: "WAIT_NEXT_CLOSED_CANDLE" }), true);
  assert.equal(shouldDeduplicateWait({ previousDecisionCandle: 1000, currentDecisionCandle: 2000, reason: "WAIT_NEXT_CLOSED_CANDLE" }), false);
  assert.equal(shouldDeduplicateWait({ previousDecisionCandle: 1000, currentDecisionCandle: 1000, reason: "REGIME_FILTER_BEARISH" }), false);
});
