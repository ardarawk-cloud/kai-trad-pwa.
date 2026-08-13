import baseWorker, { TradingState as BaseTradingState } from "./worker-v1103.js";
import { fetchIndodaxHistoryRange } from "./indodax-history-v110.js";
import { runStrategyReplay } from "./backtest-v110.js";
import { diagnoseEntryRejections } from "./diagnostics-v1101.js";
import { runCalibrationLab } from "./calibration-v1102.js";
import { buildPostAlignmentFunnel } from "./funnel-v1103.js";
import { runVolumeIntegrityAudit } from "./volume-audit-v1104.js";

const APP_VERSION = "1.10.4";
const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"]);

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
});

function authorized(request, env) {
  if (!env.ADMIN_TOKEN) return true;
  const auth = request.headers.get("authorization") || "";
  const direct = request.headers.get("x-admin-token") || "";
  return auth === `Bearer ${env.ADMIN_TOKEN}` || direct === env.ADMIN_TOKEN;
}

function safeBacktestInput(body = {}, env = {}) {
  const symbol = String(body.symbol || env.SYMBOL || "BTCUSDT").toUpperCase();
  if (!ALLOWED_SYMBOLS.has(symbol)) throw new Error("Unsupported validation symbol");
  const days = Math.max(1, Math.min(7, Math.round(Number(body.days || 3))));
  return {
    symbol,
    days,
    config: {
      startingBalance: Number(body.startingBalance || env.STARTING_BALANCE || 10000),
      riskPerTrade: Number(body.riskPerTrade || env.RISK_PER_TRADE || 0.01),
      maxPositionPct: Number(body.maxPositionPct || env.MAX_POSITION_PCT || 0.20),
      maxDailyLossPct: Number(body.maxDailyLossPct || env.MAX_DAILY_LOSS_PCT || 0.03),
      minSignalConfidence: Number(body.minSignalConfidence || env.MIN_SIGNAL_CONFIDENCE || 70),
      maxConsecutiveLosses: Number(body.maxConsecutiveLosses || env.MAX_CONSECUTIVE_LOSSES || 3),
      lossStreakCooldownMinutes: Number(body.lossStreakCooldownMinutes || env.LOSS_STREAK_COOLDOWN_MINUTES || 240),
    },
  };
}

export class TradingState extends BaseTradingState {
  async state() {
    const s = await super.state();
    s.version = APP_VERSION;
    return s;
  }
}

async function runValidation(request, env) {
  if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  let input;
  try {
    input = safeBacktestInput(body, env);
  } catch (e) {
    return json({ error: e.message }, 400);
  }

  const toMs = Date.now();
  const startMs = toMs - input.days * DAY_MS;
  const warmupFromMs = startMs - DAY_MS;
  const baseUrl = env.INDODAX_API_BASE_URL || env.MARKET_DATA_BASE_URL || "https://indodax.com";

  try {
    const [mainCandles, fastCandles] = await Promise.all([
      fetchIndodaxHistoryRange({
        baseUrl,
        symbol: input.symbol,
        interval: "15m",
        fromMs: warmupFromMs,
        toMs,
        maxDays: 8,
      }),
      fetchIndodaxHistoryRange({
        baseUrl,
        symbol: input.symbol,
        interval: "5m",
        fromMs: warmupFromMs,
        toMs,
        maxDays: 8,
      }),
    ]);

    const result = runStrategyReplay({
      symbol: input.symbol,
      mainCandles,
      fastCandles,
      startMs,
      config: input.config,
    });
    const diagnostics = diagnoseEntryRejections({
      mainCandles,
      fastCandles,
      startMs,
      minSignalConfidence: input.config.minSignalConfidence,
      thresholds: [70, 65, 60],
    });
    const calibration = runCalibrationLab({
      mainCandles,
      fastCandles,
      startMs,
      config: input.config,
    });
    calibration.funnel = buildPostAlignmentFunnel(calibration);
    const volumeAudit = runVolumeIntegrityAudit({
      mainCandles,
      fastCandles,
      startMs,
    });

    return json({
      ok: true,
      ...result,
      version: APP_VERSION,
      diagnostics,
      calibration,
      volumeAudit,
      request: {
        days: input.days,
        mainInterval: "15m",
        fastInterval: "5m",
        generatedAt: new Date().toISOString(),
      },
      safety: {
        orderExecution: false,
        privateApi: false,
        tradingMode: "HISTORICAL_REPLAY_ONLY",
        productionCalibrationApplied: false,
        productionFunnelApplied: false,
        productionVolumeAuditApplied: false,
      },
    });
  } catch (e) {
    return json({
      error: `Validation lab failed: ${String(e?.message || e).slice(0, 220)}`,
      orderExecution: false,
    }, 502);
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
        liveStage: env.BROKER_LIVE_STAGE || "LOCKED",
        liveExecutionEnabled: env.ENABLE_LIVE_EXECUTION === "YES_I_ACCEPT_RISK",
        validationLab: "ACTIVE",
        rejectionDiagnostics: "ACTIVE",
        calibrationLab: "ACTIVE",
        postAlignmentFunnel: "ACTIVE",
        volumeIntegrityAudit: "ACTIVE",
        volumeNeutralScoringAudit: "ACTIVE",
        calibrationProfiles: "LOCKED_70,CONSERVATIVE_65,BALANCED_60,EXPLORATORY_55",
        productionThreshold: Number(env.MIN_SIGNAL_CONFIDENCE || 70),
        productionCalibrationApplied: false,
        productionVolumeAuditApplied: false,
        liquidityGuard: "ACTIVE",
        decisionLogDedup: "ACTIVE",
        mobilePerformance: "ACTIVE",
        time: new Date().toISOString(),
      });
    }
    if (url.pathname === "/api/backtest" && request.method === "POST") {
      return runValidation(request, env);
    }
    return baseWorker.fetch(request, env);
  },
};
