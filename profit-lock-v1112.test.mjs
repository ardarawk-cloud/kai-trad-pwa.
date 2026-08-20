import test from "node:test";
import assert from "node:assert/strict";
import { applyFeeAwareProfitLock, PROFIT_LOCK_POLICY } from "./profit-lock-v1112.js";

function position(overrides = {}) {
  return {
    entryPrice: 100,
    highWaterPrice: 100,
    qty: 10,
    notional: 1000,
    cost: 1001,
    entryFee: 1,
    entrySpreadCost: 2,
    entryBid: 99.6,
    entryAsk: 100,
    stopPrice: 90,
    trailingPct: 0.10,
    trailingStopPrice: 90,
    ...overrides,
  };
}

test("profit lock stays inactive before activation threshold", () => {
  const p = applyFeeAwareProfitLock(position({ highWaterPrice: 101.5 }), {
    activationPct: 0.02,
    minNetProfitPct: 0.0025,
    lockShare: 0.5,
    exitSpreadBufferPct: 0.0005,
    minGapFromHighPct: 0.0025,
  });
  assert.equal(p.profitLockActive, false);
  assert.equal(p.stopPrice, 90);
  assert.equal(p.riskPolicyVersion, PROFIT_LOCK_POLICY);
});

test("profit lock raises hard stop above entry after material run-up", () => {
  const p = applyFeeAwareProfitLock(position({ highWaterPrice: 110 }), {
    activationPct: 0.02,
    minNetProfitPct: 0.0025,
    lockShare: 0.5,
    exitSpreadBufferPct: 0.0005,
    minGapFromHighPct: 0.0025,
  });
  assert.equal(p.profitLockActive, true);
  assert.ok(p.profitLockStopPrice > 100);
  assert.ok(p.stopPrice >= p.profitLockStopPrice);
  assert.ok(p.trailingStopPrice >= p.profitLockStopPrice);
  assert.ok(p.profitLockLockedNetPct >= 0.0025);
});

test("profit lock never moves backwards", () => {
  const first = applyFeeAwareProfitLock(position({ highWaterPrice: 110 }), {});
  const second = applyFeeAwareProfitLock({ ...first, highWaterPrice: 111 }, {});
  const third = applyFeeAwareProfitLock({ ...second, highWaterPrice: 111 }, {});
  assert.ok(second.profitLockStopPrice >= first.profitLockStopPrice);
  assert.ok(third.profitLockStopPrice >= second.profitLockStopPrice);
});

test("profit lock keeps a gap below high-water mark", () => {
  const p = applyFeeAwareProfitLock(position({ highWaterPrice: 130 }), {
    lockShare: 0.9,
    minGapFromHighPct: 0.0025,
  });
  assert.ok(p.profitLockStopPrice <= 130 * (1 - 0.0025) + 1e-8);
});
