const round = (n, d = 8) => Number(Number(n || 0).toFixed(d));

export const EVIDENCE_COST_MODEL = "V2_FEE_BIDASK";

export function buildEvidenceStats({
  trades = [],
  account = {},
  minClosed = 100,
  targetClosed = 200,
  feeRatePerSide = 0.001,
} = {}) {
  const allClosed = (Array.isArray(trades) ? trades : [])
    .filter((t) => t?.side === "SELL" && Number.isFinite(Number(t.pnl)))
    .slice()
    .sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));

  const closed = allClosed.filter((t) =>
    t?.evidenceEligible === true &&
    t?.costModelVersion === EVIDENCE_COST_MODEL &&
    Number.isFinite(Number(t.entryNotional)) && Number(t.entryNotional) > 0
  );

  const wins = closed.filter((t) => Number(t.pnl) >= 0);
  const losses = closed.filter((t) => Number(t.pnl) < 0);
  const netPnl = closed.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
  const grossPnl = closed.reduce((sum, t) => sum + Number(t.grossPnlBeforeCosts || 0), 0);
  const tradingCosts = closed.reduce((sum, t) => sum + Number(t.tradingCostUsd || 0), 0);
  const grossProfit = wins.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + Number(t.pnl || 0), 0));

  const avg = (rows, field) => rows.length
    ? rows.reduce((sum, t) => sum + Number(t?.[field] || 0), 0) / rows.length
    : 0;

  const netExpectancyUsd = closed.length ? netPnl / closed.length : 0;
  const grossExpectancyUsd = closed.length ? grossPnl / closed.length : 0;
  const netExpectancyPct = avg(closed, "netPnlPct");
  const grossExpectancyPct = avg(closed, "grossPnlPct");
  const avgTradingCostPct = avg(closed, "tradingCostPct");
  const avgWinPct = avg(wins, "netPnlPct");
  const avgLossPct = avg(losses, "netPnlPct");
  const positiveEdge = closed.length > 0 && netExpectancyUsd > 0 && netExpectancyPct > 0;

  const minN = Math.max(1, Math.round(Number(minClosed) || 100));
  const targetN = Math.max(minN, Math.round(Number(targetClosed) || 200));
  let status = "TEST_HIGH_POTENTIAL";
  if (closed.length >= 30 && closed.length < minN) {
    status = positiveEdge ? "TEST_POSITIVE_EARLY" : "TEST_EDGE_NOT_PROVEN";
  } else if (closed.length >= minN && closed.length < targetN) {
    status = positiveEdge ? "REVIEW_WINDOW" : "TEST_EDGE_NOT_PROVEN";
  } else if (closed.length >= targetN) {
    status = positiveEdge ? "EVIDENCE_COMPLETE_OWNER_REVIEW" : "TEST_NO_POSITIVE_EDGE";
  }

  return {
    program: "KAI_SANBAN_100_200",
    status,
    recommendation: "TEST",
    closedTrades: closed.length,
    legacyClosedTrades: Math.max(0, allClosed.length - closed.length),
    minClosedTrades: minN,
    targetClosedTrades: targetN,
    progressToMinPct: round(Math.min(100, closed.length / minN * 100), 1),
    progressToTargetPct: round(Math.min(100, closed.length / targetN * 100), 1),
    wins: wins.length,
    losses: losses.length,
    winRatePct: closed.length ? round(wins.length / closed.length * 100, 2) : 0,
    netPnlUsd: round(netPnl, 2),
    grossPnlBeforeCostsUsd: round(grossPnl, 2),
    tradingCostsUsd: round(tradingCosts, 2),
    netExpectancyUsd: round(netExpectancyUsd, 4),
    grossExpectancyUsd: round(grossExpectancyUsd, 4),
    netExpectancyPct: round(netExpectancyPct, 4),
    grossExpectancyPct: round(grossExpectancyPct, 4),
    avgTradingCostPct: round(avgTradingCostPct, 4),
    avgWinPct: round(avgWinPct, 4),
    avgLossPct: round(avgLossPct, 4),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 3) : (grossProfit > 0 ? null : 0),
    maxDrawdownPct: round(Number(account?.maxDrawdownPct || 0), 3),
    feeRatePerSidePct: round(Number(feeRatePerSide || 0) * 100, 4),
    baselineRoundTripFeePct: round(Number(feeRatePerSide || 0) * 200, 4),
    costModelVersion: EVIDENCE_COST_MODEL,
    spreadModel: "INDODAX_LIVE_BID_ASK",
    costsIncluded: ["ENTRY_FEE", "EXIT_FEE", "ENTRY_HALF_SPREAD", "EXIT_HALF_SPREAD"],
    positiveEdge,
    liveGate: "LOCKED",
    goLive: false,
    ownerApprovalRequired: true,
    note: closed.length < minN
      ? `Collect ${minN}-${targetN} cost-modeled PAPER closed trades before any live-money review.`
      : "Evidence threshold reached. LIVE remains locked pending owner review; no automatic unlock.",
  };
}
