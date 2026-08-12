const $v = (id) => document.getElementById(id);

function validationAuthHeaders() {
  const token = localStorage.getItem("kaiTradAdminToken") || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function installValidationStyles() {
  if (document.getElementById("kaiTradValidationStyles")) return;
  const style = document.createElement("style");
  style.id = "kaiTradValidationStyles";
  style.textContent = `
    .validation-card{padding:20px;margin-bottom:12px;content-visibility:auto;contain-intrinsic-size:auto 420px}
    .validation-controls{display:grid;grid-template-columns:1fr 1fr 1.25fr;gap:10px;margin-top:16px}
    .validation-controls label{color:var(--muted);font-size:9px;letter-spacing:.1em;font-weight:700}
    .validation-controls select{width:100%;margin-top:7px;background:#0c0c0c;border:1px solid rgba(255,255,255,.1);border-radius:11px;padding:10px;color:var(--text)}
    .validation-controls button{align-self:end;min-height:40px}
    .validation-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-top:16px}
    .validation-grid>div{padding:12px;background:rgba(255,255,255,.018);border:1px solid rgba(255,255,255,.05);border-radius:12px}
    .validation-grid span{display:block;color:var(--muted);font-size:8px;letter-spacing:.1em;font-weight:700}
    .validation-grid strong{display:block;margin-top:6px;font-size:13px}
    .validation-note{margin-top:13px;color:var(--muted);font-size:10px;line-height:1.55}
    .validation-note strong{color:#d5d5d5}
    .validation-error{color:var(--red)!important}
    @media(max-width:760px){
      .validation-card{background:#0d0d0d!important;box-shadow:0 8px 24px rgba(0,0,0,.32)!important;backdrop-filter:none!important}
      .validation-controls{grid-template-columns:1fr 1fr}.validation-controls button{grid-column:1/-1}
      .validation-grid{grid-template-columns:1fr 1fr 1fr}
    }
  `;
  document.head.appendChild(style);
}

function installValidationCard() {
  if ($v("validationLabCard")) return;
  const card = document.createElement("section");
  card.id = "validationLabCard";
  card.className = "card validation-card";
  card.innerHTML = `
    <div class="section-title">
      <div><span class="eyebrow">STRATEGY VALIDATION LAB</span><h3>Historical Replay / Backtest</h3></div>
      <span id="validationBadge" class="badge muted">READY</span>
    </div>
    <div class="validation-controls">
      <label>MARKET
        <select id="validationSymbol">
          <option>BTCUSDT</option><option>ETHUSDT</option><option>BNBUSDT</option><option>SOLUSDT</option><option>XRPUSDT</option>
        </select>
      </label>
      <label>WINDOW
        <select id="validationDays"><option value="1">1 day</option><option value="3" selected>3 days</option><option value="7">7 days</option></select>
      </label>
      <button id="validationRun" class="btn scan-control">◎ RUN BACKTEST</button>
    </div>
    <div class="validation-grid">
      <div><span>CLOSED TRADES</span><strong id="validationTrades">—</strong></div>
      <div><span>WIN RATE</span><strong id="validationWin">—</strong></div>
      <div><span>PROFIT FACTOR</span><strong id="validationPf">—</strong></div>
      <div><span>EXPECTANCY</span><strong id="validationExpectancy">—</strong></div>
      <div><span>NET P&L</span><strong id="validationPnl">—</strong></div>
      <div><span>MAX DD</span><strong id="validationDd">—</strong></div>
    </div>
    <p id="validationNote" class="validation-note"><strong>Historical deterministic pre-AI replay.</strong> Tidak mengirim order, tidak memakai private API, dan tidak menggantikan forward-test PAPER.</p>
  `;
  const decisionCard = document.querySelector(".decision-card");
  if (decisionCard?.parentNode) decisionCard.parentNode.insertBefore(card, decisionCard);
  else document.querySelector("main.shell")?.appendChild(card);
}

const usd = (n) => Number.isFinite(Number(n)) ? `$${Number(n).toFixed(2)}` : "—";
const pct = (n) => Number.isFinite(Number(n)) ? `${Number(n).toFixed(2)}%` : "—";

async function fetchCurrentConfig() {
  const res = await fetch("/api/state", { cache: "no-store", headers: validationAuthHeaders() });
  if (!res.ok) return {};
  const state = await res.json().catch(() => ({}));
  return state?.config || {};
}

function renderValidation(result) {
  const m = result?.metrics || {};
  const c = result?.counters || {};
  $v("validationTrades").textContent = m.closedTrades ?? 0;
  $v("validationWin").textContent = m.closedTrades ? pct(m.winRatePct) : "—";
  $v("validationPf").textContent = m.profitFactor == null ? (m.closedTrades ? "∞" : "—") : Number(m.profitFactor).toFixed(2);
  $v("validationExpectancy").textContent = m.closedTrades ? usd(m.expectancyUsd) : "—";
  $v("validationPnl").textContent = usd(m.netPnl);
  $v("validationPnl").className = Number(m.netPnl) > 0 ? "positive" : Number(m.netPnl) < 0 ? "negative" : "";
  $v("validationDd").textContent = pct(m.maxDrawdownPct);
  $v("validationBadge").textContent = String(m.sampleStatus || "DONE").replaceAll("_", " ");
  $v("validationBadge").className = `badge ${m.closedTrades >= 10 ? "good" : "muted"}`;
  $v("validationNote").className = "validation-note";
  $v("validationNote").innerHTML = `<strong>${result.symbol} • ${result.request?.days || "—"}d • ${result.sample?.decisions || 0} decisions</strong> • PRE-AI eligible BUY ${c.eligibleBuySignals || 0} • liquidity blocked ${c.liquidityBlocked || 0} • fees ${usd(m.estimatedFeesUsd || 0)}.<br>AI veto tidak direplay; forward-test PAPER tetap sumber validasi final.`;
}

async function runValidation() {
  const btn = $v("validationRun");
  if (!btn) return;
  btn.disabled = true;
  const badge = $v("validationBadge");
  badge.textContent = "RUNNING";
  badge.className = "badge paper";
  $v("validationNote").className = "validation-note";
  $v("validationNote").textContent = "Mengambil OHLC publik Indodax dan menjalankan replay strategy core. Tidak ada order yang dikirim.";

  try {
    const cfg = await fetchCurrentConfig();
    const body = {
      symbol: $v("validationSymbol").value,
      days: Number($v("validationDays").value),
      startingBalance: cfg.paperStartingBalanceUsd,
      riskPerTrade: cfg.riskPerTrade,
      maxPositionPct: cfg.maxPositionPct,
      maxDailyLossPct: cfg.maxDailyLossPct,
      minSignalConfidence: cfg.minSignalConfidence,
      maxConsecutiveLosses: cfg.maxConsecutiveLosses,
      lossStreakCooldownMinutes: cfg.lossStreakCooldownMinutes,
    };
    const res = await fetch("/api/backtest", {
      method: "POST",
      headers: { "content-type": "application/json", ...validationAuthHeaders() },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderValidation(data);
  } catch (e) {
    badge.textContent = "FAILED";
    badge.className = "badge live";
    $v("validationNote").className = "validation-note validation-error";
    $v("validationNote").textContent = e.message || "Backtest gagal";
  } finally {
    btn.disabled = false;
  }
}

function initValidationLab() {
  installValidationStyles();
  installValidationCard();
  const select = $v("validationSymbol");
  const active = document.getElementById("symbol")?.textContent?.trim();
  if (select && active && [...select.options].some((o) => o.value === active)) select.value = active;
  const run = $v("validationRun");
  if (run && run.dataset.bound !== "1") {
    run.dataset.bound = "1";
    run.addEventListener("click", runValidation);
  }
}

if (document.readyState === "loading") window.addEventListener("load", initValidationLab, { once: true });
else initValidationLab();
