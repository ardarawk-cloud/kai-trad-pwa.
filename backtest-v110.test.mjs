import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBacktestConfig,
  resolveHistoricalRiskExit,
  runStrategyReplay,
} from "./backtest-v110.js";

function makeCandles(count, stepMs, slope = 0.12) {
  const out = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const open = price;
    const wave = Math.sin(i / 3) * 0.22;
    const close = Math.max(1, open + slope + wave);
    const high = Math.max(open, close) + 0.35;
    const low = Math.min(open, close) - 0.30;
    const openTime = 1_700_000_000_000 + i * stepMs;
    out.push({
      openTime,
      closeTime: openTime + stepMs - 1,
      open,
      high,
      low,
      close,
      volume: 1000 + (i % 11) * 30,
    });
    price = close;
  }
  return out;
}

test("backtest config preserves locked stop and take-profit policy", () => {
  const cfg = normalizeBacktestConfig({
    riskPerTrade: 1,
    maxPositionPct: 1,
    minSignalConfidence: 10,
  });
  assert.equal(cfg.stopLossPct, 0.10);
  assert.equal(cfg.takeProfitPct, 0.30);
  assert.equal(cfg.riskPerTrade, 0.02);
  assert.equal(cfg.maxPositionPct, 0.50);
  assert.equal(cfg.minSignalConfidence, 60);
});

test("historical risk exit is conservative when stop and target are both crossed", () => {
  const position = {
    entryPrice: 100,
    stopPrice: 90,
    takeProfitPrice: 130,
    trailingStopPrice: 90,
  };
  const exit = resolveHistoricalRiskExit(position, { low: 89, high: 135 });
  assert.equal(exit.reason, "STOP_LOSS");
  assert.equal(exit.price, 90);
});

test("strategy replay returns bounded metrics and decision sample", () => {
  const main = makeCandles(220, 15 * 60_000, 0.08);
  const fast = makeCandles(660, 5 * 60_000, 0.025);
  const result = runStrategyReplay({
    symbol: "BTCUSDT",
    mainCandles: main,
    fastCandles: fast,
    startMs: main[80].openTime,
    config: { minSignalConfidence: 60 },
  });
  assert.equal(result.mode, "HISTORICAL_DETERMINISTIC_PRE_AI");
  assert.equal(result.aiValidation, "NOT_REPLAYED");
  assert.ok(result.sample.decisions > 0);
  assert.ok(Number.isFinite(result.metrics.netPnl));
  assert.ok(result.metrics.maxDrawdownPct >= 0);
  assert.ok(result.metrics.maxDrawdownPct <= 100);
  assert.ok(result.metrics.closedTrades >= 0);
});
