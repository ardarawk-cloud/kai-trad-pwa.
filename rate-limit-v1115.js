export const INDODAX_RATE_LIMIT_POLICY = "INDODAX_429_BACKOFF_V1";

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function isIndodaxRateLimitError(error) {
  const message = String(error?.message || error || "");
  return /Indodax[^\n]*HTTP\s*429/i.test(message) ||
    (/Multi-coin scan failed/i.test(message) && /HTTP\s*429/i.test(message));
}

export function parseRetryAfterMs(value, nowMs = Date.now()) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return clamp(Math.round(seconds * 1000), 0, 60_000);
  }
  const when = Date.parse(raw);
  if (!Number.isFinite(when)) return 0;
  return clamp(Math.round(when - nowMs), 0, 60_000);
}

export function retryDelayMs(attempt = 0, retryAfterMs = 0, baseMs = 1000, maxMs = 15_000) {
  const n = Math.max(0, Math.floor(Number(attempt) || 0));
  const exponential = Math.max(0, Number(baseMs) || 1000) * (2 ** n);
  return clamp(Math.max(exponential, Number(retryAfterMs) || 0), 0, Math.max(1000, Number(maxMs) || 15_000));
}

export function rateLimitBackoffSeconds(streak = 1, baseSeconds = 60, maxSeconds = 900) {
  const n = Math.max(1, Math.floor(Number(streak) || 1));
  const base = Math.max(30, Number(baseSeconds) || 60);
  const max = Math.max(base, Number(maxSeconds) || 900);
  return Math.round(clamp(base * (2 ** (n - 1)), base, max));
}
