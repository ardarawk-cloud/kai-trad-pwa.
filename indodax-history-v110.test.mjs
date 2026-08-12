import test from "node:test";
import assert from "node:assert/strict";
import { historyChunkMs, validateHistoryRange } from "./indodax-history-v110.js";

const DAY = 24 * 60 * 60 * 1000;

test("historical validation range is capped", () => {
  const from = 1_700_000_000_000;
  const ok = validateHistoryRange(from, from + 7 * DAY, 8);
  assert.equal(ok.spanMs, 7 * DAY);
  assert.throws(() => validateHistoryRange(from, from + 9 * DAY, 8), /exceeds 8 days/);
  assert.throws(() => validateHistoryRange(from, from, 8), /Invalid historical time range/);
});

test("one-minute source is chunked more tightly than 15-minute history", () => {
  assert.equal(historyChunkMs("5m"), 12 * 60 * 60 * 1000);
  assert.equal(historyChunkMs("15m"), 3 * DAY);
});
