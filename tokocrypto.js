function num(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric value: ${v}`);
  return n;
}

export function toTokocryptoSymbol(symbol) {
  const raw = String(symbol || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "");
  if (raw.includes("_")) return raw;
  for (const quote of ["USDT", "IDR", "BTC", "ETH", "BNB"]) {
    if (raw.endsWith(quote) && raw.length > quote.length) return `${raw.slice(0, -quote.length)}_${quote}`;
  }
  return raw;
}

export function toMarketSymbol(symbol) {
  return toTokocryptoSymbol(symbol).replaceAll("_", "");
}

async function hmacSha256(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function jsonFetch(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Tokocrypto HTTP ${res.status}`);
  if (data && typeof data === "object" && "code" in data && Number(data.code) !== 0) {
    throw new Error(`Tokocrypto API ${data.code}: ${data.message || data.msg || "request failed"}`);
  }
  if (data?.success === false) throw new Error(`Tokocrypto API: ${data.message || data.msg || "request failed"}`);
  return data;
}

export async function fetchTokocryptoServerTime(baseUrl = "https://www.tokocrypto.com") {
  const url = new URL("/open/v1/common/time", baseUrl);
  const data = await jsonFetch(url);
  const timestamp = Number(data?.timestamp);
  if (!Number.isFinite(timestamp)) throw new Error("Tokocrypto server time missing");
  return timestamp;
}

export async function fetchTokocryptoSymbols(baseUrl = "https://www.tokocrypto.com") {
  const url = new URL("/open/v1/common/symbols", baseUrl);
  const data = await jsonFetch(url);
  const list = data?.data?.list;
  if (!Array.isArray(list)) throw new Error("Tokocrypto symbols response invalid");
  return list;
}

export function parseTokocryptoSymbolRules(item) {
  if (!item) throw new Error("Tokocrypto symbol not found");
  const filters = Array.isArray(item.filters) ? item.filters : [];
  const lot = filters.find((f) => f.filterType === "LOT_SIZE");
  const marketLot = filters.find((f) => f.filterType === "MARKET_LOT_SIZE");
  const notional = filters.find((f) => f.filterType === "NOTIONAL") || filters.find((f) => f.filterType === "MIN_NOTIONAL");
  const marketStep = Number(marketLot?.stepSize || 0);
  const marketMin = Number(marketLot?.minQty || 0);
  const marketMax = Number(marketLot?.maxQty || 0);
  return {
    broker: "tokocrypto",
    symbol: item.symbol,
    marketSymbol: String(item.symbol || "").replaceAll("_", ""),
    baseAsset: item.baseAsset,
    quoteAsset: item.quoteAsset,
    status: Number(item.spotTradingEnable ?? 1) === 1 ? "TRADING" : "HALT",
    marketOrderAllowed: Array.isArray(item.orderTypes) ? item.orderTypes.includes("MARKET") : true,
    quoteOrderQtyMarketAllowed: true,
    stepSize: marketStep > 0 ? marketStep : Number(lot?.stepSize || 0.00000001),
    minQty: marketMin > 0 ? marketMin : Number(lot?.minQty || 0),
    maxQty: marketMax > 0 ? marketMax : Number(lot?.maxQty || 0),
    minNotional: Number(notional?.minNotional || 0),
    maxNotional: Number(notional?.maxNotional || 0),
    minNotionalAppliesToMarket: notional?.applyToMarket !== false,
    maxNotionalAppliesToMarket: Boolean(notional?.maxNotional) && notional?.applyToMarket !== false,
    defaultSelfTradePreventionMode: item.defaultSelfTradePreventionMode || null,
    allowedSelfTradePreventionModes: Array.isArray(item.allowedSelfTradePreventionModes) ? item.allowedSelfTradePreventionModes : [],
  };
}

export async function fetchTokocryptoSymbolRules({ baseUrl = "https://www.tokocrypto.com", symbol }) {
  const target = toTokocryptoSymbol(symbol);
  const list = await fetchTokocryptoSymbols(baseUrl);
  const item = list.find((x) => String(x.symbol || "").toUpperCase() === target);
  return parseTokocryptoSymbolRules(item);
}

