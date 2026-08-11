import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateIndodaxCandles,
  findIndodaxPair,
  getIndodaxTimeframeSpec,
  normalizeIndodaxHistoryRows,
  normalizeIndodaxPairSymbol,
} from "./indodax.js";

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

test("5m timeframe is built from official 1m history", () => {
  const spec = getIndodaxTimeframeSpec("5m");
  assert.equal(spec.tf, "1");
  assert.equal(spec.aggregate, 5);
  assert.equal(spec.candleMs, 300_000);
});

test("official direct timeframes map without aggregation", () => {
  assert.deepEqual(
    { tf: getIndodaxTimeframeSpec("15m").tf, aggregate: getIndodaxTimeframeSpec("15m").aggregate },
    { tf: "15", aggregate: 1 },
  );
  assert.equal(getIndodaxTimeframeSpec("1h").tf, "60");
  assert.equal(getIndodaxTimeframeSpec("4h").tf, "240");
});

test("normalizeIndodaxHistoryRows converts official OHLC shape", () => {
  const rows = [{ Time: 1_700_000_000, Open: 100, High: 110, Low: 95, Close: 105, Volume: "12.5" }];
  const candles = normalizeIndodaxHistoryRows(rows, 60_000);
  assert.equal(candles.length, 1);
  assert.equal(candles[0].openTime, 1_700_000_000_000);
  assert.equal(candles[0].closeTime, 1_700_000_059_999);
  assert.equal(candles[0].volume, 12.5);
});

test("aggregateIndodaxCandles builds one complete 5m candle and drops incomplete buckets", () => {
  const rows = [
    { openTime: 0, open: 100, high: 102, low: 99, close: 101, volume: 1, closeTime: 59_999 },
    { openTime: 60_000, open: 101, high: 104, low: 100, close: 103, volume: 2, closeTime: 119_999 },
    { openTime: 120_000, open: 103, high: 106, low: 102, close: 105, volume: 3, closeTime: 179_999 },
    { openTime: 180_000, open: 105, high: 108, low: 104, close: 107, volume: 4, closeTime: 239_999 },
    { openTime: 240_000, open: 107, high: 109, low: 106, close: 108, volume: 5, closeTime: 299_999 },
    { openTime: 300_000, open: 108, high: 110, low: 107, close: 109, volume: 6, closeTime: 359_999 },
  ];
  const candles = aggregateIndodaxCandles(rows, 300_000, 5);
  assert.equal(candles.length, 1);
  assert.deepEqual(candles[0], {
    openTime: 0,
    open: 100,
    high: 109,
    low: 99,
    close: 108,
    volume: 15,
    closeTime: 299_999,
  });
});

test("unsupported timeframe fails closed", () => {
  assert.throws(() => getIndodaxTimeframeSpec("2m"), /Unsupported Indodax timeframe/);
});
