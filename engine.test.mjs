import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeFrame,
  analyzeMultiTimeframe,
  computeTradePlan,
  computeTradeQuality,
  computePerformanceStats,
  detectMarketRegime,
  evaluateRiskExit,
  isRegimeEntryEligible,
  rankScanCandidates,
  safeConfig,
  updateTrailingStop,
  validateExecutionRules,
} from './engine.js';

function candles(count = 120, slope = 1.2) {
  const out = [];
  let p = 100;
  for (let i = 0; i < count; i++) {
    const open = p;
    const wave = Math.sin(i / 4) * 0.25;
    const close = open + slope + wave;
    const high = Math.max(open, close) + 0.6;
    const low = Math.min(open, close) - 0.5;
    out.push({ openTime: i * 60000, open, high, low, close, volume: 1000 + i * 4, closeTime: (i + 1) * 60000 });
    p = close;
  }
  return out;
}

test('analysis returns bounded scores and indicators', () => {
  const result = analyzeFrame(candles());
  assert.ok(result.buyScore >= 0 && result.buyScore <= 100);
  assert.ok(result.exitScore >= 0 && result.exitScore <= 100);
  assert.ok(Number.isFinite(result.indicators.rsi));
  assert.ok(Number.isFinite(result.indicators.atrPct));
});

test('multi timeframe returns valid action and confidence', () => {
  const result = analyzeMultiTimeframe(candles(140, 1.1), candles(140, 0.8), 60);
  assert.ok(['BUY', 'SELL', 'HOLD'].includes(result.action));
  assert.ok(result.confidence >= 0 && result.confidence <= 100);
});

test('trade plan respects max position cap', () => {
  const plan = computeTradePlan({ equity: 10000, cash: 10000, price: 100, atrPct: 1.0, riskPerTrade: 0.01, maxPositionPct: 0.2 });
  assert.ok(plan.notional <= 2000);
  assert.equal(plan.stopPct, 0.10);
  assert.equal(plan.takeProfitPct, 0.30);
  assert.equal(plan.stopPrice, 90);
  assert.equal(plan.takeProfitPrice, 130);
});

test('trailing stop ratchets upward only', () => {
  const pos = { entryPrice: 100, highWaterPrice: 100, trailingPct: 0.02, trailingStopPrice: 98, stopPrice: 95, takeProfitPrice: 120 };
  const up = updateTrailingStop(pos, 110);
  const down = updateTrailingStop(up, 105);
  assert.ok(up.trailingStopPrice > 98);
  assert.equal(down.trailingStopPrice, up.trailingStopPrice);
});

test('risk exit detects hard stop', () => {
  const pos = { entryPrice: 100, stopPrice: 90, trailingStopPrice: 90, takeProfitPrice: 130 };
  assert.equal(evaluateRiskExit(pos, 89).reason, 'STOP_LOSS');
});

test('risk exit detects locked 30 percent take profit', () => {
  const pos = { entryPrice: 100, stopPrice: 90, trailingStopPrice: 90, takeProfitPrice: 130 };
  assert.equal(evaluateRiskExit(pos, 130).reason, 'TAKE_PROFIT');
});

test('safe config clamps risky inputs', () => {
  const current = { symbol: 'BTCUSDT', interval: '15m', fastInterval: '5m', riskPerTrade: .01, maxPositionPct: .2, maxDailyLossPct: .03, minSignalConfidence: 70, aiValidation: true };
  const next = safeConfig({ riskPerTrade: 1, maxPositionPct: 1, maxDailyLossPct: .5, minSignalConfidence: 20 }, current);
  assert.equal(next.riskPerTrade, .02);
  assert.equal(next.maxPositionPct, .5);
  assert.equal(next.maxDailyLossPct, .08);
  assert.equal(next.minSignalConfidence, 60);
});


test('multi-coin ranking prioritizes qualified BUY then strongest buy confidence', () => {
  const ranked = rankScanCandidates([
    { symbol: 'BTCUSDT', analysis: { action: 'HOLD', buyConfidence: 88, confidence: 88 } },
    { symbol: 'ETHUSDT', analysis: { action: 'BUY', buyConfidence: 72, confidence: 72 } },
    { symbol: 'SOLUSDT', analysis: { action: 'BUY', buyConfidence: 81, confidence: 81 } },
  ]);
  assert.equal(ranked[0].symbol, 'SOLUSDT');
  assert.equal(ranked[1].symbol, 'ETHUSDT');
  assert.equal(ranked[2].symbol, 'BTCUSDT');
});


