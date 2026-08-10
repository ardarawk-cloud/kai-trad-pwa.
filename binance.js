function num(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric value: ${v}`);
  return n;
}

export async function fetchKlines(baseUrl, symbol, interval, limit = 200) {
  const url = new URL("/api/v3/klines", baseUrl);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url, { headers: { "User-Agent": "KAI-TRAD/1.0" } });
  if (!res.ok) throw new Error(`Market data HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length < 60) throw new Error("Insufficient market data");
  const closed = rows.map((r) => ({
    openTime: Number(r[0]),
    open: num(r[1]),
    high: num(r[2]),
    low: num(r[3]),
    close: num(r[4]),
    volume: num(r[5]),
    closeTime: Number(r[6]),
  })).filter((c) => c.closeTime <= Date.now());
  if (closed.length < 60) throw new Error("Insufficient closed candle data");
  return closed;
}

export async function fetchTickerPrice(baseUrl, symbol) {
  const url = new URL("/api/v3/ticker/price", baseUrl);
  url.searchParams.set("symbol", symbol);
  const res = await fetch(url, { headers: { "User-Agent": "KAI-TRAD/1.0" } });
  if (!res.ok) throw new Error(`Ticker HTTP ${res.status}`);
  const data = await res.json();
  return num(data.price);
}

async function hmacSha256(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signedRequest({ baseUrl, apiKey, apiSecret, method = "GET", path, params = {} }) {
  if (!apiKey || !apiSecret) throw new Error("Binance live API credentials are not configured");
  const payload = new URLSearchParams({ ...params, timestamp: String(Date.now()), recvWindow: "5000" });
  const signature = await hmacSha256(apiSecret, payload.toString());
  payload.set("signature", signature);
  const url = new URL(path, baseUrl);
  let body;
  if (method === "GET" || method === "DELETE") url.search = payload.toString();
  else body = payload.toString();
  const res = await fetch(url, {
    method,
    headers: {
      "X-MBX-APIKEY": apiKey,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Binance ${method} ${path} failed: ${data.msg || res.status}`);
  return data;
}

export async function placeMarketBuy({ baseUrl, apiKey, apiSecret, symbol, quoteOrderQty }) {
  return signedRequest({
    baseUrl,
    apiKey,
    apiSecret,
    method: "POST",
    path: "/api/v3/order",
    params: {
      symbol,
      side: "BUY",
      type: "MARKET",
      quoteOrderQty: String(Number(quoteOrderQty).toFixed(2)),
      newOrderRespType: "FULL",
    },
  });
}

export async function placeMarketSell({ baseUrl, apiKey, apiSecret, symbol, quantity }) {
  return signedRequest({
    baseUrl,
    apiKey,
    apiSecret,
    method: "POST",
    path: "/api/v3/order",
    params: {
      symbol,
      side: "SELL",
      type: "MARKET",
      quantity: String(quantity),
      newOrderRespType: "FULL",
    },
  });
}

export function parseFill(order, fallbackPrice) {
  const fills = Array.isArray(order?.fills) ? order.fills : [];
  const executedQty = Number(order?.executedQty || 0);
  const quoteQty = Number(order?.cummulativeQuoteQty || 0);
  const weightedPrice = executedQty > 0 && quoteQty > 0 ? quoteQty / executedQty : fallbackPrice;
  return { executedQty, quoteQty, price: weightedPrice, orderId: order?.orderId || null, fills };
}

export async function getSpotAccount({ baseUrl, apiKey, apiSecret }) {
  return signedRequest({ baseUrl, apiKey, apiSecret, method: "GET", path: "/api/v3/account" });
}

export function getFreeBalance(account, asset) {
  const row = Array.isArray(account?.balances) ? account.balances.find((b) => b.asset === asset) : null;
  return Number(row?.free || 0);
}

export async function fetchSymbolRules(baseUrl, symbol) {
  const url = new URL("/api/v3/exchangeInfo", baseUrl);
  url.searchParams.set("symbol", symbol);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Exchange info HTTP ${res.status}`);
  const data = await res.json();
  const item = data?.symbols?.[0];
  if (!item) throw new Error(`Unknown symbol ${symbol}`);
  const lot = item.filters?.find((f) => f.filterType === "LOT_SIZE");
  return {
    baseAsset: item.baseAsset,
    quoteAsset: item.quoteAsset,
    stepSize: Number(lot?.stepSize || 0.00000001),
    minQty: Number(lot?.minQty || 0),
  };
}

export function floorToStep(value, step) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  const precision = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  const floored = Math.floor((value + 1e-12) / step) * step;
  return Number(floored.toFixed(Math.min(12, precision)));
}