export async function signedTokocryptoRequest({ baseUrl = "https://www.tokocrypto.com", apiKey, apiSecret, method = "GET", path, params = {}, timestamp }) {
  if (!apiKey || !apiSecret) throw new Error("Tokocrypto API credentials are not configured");
  const serverTime = Number.isFinite(Number(timestamp)) ? Number(timestamp) : await fetchTokocryptoServerTime(baseUrl);
  const payload = new URLSearchParams({ ...params, recvWindow: "5000", timestamp: String(serverTime) });
  const signature = await hmacSha256(apiSecret, payload.toString());
  payload.set("signature", signature);
  const url = new URL(path, baseUrl);
  let body;
  if (method === "GET" || method === "DELETE") url.search = payload.toString();
  else body = payload.toString();
  return jsonFetch(url, {
    method,
    headers: {
      "X-MBX-APIKEY": apiKey,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
}

export async function getTokocryptoSpotAccount({ baseUrl, apiKey, apiSecret }) {
  return signedTokocryptoRequest({ baseUrl, apiKey, apiSecret, method: "GET", path: "/open/v1/account/spot" });
}

export function getTokocryptoFreeBalance(account, asset) {
  const rows = account?.data?.accountAssets;
  const row = Array.isArray(rows) ? rows.find((x) => x.asset === asset) : null;
  return Number(row?.free || 0);
}

export async function placeTokocryptoMarketBuy({ baseUrl, apiKey, apiSecret, symbol, quoteOrderQty, clientOrderId, selfTradePreventionMode }) {
  return signedTokocryptoRequest({
    baseUrl,
    apiKey,
    apiSecret,
    method: "POST",
    path: "/open/v1/orders",
    params: {
      symbol: toTokocryptoSymbol(symbol),
      side: "0",
      type: "2",
      quoteOrderQty: String(Number(quoteOrderQty).toFixed(8)),
      ...(clientOrderId ? { clientId: clientOrderId } : {}),
      ...(selfTradePreventionMode != null ? { selfTradePreventionMode: String(selfTradePreventionMode) } : {}),
    },
  });
}

export async function placeTokocryptoMarketSell({ baseUrl, apiKey, apiSecret, symbol, quantity, clientOrderId, selfTradePreventionMode }) {
  return signedTokocryptoRequest({
    baseUrl,
    apiKey,
    apiSecret,
    method: "POST",
    path: "/open/v1/orders",
    params: {
      symbol: toTokocryptoSymbol(symbol),
      side: "1",
      type: "2",
      quantity: String(quantity),
      ...(clientOrderId ? { clientId: clientOrderId } : {}),
      ...(selfTradePreventionMode != null ? { selfTradePreventionMode: String(selfTradePreventionMode) } : {}),
    },
  });
}

export async function queryTokocryptoOrder({ baseUrl, apiKey, apiSecret, orderId, clientId }) {
  return signedTokocryptoRequest({
    baseUrl,
    apiKey,
    apiSecret,
    method: "GET",
    path: "/open/v1/orders/detail",
    params: {
      ...(orderId != null ? { orderId: String(orderId) } : {}),
      ...(clientId ? { clientId } : {}),
    },
  });
}

export function parseTokocryptoFill(order, fallbackPrice) {
  const d = order?.data || order || {};
  const executedQty = Number(d.executedQty || 0);
  const quoteQty = Number(d.executedQuoteQty || 0);
  const explicit = Number(d.executedPrice || 0);
  const price = explicit > 0 ? explicit : executedQty > 0 && quoteQty > 0 ? quoteQty / executedQty : Number(fallbackPrice || 0);
  return {
    executedQty,
    quoteQty,
    price,
    orderId: d.orderId ?? null,
    clientId: d.clientId ?? null,
    status: Number(d.status ?? -1),
    raw: d,
  };
}

export async function waitForTokocryptoFill({ baseUrl, apiKey, apiSecret, order, fallbackPrice, attempts = 6, waitMs = 350 }) {
  let fill = parseTokocryptoFill(order, fallbackPrice);
  if (fill.status === 2 && fill.executedQty > 0) return fill;
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const detail = await queryTokocryptoOrder({ baseUrl, apiKey, apiSecret, orderId: fill.orderId, clientId: fill.clientId });
    fill = parseTokocryptoFill(detail, fallbackPrice);
    if (fill.status === 2 && fill.executedQty > 0) return fill;
    if ([3, 5, 6].includes(fill.status)) break;
  }
  if (fill.executedQty > 0) return fill;
  throw new Error(`Tokocrypto order not filled (status ${fill.status})`);
}

export async function tokocryptoPublicPreflight({ baseUrl = "https://www.tokocrypto.com", symbol = "BTCUSDT" } = {}) {
  const started = Date.now();
  const [serverTime, rules] = await Promise.all([
    fetchTokocryptoServerTime(baseUrl),
    fetchTokocryptoSymbolRules({ baseUrl, symbol }),
  ]);
  return {
    broker: "tokocrypto",
    reachable: true,
    serverTime,
    latencyMs: Date.now() - started,
    symbol: rules.symbol,
    marketOrderAllowed: rules.marketOrderAllowed,
    spotTrading: rules.status === "TRADING",
    quoteAsset: rules.quoteAsset,
    minNotional: rules.minNotional,
    stepSize: rules.stepSize,
    defaultSelfTradePreventionMode: rules.defaultSelfTradePreventionMode,
  };
}
