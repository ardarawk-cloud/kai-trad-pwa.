import baseWorker, { TradingState as BaseTradingState } from "./worker-v1110.js";
import { EVIDENCE_COST_MODEL } from "./evidence-v1110.js";
import { assessQuoteIntegrity, stampQuote, VERIFIED_FRESH_QUOTE } from "./quote-integrity-v1111.js";

const APP_VERSION = "1.11.0";
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function maxQuoteAgeMs(env) {
  return Math.max(1_000, Math.min(60_000, Number(env.PAPER_EVIDENCE_MAX_QUOTE_AGE_MS || 10_000)));
}

function auditQuote(instance, rawQuote) {
  return assessQuoteIntegrity(rawQuote, {
    nowMs: Date.now(),
    maxAgeMs: maxQuoteAgeMs(instance.env),
  });
}

export class TradingState extends BaseTradingState {
  async state() {
    const s = await super.state();
    s.version = APP_VERSION;
    s.costModel = {
      ...(s.costModel || {}),
      quoteIntegrity: "FRESH_TIMESTAMP_AND_AUDIT_ID_REQUIRED",
      maxQuoteAgeMs: maxQuoteAgeMs(this.env),
    };

    // Conservative migration: a position opened before quote timestamps/audit IDs
    // existed may finish normally, but it cannot count toward strict evidence.
    if (
      s.mode !== "live" &&
      s.position?.costModelVersion === EVIDENCE_COST_MODEL &&
      s.position?.evidenceEligible === true &&
      s.position?.entryQuoteIntegrity !== VERIFIED_FRESH_QUOTE
    ) {
      s.position.evidenceEligible = false;
      s.position.evidenceInvalidReason = "UNVERIFIED_ENTRY_QUOTE_TIMESTAMP";
      const buy = (s.trades || []).find((t) => t?.side === "BUY" && t?.orderId === s.position?.orderId);
      if (buy) {
        buy.evidenceEligible = false;
        buy.quoteIntegrity = "UNVERIFIED";
        buy.evidenceInvalidReason = "UNVERIFIED_ENTRY_QUOTE_TIMESTAMP";
      }
    }
    return s;
  }

  async scanSymbol(baseUrl, s, symbol) {
    const result = await super.scanSymbol(baseUrl, s, symbol);
    if (result?.marketQuote) {
      const stamped = stampQuote(result.marketQuote, {
        nowMs: Date.now(),
        auditId: crypto.randomUUID(),
      });
      result.marketQuote = stamped;
      this._evidenceQuotes ||= new Map();
      this._evidenceQuotes.set(symbol, stamped);
    }
    return result;
  }

  quoteFor(symbol, marketPrice) {
    const raw = super.quoteFor(symbol, marketPrice);
    const audit = auditQuote(this, raw);
    if (audit.valid) {
      return {
        ...raw,
        quoteIntegrity: VERIFIED_FRESH_QUOTE,
        quoteAgeMs: audit.ageMs,
      };
    }

    const fallback = Number(marketPrice || raw?.last || 0);
    return {
      ...raw,
      last: Number(raw?.last || fallback),
      bid: Number(raw?.bid || fallback),
      ask: Number(raw?.ask || fallback),
      mid: Number(raw?.mid || fallback),
      spreadModeled: false,
      quoteIntegrity: "UNVERIFIED",
      quoteAgeMs: audit.ageMs,
      quoteInvalidReason: audit.reason,
      source: `${raw?.source || "QUOTE"}_UNVERIFIED`,
    };
  }

