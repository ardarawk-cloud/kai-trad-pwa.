import test from "node:test";
import assert from "node:assert/strict";
import {
  assessLossRecoveryGate,
  closedLossRun,
  lossRecoveryConfig,
} from "./loss-recovery-v1120.js";

const loss = (at, pnl = -1) => ({ side: "SELL", at, pnl });
const win = (at, pnl = 1) => ({ side: "SELL", at, pnl });

test("closedLossRun uses immutable trade history instead of resettable account counters", () => {
  const trades = [
    loss("2026-11-23T02:51:14.745Z"),
    loss("2026-11-17T15:07:14.817Z"),
    loss("2026-11-16T04:44:54.785Z"),
    loss("2026-11-15T16:42:32.956Z"),
    win("2026-11-05T12:30:49.244Z"),
  ];
  assert.equal(closedLossRun(trades).streak, 4);
});

test("recovery gate blocks during cooldown after threshold is reached", () => {
  const cfg = lossRecoveryConfig({}, { config: { maxConsecutiveLosses: 3, lossStreakCooldownMinutes: 240 } });
  const trades = [
    loss("2026-11-28T00:00:00.000Z"),
    loss("2026-11-27T20:00:00.000Z"),
    loss("2026-11-27T16:00:00.000Z"),
  ];
  const gate = assessLossRecoveryGate({
    trades,
    config: cfg,
    nowMs: Date.parse("2026-11-28T02:00:00.000Z"),
  });
  assert.equal(gate.active, true);
  assert.equal(gate.entryBlocked, true);
  assert.equal(gate.phase, "COOLDOWN");
});

test("expired cooldown does not erase the loss run; bearish market stays blocked", () => {
  const cfg = lossRecoveryConfig({}, { config: { maxConsecutiveLosses: 3, lossStreakCooldownMinutes: 240 } });
  const trades = [
    loss("2026-11-23T02:51:14.745Z"),
    loss("2026-11-17T15:07:14.817Z"),
    loss("2026-11-16T04:44:54.785Z"),
  ];
  const gate = assessLossRecoveryGate({
    trades,
    signal: { regime: { regime: "BEARISH" }, buyConfidence: 90, tradeQuality: 90, entryEligible: true },
    config: cfg,
    nowMs: Date.parse("2026-11-28T00:00:00.000Z"),
  });
  assert.equal(gate.closedLossStreak, 3);
  assert.equal(gate.entryBlocked, true);
  assert.equal(gate.phase, "WAIT_BULLISH_PROBATION");
});

test("only strong bullish setup becomes probation-ready after cooldown", () => {
  const cfg = lossRecoveryConfig(
    { LOSS_RECOVERY_MIN_CONFIDENCE: "80", LOSS_RECOVERY_MIN_QUALITY: "80" },
    { config: { maxConsecutiveLosses: 3, lossStreakCooldownMinutes: 240 } },
  );
  const trades = [
    loss("2026-11-23T02:51:14.745Z"),
    loss("2026-11-17T15:07:14.817Z"),
    loss("2026-11-16T04:44:54.785Z"),
  ];
  const gate = assessLossRecoveryGate({
    trades,
    signal: { regime: { regime: "BULLISH" }, buyConfidence: 82, tradeQuality: 84, entryEligible: true },
    config: cfg,
    nowMs: Date.parse("2026-11-28T00:00:00.000Z"),
  });
  assert.equal(gate.allowProbation, true);
  assert.equal(gate.entryBlocked, false);
  assert.equal(gate.phase, "PROBATION_READY");
});

test("a winning close resets recovery mode naturally", () => {
  const cfg = lossRecoveryConfig({}, { config: { maxConsecutiveLosses: 3, lossStreakCooldownMinutes: 240 } });
  const trades = [
    win("2026-11-28T00:00:00.000Z", 5),
    loss("2026-11-23T02:51:14.745Z"),
    loss("2026-11-17T15:07:14.817Z"),
    loss("2026-11-16T04:44:54.785Z"),
  ];
  const gate = assessLossRecoveryGate({
    trades,
    config: cfg,
    nowMs: Date.parse("2026-11-28T01:00:00.000Z"),
  });
  assert.equal(gate.active, false);
  assert.equal(gate.closedLossStreak, 0);
  assert.equal(gate.phase, "NORMAL");
});
