import test from "node:test";
import assert from "node:assert/strict";
import { assessQuoteIntegrity, stampQuote, VERIFIED_FRESH_QUOTE } from "./quote-integrity-v1111.js";

function liveQuote() {
  return { source: "INDODAX_LIVE_BID_ASK", spreadModeled: true, bid: 63100, ask: 63120, mid: 63110, last: 63115 };
}

test("fresh stamped Indodax bid/ask quote is evidence-verifiable", () => {
  const quote = stampQuote(liveQuote(), { nowMs: 1_000_000, auditId: "q-1" });
  const audit = assessQuoteIntegrity(quote, { nowMs: 1_005_000, maxAgeMs: 10_000 });
  assert.equal(audit.valid, true);
  assert.equal(audit.reason, VERIFIED_FRESH_QUOTE);
  assert.equal(audit.ageMs, 5000);
});

test("old quote is rejected as stale", () => {
  const quote = stampQuote(liveQuote(), { nowMs: 1_000_000, auditId: "q-2" });
  const audit = assessQuoteIntegrity(quote, { nowMs: 1_020_001, maxAgeMs: 10_000 });
  assert.equal(audit.valid, false);
  assert.equal(audit.reason, "STALE_QUOTE");
});

test("quote without timestamp cannot enter strict evidence", () => {
  const audit = assessQuoteIntegrity({ ...liveQuote(), quoteAuditId: "q-3" }, { nowMs: 1_000_000 });
  assert.equal(audit.valid, false);
  assert.equal(audit.reason, "MISSING_QUOTE_TIMESTAMP");
});

test("invalid spread cannot enter strict evidence", () => {
  const quote = stampQuote({ ...liveQuote(), bid: 63200, ask: 63100 }, { nowMs: 1_000_000, auditId: "q-4" });
  const audit = assessQuoteIntegrity(quote, { nowMs: 1_001_000 });
  assert.equal(audit.valid, false);
  assert.equal(audit.reason, "INVALID_BID_ASK");
});