test('regime detector identifies a strong bullish trend', () => {
  const regime = detectMarketRegime(candles(140, 1.1));
  assert.equal(regime.regime, 'BULLISH');
  assert.ok(regime.trendStrength >= 60);
});

test('regime detector identifies a strong bearish trend', () => {
  const regime = detectMarketRegime(candles(140, -0.3));
  assert.equal(regime.regime, 'BEARISH');
  assert.ok(regime.trendStrength >= 60);
});

test('bearish regime blocks long entry even if deterministic signal says BUY', () => {
  const analysis = analyzeMultiTimeframe(candles(140, 1.1), candles(140, 0.8), 60);
  const bearish = { regime: 'BEARISH', longBiasScore: 15 };
  assert.equal(isRegimeEntryEligible({ ...analysis, action: 'BUY', buyConfidence: 90 }, bearish, 70), false);
  assert.ok(computeTradeQuality(analysis, bearish) >= 0 && computeTradeQuality(analysis, bearish) <= 100);
});


test('performance stats calculates win rate, profit factor and loss streak', () => {
  const stats = computePerformanceStats([
    { side: 'SELL', at: '2026-08-11T00:00:00Z', pnl: 5, fee: .2, holdingMinutes: 20 },
    { side: 'SELL', at: '2026-08-11T01:00:00Z', pnl: -2, fee: .2, holdingMinutes: 30 },
    { side: 'SELL', at: '2026-08-11T02:00:00Z', pnl: -1, fee: .2, holdingMinutes: 40 },
  ]);
  assert.equal(stats.closedTrades, 3);
  assert.equal(stats.wins, 1);
  assert.equal(stats.losses, 2);
  assert.equal(stats.consecutiveLosses, 2);
  assert.ok(stats.profitFactor > 1);
  assert.equal(stats.avgHoldMinutes, 30);
});

test('execution guard enforces notional and quantity bounds', () => {
  const blocked = validateExecutionRules({ notional: 4, quantity: .0001, price: 100, rules: { minNotional: 5, minQty: .001 } });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.errors.includes('MIN_NOTIONAL'));
  assert.ok(blocked.errors.includes('MIN_QTY'));
  const ok = validateExecutionRules({ notional: 20, quantity: .01, price: 100, rules: { minNotional: 5, minQty: .001, maxQty: 10 } });
  assert.equal(ok.ok, true);
});

import { toTokocryptoSymbol, toMarketSymbol, parseTokocryptoSymbolRules, parseTokocryptoFill } from './tokocrypto.js';

test('tokocrypto symbol mapping preserves broker and market formats', () => {
  assert.equal(toTokocryptoSymbol('BTCUSDT'), 'BTC_USDT');
  assert.equal(toTokocryptoSymbol('TKO_IDR'), 'TKO_IDR');
  assert.equal(toMarketSymbol('BTC_USDT'), 'BTCUSDT');
});

test('tokocrypto rules parser uses LOT_SIZE when MARKET_LOT_SIZE step is zero', () => {
  const rules = parseTokocryptoSymbolRules({
    symbol: 'BTC_USDT', baseAsset: 'BTC', quoteAsset: 'USDT', spotTradingEnable: 1,
    orderTypes: ['LIMIT', 'MARKET'],
    filters: [
      { filterType: 'LOT_SIZE', minQty: '0.0001', maxQty: '10', stepSize: '0.0001' },
      { filterType: 'MARKET_LOT_SIZE', minQty: '0', maxQty: '0', stepSize: '0' },
      { filterType: 'NOTIONAL', minNotional: '5', applyToMarket: true },
    ],
  });
  assert.equal(rules.status, 'TRADING');
  assert.equal(rules.marketOrderAllowed, true);
  assert.equal(rules.stepSize, 0.0001);
  assert.equal(rules.minNotional, 5);
});

test('tokocrypto fill parser calculates weighted price from executed amounts', () => {
  const fill = parseTokocryptoFill({ data: { orderId: 7, status: 2, executedQty: '0.002', executedQuoteQty: '200' } }, 99999);
  assert.equal(fill.executedQty, 0.002);
  assert.equal(fill.quoteQty, 200);
  assert.equal(fill.price, 100000);
  assert.equal(fill.status, 2);
});
