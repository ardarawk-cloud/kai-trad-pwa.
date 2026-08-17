export const VERIFIED_FRESH_QUOTE = "VERIFIED_FRESH";

const finite = (v) => Number.isFinite(Number(v));

export function stampQuote(quote = {}, { nowMs = Date.now(), auditId = null } = {}) {
  return {
    ...quote,
    fetchedAt: new Date(nowMs).toISOString(),
    fetchedAtMs: nowMs,
    quoteAuditId: auditId || null,
  };
}

export function assessQuoteIntegrity(quote, { nowMs = Date.now(), maxAgeMs = 10_000 } = {}) {
  const fetchedAtMs = finite(quote?.fetchedAtMs)
    ? Number(quote.fetchedAtMs)
    : Date.parse(String(quote?.fetchedAt || ""));
  const ageMs = Number.isFinite(fetchedAtMs) ? nowMs - fetchedAtMs : null;
  const maxAge = Math.max(1_000, Math.min(60_000, Number(maxAgeMs) || 10_000));

  if (!quote || quote.source !== "INDODAX_LIVE_BID_ASK" || quote.spreadModeled !== true) {
    return { valid: false, ageMs, reason: "QUOTE_SOURCE_NOT_LIVE_BID_ASK" };
  }
  if (!finite(quote.bid) || !finite(quote.ask) || !finite(quote.mid) || Number(quote.bid) <= 0 || Number(quote.ask) < Number(quote.bid) || Number(quote.mid) <= 0) {
    return { valid: false, ageMs, reason: "INVALID_BID_ASK" };
  }
  if (!Number.isFinite(fetchedAtMs)) {
    return { valid: false, ageMs: null, reason: "MISSING_QUOTE_TIMESTAMP" };
  }
  if (ageMs < 0 || ageMs > maxAge) {
    return { valid: false, ageMs, reason: "STALE_QUOTE" };
  }
  if (!quote.quoteAuditId) {
    return { valid: false, ageMs, reason: "MISSING_QUOTE_AUDIT_ID" };
  }
  return { valid: true, ageMs, reason: "VERIFIED_FRESH" };
}
