function installCalibrationStyles() {
  if (document.getElementById("kaiTradCalibrationStyles")) return;
  const style = document.createElement("style");
  style.id = "kaiTradCalibrationStyles";
  style.textContent = `
    .calibration-block{display:none;margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.07)}
    .calibration-block.show{display:block}
    .calibration-block h4{margin:0 0 10px;font-size:13px}
    .calibration-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid rgba(255,255,255,.06);border-radius:12px}
    .calibration-table{width:100%;min-width:720px;border-collapse:collapse;font-size:9px}
    .calibration-table th,.calibration-table td{padding:10px 9px;text-align:right;border-bottom:1px solid rgba(255,255,255,.05);white-space:nowrap}
    .calibration-table th:first-child,.calibration-table td:first-child{text-align:left}
    .calibration-table th{color:var(--muted);font-size:8px;letter-spacing:.08em}
    .calibration-table tr:last-child td{border-bottom:0}
    .calibration-table .positive{color:var(--green)}
    .calibration-table .negative{color:var(--red)}
    .calibration-note{margin:10px 0 0;color:var(--muted);font-size:9px;line-height:1.55}
    .funnel-block{display:none;margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.07)}
    .funnel-block.show{display:block}
    .funnel-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .funnel-card{padding:12px;border:1px solid rgba(255,255,255,.06);border-radius:12px;background:rgba(255,255,255,.018)}
    .funnel-card strong{display:block;font-size:11px}
    .funnel-dominant{margin-top:6px;font-size:9px;color:var(--text)}
    .funnel-path,.funnel-breakdown{margin-top:6px;color:var(--muted);font-size:8px;line-height:1.55}
    @media(max-width:760px){.calibration-table{min-width:650px}.funnel-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function installCalibrationBlock() {
  if (document.getElementById("validationCalibration")) return;
  const diagnostics = document.getElementById("validationDiagnostics");
  const host = diagnostics?.parentNode || document.getElementById("validationLabCard");
  if (!host) return;
  const block = document.createElement("div");
  block.id = "validationCalibration";
  block.className = "calibration-block";
  block.innerHTML = `
    <h4>Scoring & Entry Calibration</h4>
    <div class="calibration-table-wrap">
      <table class="calibration-table">
        <thead><tr><th>PROFILE</th><th>ALIGNED</th><th>ELIGIBLE</th><th>TRADES</th><th>WIN %</th><th>PF</th><th>EXP</th><th>P&L</th><th>DD</th></tr></thead>
        <tbody id="calibrationRows"></tbody>
      </table>
    </div>
    <p id="calibrationNote" class="calibration-note">Historical experiment only. Production remains locked at threshold 70.</p>
    <div id="postAlignmentFunnel" class="funnel-block">
      <h4>Post-Alignment Funnel</h4>
      <div id="funnelRows" class="funnel-grid"></div>
      <p class="calibration-note">First-block diagnostics after score alignment. Production strategy is unchanged.</p>
    </div>
  `;
  host.appendChild(block);
}

const num = (v, digits = 2) => Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : "—";
const usd = (v) => Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : "—";

const FUNNEL_LABELS = {
  ABNORMAL_MARKET: "ABNORMAL MARKET",
  LIQUIDITY: "LIQUIDITY",
  BEARISH_REGIME: "BEARISH REGIME",
  SIDEWAYS_QUALITY: "SIDEWAYS QUALITY",
  BULLISH_QUALITY: "BULLISH QUALITY",
  COOLDOWN: "COOLDOWN",
  DAILY_LOSS: "DAILY LOSS",
  NONE: "NONE",
};

function renderFunnel(funnel) {
  const block = document.getElementById("postAlignmentFunnel");
  const host = document.getElementById("funnelRows");
  if (!block || !host || !Array.isArray(funnel?.rows)) return;
  block.classList.add("show");
  host.innerHTML = funnel.rows.map((row) => {
    const b = row.blockers || {};
    const s = row.survivors || {};
    const d = row.dominantBlocker || {};
    return `<div class="funnel-card">
      <strong>${row.label || row.id}</strong>
      <div class="funnel-dominant">TOP: ${FUNNEL_LABELS[d.code] || d.code || "—"} ${d.count || 0} (${num(d.pct || 0, 1)}%)</div>
      <div class="funnel-breakdown">ABN ${b.abnormalMarket || 0} • LIQ ${b.liquidity || 0} • BEAR ${b.bearishRegime || 0} • SIDE Q ${b.sidewaysQuality || 0} • BULL Q ${b.bullishQuality || 0} • COOL ${b.cooldown || 0} • DAY ${b.dailyLoss || 0}</div>
      <div class="funnel-path">SURVIVE: ${s.aligned || 0} → ${s.afterAbnormal || 0} → ${s.afterLiquidity || 0} → ${s.afterBearish || 0} → ${s.afterQuality || 0} → ${s.preRiskEligible || 0} → ${s.finalEligible || 0}</div>
    </div>`;
  }).join("");
}

function renderCalibration(calibration) {
  installCalibrationStyles();
  installCalibrationBlock();
  const block = document.getElementById("validationCalibration");
  const body = document.getElementById("calibrationRows");
  if (!block || !body || !calibration?.profiles) return;

  block.classList.add("show");
  body.innerHTML = calibration.profiles.map((row) => {
    const m = row.metrics || {};
    const pnlClass = Number(m.netPnl) > 0 ? "positive" : Number(m.netPnl) < 0 ? "negative" : "";
    const pf = m.profitFactor == null ? (Number(m.closedTrades) ? "∞" : "—") : num(m.profitFactor, 2);
    return `<tr>
      <td><strong>${row.label || row.id}</strong><br><small>${m.sampleStatus || "LOW_SAMPLE"}</small></td>
      <td>${row.alignedSignals || 0}</td>
      <td>${row.eligibleSignals || 0}</td>
      <td>${m.closedTrades || 0}</td>
      <td>${Number(m.closedTrades) ? `${num(m.winRatePct, 1)}%` : "—"}</td>
      <td>${pf}</td>
      <td>${Number(m.closedTrades) ? usd(m.expectancyUsd) : "—"}</td>
      <td class="${pnlClass}">${usd(m.netPnl || 0)}</td>
      <td>${num(m.maxDrawdownPct || 0, 2)}%</td>
    </tr>`;
  }).join("");

  const note = document.getElementById("calibrationNote");
  if (note) {
    note.textContent = `Historical only • ${calibration.decisions || 0} decisions • production threshold ${calibration.productionThreshold || 70} tetap aktif • tidak ada profile yang otomatis dipromosikan.`;
  }
  renderFunnel(calibration.funnel);
  window.KAITradVolumeAuditUI?.render(calibration.volumeAudit);
}

installCalibrationStyles();
installCalibrationBlock();
window.KAITradCalibrationUI = { render: renderCalibration };
