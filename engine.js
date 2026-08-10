const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const round = (n, d = 8) => Number(Number(n).toFixed(d));

export function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function emaSeries(values, period) {
  if (!Array.isArray(values) || values.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < period - 1; i++) out.push(null);
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function ema(values, period) {
  const series = emaSeries(values, period);
  return series.length ? series.at(-1) : null;
}

export function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const gain = Math.max(0, d);
    const loss = Math.max(0, -d);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(values, fast = 12, slow = 26, signal = 9) {
  if (!Array.isArray(values) || values.length < slow + signal) return null;
  const fastSeries = emaSeries(values, fast);
  const slowSeries = emaSeries(values, slow);
  const macdSeries = values.map((_, i) => {
    const f = fastSeries[i];
    const s = slowSeries[i];
    return f == null || s == null ? null : f - s;
  });
  const valid = macdSeries.filter((v) => v != null);
  const sigSeries = emaSeries(valid, signal);
  const macdValue = valid.at(-1);
  const signalValue = sigSeries.at(-1);
  if (macdValue == null || signalValue == null) return null;
  return {
    macd: macdValue,
    signal: signalValue,
    histogram: macdValue - signalValue,
  };
}

export function atr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length <= period) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  let value = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    value = (value * (period - 1) + trs[i]) / period;
  }
  return value;
}

function higherHigh(candles, lookback = 8) {
  if (candles.length < lookback + 2) return false;
  const recent = candles.slice(-lookback);
  const prior = candles.slice(-(lookback * 2), -lookback);
  if (!prior.length) return false;
  return Math.max(...recent.map((c) => c.high)) > Math.max(...prior.map((c) => c.high));
}

export function analyzeFrame(candles) {
  if (!Array.isArray(candles) || candles.length < 60) {
    throw new Error("At least 60 candles are required");
  }
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const price = closes.at(-1);
  const prevPrice = closes.at(-2);
  const last = candles.at(-1);
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const e50 = ema(closes, 50);
  const r = rsi(closes, 14);
  const m = macd(closes);
  const a = atr(candles, 14);
  const volAvg = sma(volumes.slice(0, -1), 20) || 1;
  const volumeRatio = last.volume / volAvg;
  const momentum5 = closes.length > 6 ? price / closes.at(-6) - 1 : 0;
  const atrPct = a / price;
  const bullishCandle = last.close > last.open;
  const bearishCandle = last.close < last.open;

  let buyScore = 5;
  let exitScore = 5;
  const reasons = [];
  const exitReasons = [];

  if (e12 > e26) { buyScore += 18; reasons.push("EMA12 > EMA26"); }
  else { exitScore += 20; exitReasons.push("EMA12 < EMA26"); }

  if (price > e50) { buyScore += 15; reasons.push("Price above EMA50"); }
  else { exitScore += 15; exitReasons.push("Price below EMA50"); }

  if (m.histogram > 0) { buyScore += 14; reasons.push("MACD positive"); }
  else { exitScore += 15; exitReasons.push("MACD negative"); }

  if (r >= 52 && r <= 68) { buyScore += 14; reasons.push("RSI trend zone"); }
  else if (r >= 45 && r < 52) { buyScore += 5; }
  else if (r < 42) { exitScore += 12; exitReasons.push("RSI weak"); }
  if (r > 76) { buyScore -= 12; exitScore += 8; exitReasons.push("RSI overheated"); }

  if (volumeRatio >= 1.05) { buyScore += 8; reasons.push("Volume confirmation"); }
  if (volumeRatio >= 1.25 && bearishCandle) { exitScore += 8; exitReasons.push("Heavy sell volume"); }

  if (momentum5 > 0.002) { buyScore += 10; reasons.push("Positive momentum"); }
  else if (momentum5 < -0.002) { exitScore += 10; exitReasons.push("Negative momentum"); }

  if (higherHigh(candles)) { buyScore += 8; reasons.push("Higher-high structure"); }
  if (bullishCandle && price > prevPrice) buyScore += 5;
  if (bearishCandle && price < prevPrice) exitScore += 7;

  if (atrPct >= 0.003 && atrPct <= 0.03) buyScore += 5;
  if (atrPct > 0.05) { buyScore -= 18; reasons.push("Extreme volatility penalty"); }

  buyScore = clamp(Math.round(buyScore), 0, 100);
  exitScore = clamp(Math.round(exitScore), 0, 100);

  return {
    price: round(price, 8),
    buyScore,
    exitScore,
    reasons: reasons.slice(0, 6),
    exitReasons: exitReasons.slice(0, 6),
    indicators: {
      ema12: round(e12, 8),
      ema26: round(e26, 8),
      ema50: round(e50, 8),
      rsi: round(r, 2),
      macd: round(m.macd, 8),
      macdSignal: round(m.signal, 8),
      macdHistogram: round(m.histogram, 8),
      atr: round(a, 8),
      atrPct: round(atrPct * 100, 3),
      volumeRatio: round(volumeRatio, 2),
      momentum5Pct: round(momentum5 * 100, 3),
    },
  };
}

