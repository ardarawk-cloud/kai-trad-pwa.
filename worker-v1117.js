import baseWorker, { TradingState as BaseTradingState } from "./worker-v1116.js";
import { SCANNER_SUBREQUEST_POLICY, DEFAULT_SCANNER_BATCH_SIZE } from "./scanner-budget-v1116.js";

const APP_VERSION = "1.11.6";
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

  async publicState() {
    const s = await super.publicState();
    s.version = APP_VERSION;
    s.safety = {
      ...(s.safety || {}),
      scannerSubrequestPolicy: SCANNER_SUBREQUEST_POLICY,
      scannerBatchSize: DEFAULT_SCANNER_BATCH_SIZE,
      indodax429Recovery: "ACTIVE",
      sameInvocation429Retry: "DISABLED",
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
        scannerSubrequestPolicy: SCANNER_SUBREQUEST_POLICY,
        scannerBatchSize: DEFAULT_SCANNER_BATCH_SIZE,
        scannerUniverseRotation: "ACTIVE",
        indodax429Recovery: "ACTIVE",
        sameInvocation429Retry: "DISABLED",
        rateLimitBehavior: "FAIL_FAST_BACKOFF_NEXT_ALARM",
        strictEvidenceReset: false,
        liveExecution: "LOCKED",
      }, response.status);
    }
    return baseWorker.fetch(request, env);
  },
};
