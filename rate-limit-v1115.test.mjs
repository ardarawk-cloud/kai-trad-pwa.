import test from "node:test";
import assert from "node:assert/strict";
import {
  INDODAX_RATE_LIMIT_POLICY,
  isIndodaxRateLimitError,
  parseRetryAfterMs,
  rateLimitBackoffSeconds,
  retryDelayMs,
} from "./rate-limit-v1115.js";

test("v1.11.5 identifies Indodax 429 without swallowing unrelated failures", () => {
  assert.equal(INDODAX_RATE_LIMIT_POLICY, "INDODAX_429_BACKOFF_V1");
  assert.equal(isIndodaxRateLimitError(new Error("Indodax HTTP 429")), true);
  assert.equal(isIndodaxRateLimitError("Multi-coin scan failed: BTCUSDT Indodax HTTP 429"), true);
  assert.equal(isIndodaxRateLimitError(new Error("Indodax HTTP 500")), false);
  assert.equal(isIndodaxRateLimitError(new Error("Tokocrypto HTTP 429")), false);
});

test("v1.11.5 respects Retry-After and exponential retry caps", () => {
  assert.equal(parseRetryAfterMs("3", 0), 3000);
  assert.equal(parseRetryAfterMs("garbage", 0), 0);
  assert.equal(retryDelayMs(0, 3000), 3000);
  assert.equal(retryDelayMs(1, 0), 2000);
  assert.equal(retryDelayMs(8, 0), 15000);
});

test("v1.11.5 engine backoff grows but remains bounded", () => {
  assert.equal(rateLimitBackoffSeconds(1), 60);
  assert.equal(rateLimitBackoffSeconds(2), 120);
  assert.equal(rateLimitBackoffSeconds(3), 240);
  assert.equal(rateLimitBackoffSeconds(5), 900);
  assert.equal(rateLimitBackoffSeconds(99), 900);
});
