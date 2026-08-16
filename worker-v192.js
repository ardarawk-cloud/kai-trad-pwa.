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

function paperTrialEnabled(env) {
  return env.TRADING_MODE !== "live" && String(env.PAPER_TRIAL_MODE || "").toUpperCase() === "SAMPLE_10";
}

export class TradingState extends BaseTradingState {
  async state() {
    const s = await super.state();
    s.version = APP_VERSION;

    // PAPER-only sampling mode: create enough simulated decisions/trades to validate
    // the execution engine. Live execution gates and core loss controls remain untouched.
    if (paperTrialEnabled(this.env)) {
      s.config.minSignalConfidence = Number(this.env.PAPER_TRIAL_MIN_SIGNAL_CONFIDENCE || 60);
      s.config.aiValidation = String(this.env.PAPER_TRIAL_AI_VALIDATION || "false") === "true";
    }
    return s;
  }

  async scanSymbol(baseUrl, s, symbol) {
    const result = await super.scanSymbol(baseUrl, s, symbol);
    const trial = paperTrialEnabled(this.env);
    const liquidityOptions = trial
      ? { minActiveRatio: Number(this.env.PAPER_TRIAL_MIN_ACTIVE_RATIO || 0.30) }
      : undefined;
    const liquidity = assessMultiTimeframeLiquidity(result.mainCandles, result.fastCandles, liquidityOptions);

    result.analysis.liquidity = liquidity;
    result.analysis.main.indicators.liquidityHealthy = liquidity.healthy;
    result.analysis.main.indicators.volumeActivePct = liquidity.main.activePct;
    result.analysis.fast.indicators.liquidityHealthy = liquidity.healthy;
    result.analysis.fast.indicators.volumeActivePct = liquidity.fast.activePct;
    result.liquidity = liquidity;

    // Normal production behavior: unhealthy liquidity is a hard entry veto.
    // SAMPLE_10 PAPER trial behavior: keep measuring/logging liquidity, but do not
    // veto an otherwise eligible simulated entry. This lets us collect execution
    // samples while preserving all live gates, abnormal-market protection and
    // loss/risk controls. Never applies when TRADING_MODE=live.
    if (!liquidity.healthy && !trial) {
      result.entryEligible = false;
      result.tradeQuality = Math.min(Number(result.tradeQuality || 0), 35);
    }
    if (!liquidity.healthy && trial) {
      result.liquidity.paperTrialObserveOnly = true;
    }
    return result;
  }

  async runCycle(manual = false) {
    const before = await this.state();
    const previousDecisionCandle = before.signal?.decisionCandle ?? null;
    const s = await super.runCycle(manual);
    let changed = false;

    const trial = paperTrialEnabled(this.env);
    const liquidityBlocked = !trial && s.signal?.action === "HOLD" &&
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
      const trial = paperTrialEnabled(env);
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
        liquidityGuard: trial ? "OBSERVE_ONLY_PAPER_SAMPLE_10" : "ACTIVE",
        paperTrial: trial ? {
          mode: "SAMPLE_10",
          minSignalConfidence: Number(env.PAPER_TRIAL_MIN_SIGNAL_CONFIDENCE || 60),
          minLiquidityActiveRatio: Number(env.PAPER_TRIAL_MIN_ACTIVE_RATIO || 0.30),
          liquidityVeto: false,
          aiValidation: String(env.PAPER_TRIAL_AI_VALIDATION || "false") === "true",
        } : null,
        decisionLogDedup: "ACTIVE",
        time: new Date().toISOString(),
      });
    }
    return baseWorker.fetch(request, env);
  },
};
