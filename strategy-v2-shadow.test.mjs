import test from "node:test";
import assert from "node:assert/strict";
import {
  createStrategyV2State,
  ensureStrategyV2State,
  rankStrategyV2Candidates,
  strategyV2Config,
  updateStrategyV2Shadow,
} from "./strategy-v2-shadow.js";

const cfg = strategyV2Config({
  V2_MIN_BUY_CONFIDENCE: "80",
  V2_MIN_TRADE_QUALITY: "80",
  PAPER_FEE_RATE: "0.001",
});

function candidate({
  symbol="BTCUSDT",
  price=60000,
  regime="BULLISH",
  buy=85,
  quality=85,
  action="BUY",
  exit=20,
  eligible=true,
  costAllowed=true,
  candle=1,
}={}) {
  return {
    symbol,
    marketPrice: price,
    marketQuote: {
      bid: price * 0.9995,
      ask: price * 1.0005,
      last: price,
      quoteIntegrity: "VERIFIED_FRESH",
      spreadModeled: true,
      source: "INDODAX_LIVE_BID_ASK",
    },
    analysis: {
      action,
      buyConfidence: buy,
      exitConfidence: exit,
      main: { indicators: { atrPct: 1.0 } },
    },
    regime: { regime },
    tradeQuality: quality,
    entryEligible: eligible,
    decisionCandle: candle,
    costGuard: {
      allowed: costAllowed,
      projectedRoundTripCostPct: 0.3,
      expectedEdgePct: 1.2,
      edgeToCostRatio: 4,
    },
  };
}

test("V2 only ranks strong bullish cost-aware setups eligible", () => {
  const ranked = rankStrategyV2Candidates([
    candidate({symbol:"BTCUSDT",regime:"BEARISH",buy:92,quality:92}),
    candidate({symbol:"ETHUSDT",regime:"BULLISH",buy:82,quality:84}),
  ], cfg);
  assert.equal(ranked[0].symbol, "ETHUSDT");
  assert.equal(ranked[0].v2Eligible, true);
  assert.equal(ranked[1].v2Eligible, false);
});

test("V2 opens its own shadow position and does not require V1 state", () => {
  const state = createStrategyV2State(cfg, 1000);
  updateStrategyV2Shadow(state, [candidate()], cfg, 2000);
  assert.equal(state.position?.symbol, "BTCUSDT");
  assert.equal(state.trades[0].side, "BUY");
  assert.equal(state.mode, "SHADOW_PAPER");
  assert.equal(state.liveCapable, false);
});

test("V2 rejects sideways setup even with high confidence", () => {
  const state = createStrategyV2State(cfg, 1000);
  updateStrategyV2Shadow(state, [candidate({regime:"SIDEWAYS",buy:95,quality:95})], cfg, 2000);
  assert.equal(state.position, null);
  assert.equal(state.lastDecision.reason, "V2_BULLISH_ONLY");
});

test("V2 closes on bearish regime using bid and records evidence", () => {
  const state = createStrategyV2State(cfg, 1000);
  updateStrategyV2Shadow(state, [candidate({candle:1})], cfg, 2000);
  assert.ok(state.position);
  updateStrategyV2Shadow(state, [candidate({price:61000,regime:"BEARISH",action:"HOLD",candle:2})], cfg, 3000);
  assert.equal(state.position, null);
  assert.equal(state.performance.closedTrades, 1);
  assert.equal(state.performance.evidenceClosedTrades, 1);
  assert.equal(state.trades[0].side, "SELL");
});

test("V2 state survives repeated ensure calls", () => {
  const initial = createStrategyV2State(cfg, 1000);
  initial.account.realizedPnl = 12.34;
  const same = ensureStrategyV2State(initial, cfg, 2000);
  assert.equal(same.account.realizedPnl, 12.34);
  assert.equal(same.startedAt, initial.startedAt);
});
