import test from "node:test";
import assert from "node:assert/strict";
import { realizedPnlForWitaDay, witaDayFromTs } from "./daily-goal-v1112.js";

test("WITA day boundary is used for realized daily goal", () => {
  assert.equal(witaDayFromTs("2026-08-19T15:59:59.000Z"), "2026-08-19");
  assert.equal(witaDayFromTs("2026-08-19T16:00:00.000Z"), "2026-08-20");
});

test("daily goal sums only closed SELL pnl from the selected WITA day", () => {
  const trades = [
    { side: "SELL", at: "2026-08-19T17:00:00.000Z", pnl: 4.5 },
    { side: "SELL", at: "2026-08-20T02:00:00.000Z", pnl: -1.25 },
    { side: "BUY", at: "2026-08-20T03:00:00.000Z", pnl: null },
    { side: "SELL", at: "2026-08-19T15:00:00.000Z", pnl: 99 },
  ];
  assert.equal(realizedPnlForWitaDay(trades, "2026-08-20"), 3.25);
});

test("open-position unrealized pnl cannot trigger realized daily goal", () => {
  const trades = [{ side: "BUY", at: "2026-08-20T03:00:00.000Z", pnl: null }];
  assert.equal(realizedPnlForWitaDay(trades, "2026-08-20"), 0);
});
