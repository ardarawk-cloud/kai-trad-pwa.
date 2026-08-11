async function jsonFetch(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Indodax HTTP ${res.status}`);
  return data;
}

export function normalizeIndodaxPairSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function findIndodaxPair(pairs, symbol) {
  const target = normalizeIndodaxPairSymbol(symbol);
  if (!Array.isArray(pairs)) return null;
  return pairs.find((p) => normalizeIndodaxPairSymbol(p?.symbol) === target) || null;
}

export async function indodaxPublicPreflight({ baseUrl = "https://indodax.com", symbol = "BTCUSDT" } = {}) {
  const started = Date.now();
  const [time, pairs] = await Promise.all([
    jsonFetch(new URL("/api/server_time", baseUrl), { headers: { "User-Agent": "KAI-TRAD/1.8.2" } }),
    jsonFetch(new URL("/api/pairs", baseUrl), { headers: { "User-Agent": "KAI-TRAD/1.8.2" } }),
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