  async executeBuy(s, analysis, marketPrice, symbol = s.signal?.symbol || s.config.symbol) {
    const raw = this._evidenceQuotes?.get(symbol);
    const audit = auditQuote(this, raw);
    const result = await super.executeBuy(s, analysis, marketPrice, symbol);
    const p = result.position;
    if (!p || p.symbol !== symbol) return result;

    p.entryQuoteIntegrity = audit.valid ? VERIFIED_FRESH_QUOTE : "UNVERIFIED";
    p.entryQuoteFetchedAt = raw?.fetchedAt || null;
    p.entryQuoteAgeMs = audit.ageMs;
    p.entryQuoteAuditId = raw?.quoteAuditId || null;
    p.entryBid = Number(raw?.bid || 0) || null;
    p.entryAsk = Number(raw?.ask || 0) || null;
    p.entryQuoteSource = raw?.source || null;
    if (!audit.valid) {
      p.evidenceEligible = false;
      p.evidenceInvalidReason = audit.reason;
    }

    const buy = (result.trades || []).find((t) => t?.side === "BUY" && t?.orderId === p.orderId);
    if (buy) {
      buy.quoteIntegrity = p.entryQuoteIntegrity;
      buy.quoteFetchedAt = p.entryQuoteFetchedAt;
      buy.quoteAgeMs = p.entryQuoteAgeMs;
      buy.quoteAuditId = p.entryQuoteAuditId;
      buy.quoteSource = p.entryQuoteSource;
      buy.bid = p.entryBid;
      buy.ask = p.entryAsk;
      buy.evidenceEligible = p.evidenceEligible === true;
      if (!buy.evidenceEligible) buy.evidenceInvalidReason = p.evidenceInvalidReason || "QUOTE_INTEGRITY_FAILED";
    }
    return result;
  }

  async executeSell(s, marketPrice, reason) {
    const p = s.position;
    const symbol = p?.symbol;
    const raw = this._evidenceQuotes?.get(symbol);
    const exitAudit = auditQuote(this, raw);
    const entryVerified = p?.entryQuoteIntegrity === VERIFIED_FRESH_QUOTE;
    const entryAuditId = p?.entryQuoteAuditId || null;
    const result = await super.executeSell(s, marketPrice, reason);
    const sell = (result.trades || []).find((t) => t?.side === "SELL" && t?.symbol === symbol);
    if (!sell) return result;

    const strict = entryVerified && exitAudit.valid && sell.evidenceEligible === true;
    sell.entryQuoteIntegrity = entryVerified ? VERIFIED_FRESH_QUOTE : "UNVERIFIED";
    sell.entryQuoteAuditId = entryAuditId;
    sell.exitQuoteIntegrity = exitAudit.valid ? VERIFIED_FRESH_QUOTE : "UNVERIFIED";
    sell.exitQuoteFetchedAt = raw?.fetchedAt || null;
    sell.exitQuoteAgeMs = exitAudit.ageMs;
    sell.exitQuoteAuditId = raw?.quoteAuditId || null;
    sell.exitQuoteSource = raw?.source || null;
    sell.exitBid = Number(raw?.bid || 0) || null;
    sell.exitAsk = Number(raw?.ask || 0) || null;
    sell.quoteIntegrity = strict ? VERIFIED_FRESH_QUOTE : "UNVERIFIED";
    sell.evidenceEligible = strict;
    if (!strict) {
      sell.evidenceInvalidReason = !entryVerified
        ? (p?.evidenceInvalidReason || "UNVERIFIED_ENTRY_QUOTE_TIMESTAMP")
        : (!exitAudit.valid ? exitAudit.reason : "STRICT_EVIDENCE_GUARD_REJECTED");
    }
    return result;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      const response = await baseWorker.fetch(request, env);
      const data = await response.json().catch(() => ({}));
      return json({
        ...data,
        version: APP_VERSION,
        quoteIntegrityAudit: "ACTIVE",
        strictEvidenceQuoteRequirement: VERIFIED_FRESH_QUOTE,
        maxEvidenceQuoteAgeMs: maxQuoteAgeMs(env),
        legacyOpenPositionPolicy: "FINISH_BUT_EXCLUDE_IF_ENTRY_QUOTE_UNVERIFIED",
      }, response.status);
    }
    return baseWorker.fetch(request, env);
  },
};
