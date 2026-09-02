import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalActiveLossStreak,
  historicalMaxLossStreak,
} from "./loss-streak-display-v1114.js";

test("recovered account displays active streak 0 instead of historical max", () => {
  const state = { account: { consecutiveLosses: 0, maxConsecutiveLossesSeen: 5 } };
  assert.equal(canonicalActiveLossStreak(state), 0);
  assert.equal(historicalMaxLossStreak(state), 5);
});

test("active account streak is displayed from account counter", () => {
  const state = { account: { consecutiveLosses: 2, maxConsecutiveLossesSeen: 5 } };
  assert.equal(canonicalActiveLossStreak(state), 2);
  assert.equal(historicalMaxLossStreak(state), 5);
});

test("invalid or negative active streak is normalized safely", () => {
  assert.equal(canonicalActiveLossStreak({ account: { consecutiveLosses: -3 } }), 0);
  assert.equal(canonicalActiveLossStreak({ account: { consecutiveLosses: "bad" } }), 0);
  assert.equal(canonicalActiveLossStreak({}), 0);
});
