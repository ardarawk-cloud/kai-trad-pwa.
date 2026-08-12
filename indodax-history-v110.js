import {
  aggregateIndodaxCandles,
  fetchIndodaxPairs,
  findIndodaxPair,
  getIndodaxTimeframeSpec,
  normalizeIndodaxHistoryRows,
  normalizeIndodaxPairSymbol,
} from "./indodax.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

async function jsonFetch(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "KAI-TRAD/1.10",
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Indodax HTTP ${res.status}`);
  return data;
}

export function validateHistoryRange(fromMs, toMs, maxDays = 8) {
  const from = Number(fromMs);
  const to = Number(toMs);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= from) {
    throw new Error("Invalid historical time range");
  }
  const maxSpan = Math.max(1, Number(maxDays) || 8) * DAY_MS;
  if (to - from > maxSpan) throw new Error(`Historical range exceeds ${maxDays} days`);
  return { fromMs: from, toMs: to, spanMs: to - from };
}

export function historyChunkMs(interval) {
  const spec = getIndodaxTimeframeSpec(interval);
  if (spec.tf === "1") return 12 * HOUR_MS;
  if (["15", "30", "60"].includes(spec.tf)) return 3 * DAY_MS;
  return 7 * DAY_MS;
}

function dedupeCandles(candles = []) {
  const byOpen = new Map();
  for (const candle of candles) byOpen.set(candle.openTime, candle);
  return [...byOpen.values()].sort((a, b) => a.openTime - b.openTime);
}

export async function fetchIndodaxHistoryRange({
  baseUrl = "https://indodax.com",
  symbol = "BTCUSDT",
  interval = "15m",
  fromMs,
  toMs,
  maxDays = 8,
} = {}) {
  const range = validateHistoryRange(fromMs, toMs, maxDays);
  const pairs = await fetchIndodaxPairs(baseUrl);
  const pair = findIndodaxPair(pairs, symbol);
  if (!pair) throw new Error(`Indodax pair unavailable: ${normalizeIndodaxPairSymbol(symbol)}`);

  const spec = getIndodaxTimeframeSpec(interval);
  const chunkMs = historyChunkMs(interval);
  const normalized = [];

  for (let start = range.fromMs; start < range.toMs; start += chunkMs) {
    const end = Math.min(range.toMs, start + chunkMs);
    const url = new URL("/tradingview/history_v2", baseUrl);
    url.searchParams.set("from", String(Math.floor(start / 1000)));
    url.searchParams.set("to", String(Math.floor(end / 1000)));
    url.searchParams.set("tf", spec.tf);
    url.searchParams.set("symbol", pair.symbol);
    const rows = await jsonFetch(url);
    normalized.push(...normalizeIndodaxHistoryRows(rows, spec.sourceCandleMs));
  }

  let candles = dedupeCandles(normalized);
  if (spec.aggregate > 1) {
    candles = aggregateIndodaxCandles(candles, spec.candleMs, spec.aggregate);
  }

  return candles.filter((c) => c.openTime >= range.fromMs && c.closeTime <= range.toMs);
}