export function analyzeMultiTimeframe(mainCandles, fastCandles, minConfidence = 70) {
  const main = analyzeFrame(mainCandles);
  const fast = analyzeFrame(fastCandles);
  const buyConfidence = clamp(Math.round(main.buyScore * 0.7 + fast.buyScore * 0.3), 0, 100);
  const exitConfidence = clamp(Math.round(main.exitScore * 0.7 + fast.exitScore * 0.3), 0, 100);
  const alignedBullish = main.buyScore >= minConfidence && fast.buyScore >= Math.max(55, minConfidence - 15);
  const alignedBearish = main.exitScore >= 62 && fast.exitScore >= 55;

  let action = "HOLD";
  if (alignedBullish && buyConfidence >= minConfidence) action = "BUY";
  else if (alignedBearish && exitConfidence >= 62) action = "SELL";

  return {
    action,
    confidence: action === "BUY" ? buyConfidence : action === "SELL" ? exitConfidence : Math.max(buyConfidence, exitConfidence),
    buyConfidence,
    exitConfidence,
    price: main.price,
    main,
    fast,
  };
}

export function computeTradePlan({ equity, cash, price, atrPct, riskPerTrade, maxPositionPct, stopLossPct: requestedStopLossPct = 0.10, takeProfitPct: requestedTakeProfitPct = 0.30 }) {
  // KAI TRAD locked auto-exit policy: hard SL 10%, hard TP 30%.
  // Trailing follows the same 10% distance and may protect profit earlier after price advances.
  const stopPct = clamp(Number(requestedStopLossPct), 0.01, 0.25);
  const takeProfitPct = clamp(Number(requestedTakeProfitPct), 0.01, 1.0);
  const trailingPct = stopPct;
  const riskCapital = equity * riskPerTrade;
  const byRisk = riskCapital / stopPct;
  const byCap = equity * maxPositionPct;
  const notional = Math.max(0, Math.min(byRisk, byCap, cash * 0.995));
  const qty = notional / price;
  return {
    notional: round(notional, 2),
    qty: round(qty, 8),
    stopPct: round(stopPct, 6),
    takeProfitPct: round(takeProfitPct, 6),
    trailingPct: round(trailingPct, 6),
    stopPrice: round(price * (1 - stopPct), 8),
    takeProfitPrice: round(price * (1 + takeProfitPct), 8),
    trailingStopPrice: round(price * (1 - trailingPct), 8),
  };
}

export function updateTrailingStop(position, price) {
  if (!position) return position;
  const candidate = price * (1 - position.trailingPct);
  return {
    ...position,
    highWaterPrice: Math.max(position.highWaterPrice || position.entryPrice, price),
    trailingStopPrice: round(Math.max(position.trailingStopPrice || 0, candidate), 8),
  };
}

export function evaluateRiskExit(position, price) {
  if (!position) return null;
  if (price <= position.stopPrice) return { reason: "STOP_LOSS", priority: 100 };
  if (price <= position.trailingStopPrice && price > position.entryPrice) return { reason: "TRAILING_STOP", priority: 95 };
  if (price >= position.takeProfitPrice) return { reason: "TAKE_PROFIT", priority: 90 };
  return null;
}

export function safeConfig(input, current) {
  const allowedSymbols = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"]);
  const allowedIntervals = new Set(["5m", "15m", "30m", "1h"]);
  const next = { ...current };
  if (allowedSymbols.has(String(input.symbol || "").toUpperCase())) next.symbol = String(input.symbol).toUpperCase();
  if (allowedIntervals.has(input.interval)) next.interval = input.interval;
  if (allowedIntervals.has(input.fastInterval)) next.fastInterval = input.fastInterval;
  if (Number.isFinite(Number(input.riskPerTrade))) next.riskPerTrade = clamp(Number(input.riskPerTrade), 0.0025, 0.02);
  if (Number.isFinite(Number(input.maxPositionPct))) next.maxPositionPct = clamp(Number(input.maxPositionPct), 0.05, 0.5);
  if (Number.isFinite(Number(input.maxDailyLossPct))) next.maxDailyLossPct = clamp(Number(input.maxDailyLossPct), 0.01, 0.08);
  if (Number.isFinite(Number(input.minSignalConfidence))) next.minSignalConfidence = clamp(Math.round(Number(input.minSignalConfidence)), 60, 90);
  if (typeof input.aiValidation === "boolean") next.aiValidation = input.aiValidation;
  return next;
}
