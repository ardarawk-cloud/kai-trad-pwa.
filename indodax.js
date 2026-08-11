async function jsonFetch(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Indodax HTTP ${res.status}`);
  return data;
}

const pairCache = new Map();
const MINUTE_MS = 60_000;

export function normalizeIndodaxPairSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function findIndodaxPair(pairs, symbol) {
  const target = normalizeIndodaxPairSymbol(symbol);
  if (!Array.isArray(pairs)) return null;
  return pairs.find((p) => normalizeIndodaxPairSymbol(p?.symbol) === target) || null;
}

export function getIndodaxTimeframeSpec(interval) {
  const key = String(interval || "").trim().toLowerCase();
  const specs = {
    "1m": { tf: "1", candleMs: MINUTE_MS, sourceCandleMs: MINUTE_MS, aggregate: 1 },
    "5m": { tf: "1", candleMs: 5 * MINUTE_MS, sourceCandleMs: MINUTE_MS, aggregate: 5 },
    "15m": { tf: "15", candleMs: 15 * MINUTE_MS, sourceCandleMs: 15 * MINUTE_MS, aggregate: 1 },
    "30m": { tf: "30", candleMs: 30 * MINUTE_MS, sourceCandleMs: 30 * MINUTE_MS, aggregate: 1 },
    "1h": { tf: "60", candleMs: 60 * MINUTE_MS, sourceCandleMs: 60 * MINUTE_MS, aggregate: 1 },
    "4h": { tf: "240", candleMs: 240 * MINUTE_MS, sourceCandleMs: 240 * MINUTE_MS, aggregate: 1 },
    "1d": { tf: "1D", candleMs: 24 * 60 * MINUTE_MS, sourceCandleMs: 24 * 60 * MINUTE_MS, aggregate: 1 },
    "3d": { tf: "3D", candleMs: 3 * 24 * 60 * MINUTE_MS, sourceCandleMs: 3 * 24 * 60 * MINUTE_MS, aggregate: 1 },
    "1w": { tf: "1W", candleMs: 7 * 24 * 60 * MINUTE_MS, sourceCandleMs: 7 * 24 * 60 * MINUTE_MS, aggregate: 1 },
  };
  const spec = specs[key];
  if (!spec) throw new Error(`Unsupported Indodax timeframe: ${interval}`);
  return { ...spec, interval: key };
}

function num(v, label = "value") {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid Indodax ${label}: ${v}`);
  return n;
}

export function normalizeIndodaxHistoryRows(rows, sourceCandleMs = MINUTE_MS) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => {
      const openTime = num(r?.Time, "time") * 1000;
      return {
        openTime,
        open: num(r?.Open, "open"),
        high: num(r?.High, "high"),
        low: num(r?.Low, "low"),
        close: num(r?.Close, "close"),
        volume: num(r?.Volume ?? 0, "volume"),
        closeTime: openTime + sourceCandleMs - 1,
      };
    })
    .filter((c) => c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0)
    .sort((a, b) => a.openTime - b.openTime);
}

export function aggregateIndodaxCandles(candles, bucketMs, requiredSourceCount = 1) {
  if (!Array.isArray(candles) || !candles.length) return [];
  const groups = new Map();
  for (const candle of candles) {
    const bucket = Math.floor(candle.openTime / bucketMs) * bucketMs;
    const current = groups.get(bucket);
    if (!current) {
      groups.set(bucket, {
        openTime: bucket,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        closeTime: bucket + bucketMs - 1,
        sourceCount: 1,
      });
      continue;
    }
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume;
    current.sourceCount += 1;
  }
  return [...groups.values()]
    .filter((c) => c.sourceCount >= requiredSourceCount)
    .sort((a, b) => a.openTime - b.openTime)
    .map(({ sourceCount, ...c }) => c);
}

export async function fetchIndodaxPairs(baseUrl = "https://indodax.com", maxAgeMs = 60_000) {
  const origin = new URL(baseUrl).origin;
  const cached = pairCache.get(origin);
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.rows;
  const rows = await jsonFetch(new URL("/api/pairs", origin), { headers: { "User-Agent": "KAI-TRAD/1.9.1" } });
  if (!Array.isArray(rows) || !rows.length) throw new Error("Indodax pair list unavailable");
  pairCache.set(origin, { at: Date.now(), rows });
  return rows;
}

async function resolveIndodaxPair(baseUrl, symbol) {
  const pairs = await fetchIndodaxPairs(baseUrl);
  const pair = findIndodaxPair(pairs, symbol);
  if (!pair) throw new Error(`Indodax pair unavailable: ${normalizeIndodaxPairSymbol(symbol)}`);
  return pair;
}

export async function fetchIndodaxKlines(baseUrl = "https://indodax.com", symbol = "BTCUSDT", interval = "15m", limit = 200) {
  const pair = await resolveIndodaxPair(baseUrl, symbol);
  const spec = getIndodaxTimeframeSpec(interval);
  const safeLimit = Math.max(60, Math.min(500, Number(limit) || 200));
  const padding = 24;
  const nowSec = Math.floor(Date.now() / 1000);
  const lookbackSec = Math.ceil(((safeLimit + padding) * spec.candleMs) / 1000);
  const url = new URL("/tradingview/history_v2", baseUrl);
  url.searchParams.set("from", String(nowSec - lookbackSec));
  url.searchParams.set("to", String(nowSec));
  url.searchParams.set("tf", spec.tf);
  url.searchParams.set("symbol", pair.symbol);

  const rows = await jsonFetch(url, { headers: { "User-Agent": "KAI-TRAD/1.9.1" } });
  let candles = normalizeIndodaxHistoryRows(rows, spec.sourceCandleMs);
  if (spec.aggregate > 1) candles = aggregateIndodaxCandles(candles, spec.candleMs, spec.aggregate);
  candles = candles.filter((c) => c.closeTime <= Date.now()).slice(-safeLimit);
  if (candles.length < 60) throw new Error(`Insufficient Indodax closed candle data for ${pair.symbol} ${interval}`);
  return candles;
}

export async function fetchIndodaxTickerPrice(baseUrl = "https://indodax.com", symbol = "BTCUSDT") {
  const pair = await resolveIndodaxPair(baseUrl, symbol);
  const data = await jsonFetch(new URL(`/api/ticker/${pair.id}`, baseUrl), { headers: { "User-Agent": "KAI-TRAD/1.9.1" } });
  return num(data?.ticker?.last, "ticker last");
}

export async function indodaxPublicPreflight({ baseUrl = "https://indodax.com", symbol = "BTCUSDT" } = {}) {
  const started = Date.now();
  const [time, pairs] = await Promise.all([
    jsonFetch(new URL("/api/server_time", baseUrl), { headers: { "User-Agent": "KAI-TRAD/1.9.1" } }),
    fetchIndodaxPairs(baseUrl, 0),
  ]);
  const pair = findIndodaxPair(pairs, symbol);
  return {
    broker: "indodax",
    reachable: true,
    endpointHost: new URL(baseUrl).host,
    latencyMs: Date.now() - started,
    serverTime: Number(time?.server_time || 0) || null,
    symbol: normalizeIndodaxPairSymbol(symbol),
    symbolSupported: Boolean(pair),
    pairId: pair?.id || null,
    tickerId: pair?.ticker_id || null,
    minBaseCurrency: Number(pair?.trade_min_base_currency || 0) || null,
  };
}
