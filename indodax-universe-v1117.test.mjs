import test from "node:test";
import assert from "node:assert/strict";
import { filterSupportedIndodaxSymbols } from "./indodax.js";

const pairs = [
  { symbol: "btcusdt", id: "btc_usdt" },
  { symbol: "ethusdt", id: "eth_usdt" },
  { symbol: "xrpusdt", id: "xrp_usdt" },
  { symbol: "bnbidr", id: "bnb_idr" },
];

test("v1.11.7 keeps only exact configured Indodax market symbols", () => {
  const result = filterSupportedIndodaxSymbols(pairs, ["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT"]);
  assert.deepEqual(result.supported, ["BTCUSDT","ETHUSDT","XRPUSDT"]);
  assert.deepEqual(result.unsupported, ["BNBUSDT","SOLUSDT"]);
});

test("v1.11.7 does not silently map USDT requests to IDR pairs", () => {
  const result = filterSupportedIndodaxSymbols([{ symbol: "bnbidr", id: "bnb_idr" }], ["BNBUSDT"]);
  assert.deepEqual(result.supported, []);
  assert.deepEqual(result.unsupported, ["BNBUSDT"]);
});
