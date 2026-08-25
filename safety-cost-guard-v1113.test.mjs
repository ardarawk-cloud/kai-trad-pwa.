import test from "node:test";
import assert from "node:assert/strict";
import {
  assessEntryCostGuard,
  reconcileLossBreaker,
  safetyCostConfig,
} from "./safety-cost-guard-v1113.js";

function state(losses = 0) {
  return {
    config: { maxConsecutiveLosses: 3, lossStreakCooldownMinutes: 240 },
    account: { consecutiveLosses: losses },
    engine: { cooldownUntil: null, breaker: { active: false, reason: null, until: null } },
  };
}

const cfg = safetyCostConfig({ PAPER_FEE_RATE: "0.001" }, state());

test("persisted 5/3 state is immediately hard-tripped", () => {
  const s = state(5);
  const now = Date.parse("2026-08-26T00:00:00Z");
  const out = reconcileLossBreaker(s, cfg, now);
  assert.equal(out.active, true);
  assert.equal(s.engine.breaker.active, true);
  assert.equal(s.engine.breaker.reason, "LOSS_STREAK");
  assert.equal(s.engine.cooldownUntil, "2026-08-26T04:00:00.000Z");
  assert.equal(s.account.consecutiveLosses, 5);
});

test("expired loss breaker recovers and resets streak for a new cycle", () => {
  const s = state(3);
  s.engine.cooldownUntil = "2026-08-26T03:00:00.000Z";
  s.engine.breaker = { active: true, reason: "LOSS_STREAK", until: s.engine.cooldownUntil };
  const out = reconcileLossBreaker(s, cfg, Date.parse("2026-08-26T04:00:00Z"));
  assert.equal(out.recovered, true);
  assert.equal(s.account.consecutiveLosses, 0);
  assert.equal(s.engine.cooldownUntil, null);
  assert.equal(s.engine.breaker.active, false);
});

test("losses below threshold remain armed", () => {
  const s = state(2);
  const out = reconcileLossBreaker(s, cfg, Date.parse("2026-08-26T00:00:00Z"));
  assert.equal(out.active, false);
  assert.equal(out.changed, false);
  assert.equal(s.engine.breaker.active, false);
});

test("cost guard blocks expensive 0.75% spread plus fees", () => {
  const out = assessEntryCostGuard({
    quote: {
      bid: 99.625,
      ask: 100.375,
      spreadModeled: true,
      source: "INDODAX_LIVE_BID_ASK",
      quoteIntegrity: "VERIFIED_FRESH",
    },
    analysis: { main: { indicators: { atrPct: 0.10 } } },
    config: cfg,
  });
  assert.equal(out.allowed, false);
  assert.equal(out.reason, "EXECUTION_COST_TOO_HIGH");
  assert.equal(out.projectedRoundTripCostPct, 0.95);
});

test("cost guard allows low-cost quote with at least 2x expected edge", () => {
  const out = assessEntryCostGuard({
    quote: {
      bid: 99.9,
      ask: 100.1,
      spreadModeled: true,
      source: "INDODAX_LIVE_BID_ASK",
      quoteIntegrity: "VERIFIED_FRESH",
    },
    analysis: { main: { indicators: { atrPct: 0.10 } } },
    config: cfg,
  });
  assert.equal(out.allowed, true);
  assert.equal(out.reason, "EXECUTION_COST_GUARD_PASS");
  assert.equal(out.projectedRoundTripCostPct, 0.4);
  assert.ok(out.edgeToCostRatio >= 2);
});

test("cost guard fails closed when quote integrity cannot be verified", () => {
  const out = assessEntryCostGuard({
    quote: { bid: 99.9, ask: 100.1, spreadModeled: true, source: "INDODAX_LIVE_BID_ASK", quoteIntegrity: "UNVERIFIED" },
    analysis: { main: { indicators: { atrPct: 0.4 } } },
    config: cfg,
  });
  assert.equal(out.allowed, false);
  assert.equal(out.reason, "EXECUTION_COST_QUOTE_UNVERIFIED");
});
