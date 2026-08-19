import baseWorker, { TradingState as BaseTradingState } from "./worker-v1111.js";
import { realizedPnlForWitaDay, witaDayFromTs } from "./daily-goal-v1112.js";

const APP_VERSION = "1.11.1";
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const round = (n, d = 8) => Number(Number(n || 0).toFixed(d));

export class TradingState extends BaseTradingState {
  async state() {
    const s = await super.state();
    s.version = APP_VERSION;
    return s;
  }

  async publicState() {
    const s = await super.publicState();
    const day = witaDayFromTs();
    const realizedTodayUsd = realizedPnlForWitaDay(s.trades || [], day);
    const rate = Number(s.financeDisplay?.usdIdrRate || s.config?.usdIdrRate || 0);
    const oldGoal = s.financeDisplay?.dailyGoal || {};
    const minUsd = Number(oldGoal.minUsd || 0);
    const markToMarketTodayUsd = Number(oldGoal.todayUsd ?? s.account?.dailyPnl ?? 0);
    const positiveRealized = Math.max(0, realizedTodayUsd);

    s.financeDisplay ||= {};
    s.financeDisplay.dailyGoal = {
      ...oldGoal,
      basis: "REALIZED_WITA_CLOSED_TRADES",
      day,
      markToMarketTodayUsd: round(markToMarketTodayUsd, 2),
      markToMarketTodayIdr: round(markToMarketTodayUsd * rate, 0),
      realizedTodayUsd: round(realizedTodayUsd, 2),
      realizedTodayIdr: round(realizedTodayUsd * rate, 0),
      todayUsd: round(realizedTodayUsd, 2),
      todayIdr: round(realizedTodayUsd * rate, 0),
      progressPct: minUsd > 0
        ? round(Math.max(0, Math.min(100, positiveRealized / minUsd * 100)), 1)
        : 0,
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
        dailyGoalBasis: "REALIZED_WITA_CLOSED_TRADES",
        unrealizedCanTriggerDailyGoal: false,
      }, response.status);
    }
    return baseWorker.fetch(request, env);
  },
};
