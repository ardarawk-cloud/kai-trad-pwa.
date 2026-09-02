import baseWorker, { TradingState as BaseTradingState } from "./worker-v1114.js";
import {
  LOSS_STREAK_DISPLAY_POLICY,
  canonicalActiveLossStreak,
  historicalMaxLossStreak,
} from "./loss-streak-display-v1114.js";

const APP_VERSION = "1.11.4";
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

export { canonicalActiveLossStreak, historicalMaxLossStreak };

export class TradingState extends BaseTradingState {
  async state() {
    const s = await super.state();
    s.version = APP_VERSION;
    return s;
  }

  async publicState() {
    const s = await super.publicState();
    const activeLossStreak = canonicalActiveLossStreak(s);
    const historicalMax = historicalMaxLossStreak(s);

    s.version = APP_VERSION;
    s.safety = {
      ...(s.safety || {}),
      consecutiveLosses: activeLossStreak,
      historicalMaxConsecutiveLosses: historicalMax,
      lossStreakDisplayBasis: "ACCOUNT_ACTIVE_STREAK",
      lossStreakDisplayPolicy: LOSS_STREAK_DISPLAY_POLICY,
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
        lossStreakDisplayBasis: "ACCOUNT_ACTIVE_STREAK",
        lossStreakDisplayPolicy: LOSS_STREAK_DISPLAY_POLICY,
        strictEvidenceReset: false,
        liveExecution: "LOCKED",
      }, response.status);
    }
    return baseWorker.fetch(request, env);
  },
};
