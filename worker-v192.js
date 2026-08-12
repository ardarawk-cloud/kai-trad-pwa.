import baseWorker, { TradingState as BaseTradingState } from "./worker.js";
import {
  APP_VERSION,
  assessMultiTimeframeLiquidity,
  shouldDeduplicateWait,
} from "./qc-v192.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

export class TradingState extends BaseTradingState {
  async state() {
    const s = await super.state();
    s.version = APP_VERSION;
    return s;
  }

  async scanSymbol(baseUrl, s, symbol) {
    const result = await super.scanSymbol(baseUrl, s, symbol);
    const liquidity = assessMultiTimeframeLiquidity(result.mainCandles, result.fastCandles);

    result.analysis.liquidity = liquidity;
    result.analysis.main.indicators.liquidityHealthy = liquidity.healthy;
    result.analysis.main.indicators.volumeActivePct = liquidity.main.activePct;
    result.analysis.fast.indicators.liquidityHealthy = liquidity.healthy;
    result.analysis.fast.indicators.volumeActivePct = liquidity.fast.activePct;
    result.liquidity = liquidity;

    if (!liquidity.healthy) {
      result.entryEligible = false;
      result.tradeQuality = Math.min(Number(result.tradeQuality || 0), 35);
    }
    return result;
  }

  async runCycle(manual = false) {
    const before = await this.state();
    const previousDecisionCandle = before.signal?.decisionCandle ?? null;
    const s = await super.runCycle(manual);
    let changed = false;

    const liquidityBlocked = s.signal?.action === "HOLD" &&
      s.signal?.deterministicAction === "BUY" &&
      s.signal?.reason !== "WAIT_NEXT_CLOSED_CANDLE" &&
      s.signal?.indicators?.liquidityHealthy === false;

    if (liquidityBlocked) {
      s.signal.reason = "LIQUIDITY_DATA_GUARD";
      if (s.signals?.[0]?.id === s.signal.id) s.signals[0].reason = "LIQUIDITY_DATA_GUARD";
      if (s.decisionLog?.[0]?.at === s.signal.at && s.decisionLog?.[0]?.symbol === s.signal.symbol) {
        s.decisionLog[0].reason = "LIQUIDITY_DATA_GUARD";
      }
      changed = true;
    }

    const duplicateWait = shouldDeduplicateWait({
      previousDecisionCandle,
      currentDecisionCandle: s.signal?.decisionCandle ?? null,
      reason: s.signal?.reason,
    });

    if (duplicateWait) {
      if (s.signals?.[0]?.id === s.signal?.id) s.signals.shift();
      if (s.decisionLog?.[0]?.at === s.signal?.at && s.decisionLog?.[0]?.reason === "WAIT_NEXT_CLOSED_CANDLE") {
        s.decisionLog.shift();
      }
      changed = true;
    }

    if (changed) await this.save(s);
    return s;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "KAI TRAD",
        version: APP_VERSION,
        mode: env.TRADING_MODE === "live" ? "live" : "paper",
        broker: String(env.PRIMARY_BROKER || "indodax").toLowerCase(),
        adminConfigured: Boolean(env.ADMIN_TOKEN),
        brokerCredentialsConfigured: Boolean(env.TOKOCRYPTO_API_KEY) && Boolean(env.TOKOCRYPTO_API_SECRET),
        liveStage: env.BROKER_LIVE_STAGE || "LOCKED",
        liveExecutionEnabled: env.ENABLE_LIVE_EXECUTION === "YES_I_ACCEPT_RISK",
        liquidityGuard: "ACTIVE",
        decisionLogDedup: "ACTIVE",
        time: new Date().toISOString(),
      });
    }
    return baseWorker.fetch(request, env);
  },
};
