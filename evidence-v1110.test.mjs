import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceStats, EVIDENCE_COST_MODEL, EVIDENCE_QUOTE_INTEGRITY } from "./evidence-v1110.js";

function closed(i, pnl = 1, pct = 0.1) {
  return {
    side: "SELL",
    at: new Date(2026, 0, 1, 0, i).toISOString(),
    pnl,
    entryNotional: 1000,
    evidenceEligible: true,
    costModelVersion: EVIDENCE_COST_MODEL,
    quoteIntegrity: EVIDENCE_QUOTE_INTEGRITY,
    grossPnlBeforeCosts: pnl + 2,
    tradingCostUsd: 2,
    netPnlPct: pct,
    grossPnlPct: pct + 0.2,
    tradingCostPct: 0.2,
  };
}

test("legacy fee-only trades do not count toward strict cost-modeled evidence", () => {
  const stats = buildEvidenceStats({
    trades: [
      { side: "SELL", at: new Date().toISOString(), pnl: -5.8, entryNotional: 1000 },
      closed(1, 1, 0.1),
    ],
  });
  assert.equal(stats.closedTrades, 1);
  assert.equal(stats.legacyClosedTrades, 1);
  assert.equal(stats.status, "TEST_HIGH_POTENTIAL");
  assert.equal(stats.liveGate, "LOCKED");
  assert.equal(stats.goLive, false);
});

test("bid/ask trade without fresh quote proof is excluded from strict evidence", () => {
  const unverified = { ...closed(2, 2, 0.2) };
  delete unverified.quoteIntegrity;
  const stats = buildEvidenceStats({ trades: [unverified] });
  assert.equal(stats.closedTrades, 0);
  assert.equal(stats.legacyClosedTrades, 1);
});

test("100 positive cost-modeled closed trades enter review window but never auto-unlock LIVE", () => {
  const trades = Array.from({ length: 100 }, (_, i) => closed(i, 1, 0.1));
  const stats = buildEvidenceStats({ trades, minClosed: 100, targetClosed: 200 });
  assert.equal(stats.closedTrades, 100);
  assert.equal(stats.status, "REVIEW_WINDOW");
  assert.equal(stats.positiveEdge, true);
  assert.equal(stats.goLive, false);
  assert.equal(stats.ownerApprovalRequired, true);
});

test("200 positive trades complete evidence collection only for owner review", () => {
  const trades = Array.from({ length: 200 }, (_, i) => closed(i, 1, 0.1));
  const stats = buildEvidenceStats({ trades, minClosed: 100, targetClosed: 200 });
  assert.equal(stats.closedTrades, 200);
  assert.equal(stats.status, "EVIDENCE_COMPLETE_OWNER_REVIEW");
  assert.equal(stats.progressToTargetPct, 100);
  assert.equal(stats.netExpectancyPct, 0.1);
  assert.equal(stats.avgTradingCostPct, 0.2);
});

test("negative expectancy never becomes GO candidate", () => {
  const trades = Array.from({ length: 200 }, (_, i) => closed(i, -1, -0.1));
  const stats = buildEvidenceStats({ trades, minClosed: 100, targetClosed: 200 });
  assert.equal(stats.status, "TEST_NO_POSITIVE_EDGE");
  assert.equal(stats.positiveEdge, false);
  assert.equal(stats.goLive, false);
});
