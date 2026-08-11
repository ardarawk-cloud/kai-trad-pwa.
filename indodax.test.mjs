import test from "node:test";
import assert from "node:assert/strict";
import { findIndodaxPair, normalizeIndodaxPairSymbol } from "./indodax.js";

test("normalizeIndodaxPairSymbol normalizes separators and case", () => {
  assert.equal(normalizeIndodaxPairSymbol("btc/usdt"), "BTCUSDT");
  assert.equal(normalizeIndodaxPairSymbol(" BTC-IDR "), "BTCIDR");
  assert.equal(normalizeIndodaxPairSymbol("eth_idr"), "ETHIDR");
});

test("findIndodaxPair matches official pair symbol without guessing", () => {
  const pairs = [
    { id: "btcidr", symbol: "BTCIDR", ticker_id: "btc_idr" },
    { id: "btcusdt", symbol: "BTCUSDT", ticker_id: "btc_usdt" },
  ];
  assert.equal(findIndodaxPair(pairs, "BTC/USDT")?.id, "btcusdt");
  assert.equal(findIndodaxPair(pairs, "btc-idr")?.id, "btcidr");
});

test("findIndodaxPair returns null for unsupported pair", () => {
  const pairs = [{ id: "btcidr", symbol: "BTCIDR" }];
  assert.equal(findIndodaxPair(pairs, "SOLUSDT"), null);
});
