import baseWorker, { TradingState as BaseTradingState } from "./worker-v1115.js";
import {
  INDODAX_RATE_LIMIT_POLICY,
  isIndodaxRateLimitError,
  rateLimitBackoffSeconds,
} from "./rate-limit-v1115.js";

const APP_VERSION = "1.11.5";
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function ensureRateLimitState(s) {
  s.engine ||= {};
  s.engine.rateLimit ||= {
    policy: INDODAX_RATE_LIMIT_POLICY,
    streak: 0,
    until: null,
    lastAt: null,
    lastError: null,
    recoveries: 0,
  };
  s.engine.rateLimit.policy = INDODAX_RATE_LIMIT_POLICY;
  return s.engine.rateLimit;
}

export class TradingState extends BaseTradingState {
  async state() {
    const s = await super.state();
    s.version = APP_VERSION;
    const rate = ensureRateLimitState(s);

    // One-time migration for an engine that was previously halted only because
    // repeated Indodax 429s were counted as hard API failures.
    if (
      s.engine.running === false &&
      s.engine.lastAction === "HALTED_AFTER_ERRORS" &&
      s.engine.breaker?.reason === "API_ERROR_STREAK" &&
      isIndodaxRateLimitError(s.engine.lastError)
    ) {
      const streak = Math.max(1, Number(rate.streak || 0) + 1);
      const delaySeconds = rateLimitBackoffSeconds(streak);
      rate.streak = streak;
      rate.lastAt = new Date().toISOString();
      rate.lastError = String(s.engine.lastError || "Indodax HTTP 429").slice(0, 180);
      rate.until = new Date(Date.now() + delaySeconds * 1000).toISOString();
      rate.recoveries = Number(rate.recoveries || 0) + 1;

      s.engine.running = true;
      s.engine.consecutiveErrors = 0;
      s.engine.breaker = { active: false, reason: null, until: null };
      s.engine.lastAction = "RATE_LIMIT_AUTO_RECOVERY";
      s.engine.nextRunAt = await this.schedule(delaySeconds);
      await this.save(s);
    }
    return s;
  }

  async alarm() {
    const current = await this.state();
    if (!current.engine.running) return;

    try {
      await this.runCycle(false);

      const latest = await super.state();
      const rate = ensureRateLimitState(latest);
      if (rate.streak || rate.until || rate.lastError) {
        rate.streak = 0;
        rate.until = null;
        rate.lastError = null;
        latest.engine.consecutiveErrors = 0;
      }
      if (latest.engine.running) {
        latest.engine.nextRunAt = await this.schedule();
      }
      await this.save(latest);
      return;
    } catch (error) {
      const message = String(error?.message || error || "Unknown engine error");

      if (isIndodaxRateLimitError(message)) {
        const failed = await super.state();
        const rate = ensureRateLimitState(failed);
        const streak = Math.max(1, Number(rate.streak || 0) + 1);
        const delaySeconds = rateLimitBackoffSeconds(streak);

        rate.streak = streak;
        rate.lastAt = new Date().toISOString();
        rate.lastError = message.slice(0, 180);
        rate.until = new Date(Date.now() + delaySeconds * 1000).toISOString();
        rate.recoveries = Number(rate.recoveries || 0) + 1;

        failed.engine.running = true;
        failed.engine.lastError = message;
        failed.engine.lastAction = "RATE_LIMIT_BACKOFF";
        failed.engine.consecutiveErrors = 0;
        if (failed.engine.breaker?.reason === "API_ERROR_STREAK") {
          failed.engine.breaker = { active: false, reason: null, until: null };
        }
        failed.engine.nextRunAt = await this.schedule(delaySeconds);
        await this.save(failed);
        return;
      }

      const failed = await super.state();
      failed.engine.lastError = message;
      failed.engine.consecutiveErrors = (failed.engine.consecutiveErrors || 0) + 1;
      failed.engine.lastAction = "ERROR";
      if (failed.engine.consecutiveErrors >= 3) {
        failed.engine.running = false;
        failed.engine.lastAction = "HALTED_AFTER_ERRORS";
        failed.engine.nextRunAt = null;
        failed.engine.breaker = { active: true, reason: "API_ERROR_STREAK", until: null };
      } else if (failed.engine.running) {
        failed.engine.nextRunAt = await this.schedule();
      }
      await this.save(failed);
    }
  }

  async publicState() {
    const s = await super.publicState();
    const rate = ensureRateLimitState(s);
    s.version = APP_VERSION;
    s.safety = {
      ...(s.safety || {}),
      indodax429Recovery: "ACTIVE",
      rateLimitPolicy: INDODAX_RATE_LIMIT_POLICY,
      rateLimitStreak: Number(rate.streak || 0),
      rateLimitUntil: rate.until || null,
      rateLimitRecoveries: Number(rate.recoveries || 0),
    };
    return s;
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
        indodax429Recovery: "ACTIVE",
        rateLimitPolicy: INDODAX_RATE_LIMIT_POLICY,
        rateLimitBehavior: "THROTTLE_RETRY_BACKOFF_AUTO_RECOVER",
        strictEvidenceReset: false,
        liveExecution: "LOCKED",
      }, response.status);
    }
    return baseWorker.fetch(request, env);
  },
};
