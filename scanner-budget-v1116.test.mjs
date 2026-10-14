import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SCANNER_BATCH_SIZE,
  SCANNER_SUBREQUEST_POLICY,
  selectScannerBatch,
} from "./scanner-budget-v1116.js";

test("v1.11.6 rotates a five-symbol universe in batches of two", () => {
  const symbols = ["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT"];
  const a = selectScannerBatch(symbols, 0);
  const b = selectScannerBatch(symbols, a.nextCursor);
  const c = selectScannerBatch(symbols, b.nextCursor);

  assert.equal(SCANNER_SUBREQUEST_POLICY, "ROTATING_BATCH_2_V1");
  assert.equal(DEFAULT_SCANNER_BATCH_SIZE, 2);
  assert.deepEqual(a.symbols, ["BTCUSDT","ETHUSDT"]);
  assert.deepEqual(b.symbols, ["BNBUSDT","SOLUSDT"]);
  assert.deepEqual(c.symbols, ["XRPUSDT","BTCUSDT"]);
  assert.equal(c.nextCursor, 1);
});

test("v1.11.6 de-duplicates and clamps the scanner batch", () => {
  const batch = selectScannerBatch(["btcusdt","BTCUSDT","ethusdt"], 99, 5);
  assert.deepEqual(batch.symbols.sort(), ["BTCUSDT","ETHUSDT"].sort());
  assert.equal(batch.total, 2);
});

test("v1.11.6 handles empty scanner universes safely", () => {
  assert.deepEqual(selectScannerBatch([], 4), { symbols: [], nextCursor: 0, total: 0, startCursor: 0 });
});
