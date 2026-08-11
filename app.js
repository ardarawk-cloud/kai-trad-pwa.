const $ = (id) => document.getElementById(id);
let state = null;
let health = null;
let deferredInstall = null;
let pollTimer = null;

const money = (n) => Number.isFinite(Number(n)) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(n)) : "—";
const priceFmt = (n) => Number.isFinite(Number(n)) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: Number(n) < 10 ? 6 : 2 }).format(Number(n)) : "—";
const pct = (n) => Number.isFinite(Number(n)) ? `${Number(n).toFixed(2)}%` : "—";
const timeWita = (v) => v ? new Date(v).toLocaleString("id-ID", { timeZone: "Asia/Makassar", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

function token() { return localStorage.getItem("kaiTradAdminToken") || ""; }
function authHeaders() { return token() ? { Authorization: `Bearer ${token()}` } : {}; }

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...authHeaders(), ...(options.headers || {}) },
  });
  if (res.status === 401) {
    $("authBox").classList.remove("hidden");
    throw new Error("ADMIN_TOKEN diperlukan");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  $("authBox").classList.add("hidden");
  return data;
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add("hidden"), 2200);
}

function setSigned(el, value, formatted = null) {
  el.textContent = formatted ?? value;
  el.classList.remove("positive", "negative");
  if (Number(value) > 0) el.classList.add("positive");
  if (Number(value) < 0) el.classList.add("negative");
}

function renderChart(points = []) {
  const canvas = $("priceChart");
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const candles = points.map((x, i, arr) => {
    if (x && ["o", "h", "l", "c"].every((k) => Number.isFinite(Number(x[k])))) {
      return { t: x.t, o: Number(x.o), h: Number(x.h), l: Number(x.l), c: Number(x.c) };
    }
    if (x && Number.isFinite(Number(x.p))) {
      const prev = i > 0 && Number.isFinite(Number(arr[i - 1]?.p)) ? Number(arr[i - 1].p) : Number(x.p);
      return { t: x.t, o: prev, h: Math.max(prev, Number(x.p)), l: Math.min(prev, Number(x.p)), c: Number(x.p) };
    }
    return null;
  }).filter(Boolean);

  if (candles.length < 2) {
    ctx.fillStyle = "rgba(190,190,190,.75)";
    ctx.font = "12px system-ui";
    ctx.fillText("Menunggu data market…", 12, rect.height / 2);
    return;
  }

  const highs = candles.map((x) => x.h);
  const lows = candles.map((x) => x.l);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = Math.max(max - min, max * 0.001);
  const pad = 10;
  const plotW = rect.width - pad * 2;
  const plotH = rect.height - pad * 2;
  const slot = plotW / candles.length;
  const bodyW = Math.max(3, Math.min(10, slot * 0.58));
  const y = (p) => rect.height - pad - ((p - min) / span) * plotH;

  ctx.strokeStyle = "rgba(255,255,255,.06)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const gy = pad + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad, gy);
    ctx.lineTo(rect.width - pad, gy);
    ctx.stroke();
  }

  candles.forEach((c, i) => {
    const cx = pad + slot * i + slot / 2;
    const yo = y(c.o), yh = y(c.h), yl = y(c.l), yc = y(c.c);
    const up = c.c >= c.o;
    const wickColor = up ? "rgba(245,245,245,.9)" : "rgba(148,148,148,.95)";
    const bodyColor = up ? "#f2f2f2" : "#707070";
    ctx.strokeStyle = wickColor;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(cx, yh);
    ctx.lineTo(cx, yl);
    ctx.stroke();

    const top = Math.min(yo, yc);
    const bottom = Math.max(yo, yc);
    const height = Math.max(1.5, bottom - top);
    ctx.fillStyle = bodyColor;
    ctx.fillRect(cx - bodyW / 2, top, bodyW, height);
    ctx.strokeStyle = bodyColor;
    ctx.strokeRect(cx - bodyW / 2, top, bodyW, height);
  });
}

function renderTrades(trades = []) {
  $("tradeCount").textContent = `${trades.length} records`;
  const list = $("tradeList");
  if (!trades.length) {
    list.innerHTML = '<div class="empty">Belum ada transaksi.</div>';
    return;
  }
  list.innerHTML = trades.slice(0, 12).map((t) => `
    <div class="trade-row">
      <div class="side ${t.side === "BUY" ? "positive" : "negative"}">${t.side}<small>${t.mode.toUpperCase()}</small></div>
      <div>${t.symbol}<small>${timeWita(t.at)}</small></div>
      <div>${priceFmt(t.price)}<small>Price</small></div>
      <div>${money(t.notional)}<small>Notional</small></div>
      <div class="${Number(t.pnl) > 0 ? "positive" : Number(t.pnl) < 0 ? "negative" : ""}">${t.pnl == null ? "—" : money(t.pnl)}<small>${t.reason || "Execution"}</small></div>
    </div>`).join("");
}

function renderScanner(scanner = {}) {
  const list = $("scannerList");
  if (!list) return;
  const rows = Array.isArray(scanner.symbols) ? scanner.symbols : [];
  $("scannerStatus").textContent = rows.length ? `${rows.length} markets • best ${scanner.bestSymbol || "—"}` : "Waiting scan";
  if (!rows.length) {
    list.innerHTML = '<div class="empty scanner-empty">Menunggu multi-coin scan…</div>';
    return;
  }
  list.innerHTML = rows.map((x) => `
    <div class="scanner-row ${x.rank === 1 ? "top" : ""}">
      <div class="scanner-rank">#${x.rank}</div>
      <div><strong>${x.symbol}</strong><small>${priceFmt(x.price)}</small></div>
      <div><span>BUY</span><strong class="${x.buyConfidence >= 70 ? "positive" : ""}">${x.buyConfidence}%</strong></div>
      <div><span>SIGNAL</span><strong class="signal ${(x.action || "HOLD").toLowerCase()}">${x.action || "HOLD"}</strong></div>
    </div>`).join("");
}

function fillSettings(s) {
  $("cfgSymbol").value = s.config.symbol;
  $("cfgInterval").value = s.config.interval;
  $("cfgFast").value = s.config.fastInterval;
  $("cfgRisk").value = (s.config.riskPerTrade * 100).toFixed(2);
  $("cfgPosition").value = (s.config.maxPositionPct * 100).toFixed(0);
  $("cfgLoss").value = (s.config.maxDailyLossPct * 100).toFixed(1);
  $("cfgConfidence").value = s.config.minSignalConfidence;
  $("cfgAi").checked = Boolean(s.config.aiValidation);
}

function render(s) {
  state = s;
  $("symbol").textContent = s.market?.symbol || s.position?.symbol || s.signal?.symbol || s.config.symbol;
  $("price").textContent = priceFmt(s.market?.price);
  $("modeBadge").textContent = s.mode.toUpperCase();
  $("modeBadge").className = `badge ${s.mode === "live" ? "live" : "paper"}`;

  const action = s.signal?.action || "HOLD";
  $("signalAction").textContent = action;
  $("signalAction").className = `signal ${action.toLowerCase()}`;
  $("confidence").textContent = s.signal ? `${s.signal.confidence}%` : "—";
  $("engineState").textContent = s.engine.running ? "RUNNING" : "STOPPED";
  $("engineState").className = s.engine.running ? "positive" : "";

  $("equity").textContent = money(s.account.equity);
  const totalReturn = s.account.startingBalance ? ((s.account.equity / s.account.startingBalance) - 1) * 100 : 0;
  setSigned($("equityDelta"), totalReturn, `${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(2)}% total`);
  setSigned($("dailyPnl"), s.account.dailyPnl, money(s.account.dailyPnl));
  $("dailyLimit").textContent = `Limit ${(s.config.maxDailyLossPct * 100).toFixed(1)}%`;
  setSigned($("realizedPnl"), s.account.realizedPnl, money(s.account.realizedPnl));
  const closed = s.account.wins + s.account.losses;
  $("winRate").textContent = closed ? `Win rate ${((s.account.wins / closed) * 100).toFixed(0)}% • ${closed} closed` : "Win rate —";
  $("drawdown").textContent = pct(s.account.maxDrawdownPct);
  $("drawdown").className = s.account.maxDrawdownPct > 3 ? "negative" : "";

  $("startBtn").disabled = s.engine.running;
  $("stopBtn").disabled = !s.engine.running;
  $("runBtn").disabled = s.engine.running;
  $("resetBtn").classList.toggle("hidden", s.mode !== "paper");
  $("engineError").textContent = s.engine.lastError || "";
  $("engineError").classList.toggle("hidden", !s.engine.lastError);

  if (s.position) {
    $("positionEmpty").classList.add("hidden");
    $("positionData").classList.remove("hidden");
    $("positionBadge").textContent = "LONG";
    $("positionBadge").className = "badge good";
    $("posEntry").textContent = priceFmt(s.position.entryPrice);
    $("posQty").textContent = Number(s.position.qty).toPrecision(6);
    $("posStop").textContent = priceFmt(s.position.stopPrice);
    $("posTp").textContent = priceFmt(s.position.takeProfitPrice);
    $("posTrail").textContent = priceFmt(s.position.trailingStopPrice);
    setSigned($("posPnl"), s.account.unrealizedPnl, money(s.account.unrealizedPnl));
  } else {
    $("positionEmpty").classList.remove("hidden");
    $("positionData").classList.add("hidden");
    $("positionBadge").textContent = "FLAT";
    $("positionBadge").className = "badge muted";
  }

  const ind = s.signal?.indicators || {};
  $("rsi").textContent = ind.rsi ?? "—";
  $("atr").textContent = ind.atrPct == null ? "—" : `${ind.atrPct}%`;
  $("macd").textContent = ind.macdHistogram == null ? "—" : Number(ind.macdHistogram).toFixed(4);
  $("volume").textContent = ind.volumeRatio == null ? "—" : `${ind.volumeRatio}×`;
  $("buyScore").textContent = s.signal ? `${s.signal.buyConfidence}%` : "—";
  $("exitScore").textContent = s.signal ? `${s.signal.exitConfidence}%` : "—";
  $("signalReason").textContent = s.signal ? `${s.signal.reason}${s.signal.ai?.reason ? ` • AI: ${s.signal.ai.reason}` : ""}` : "Menunggu scan pertama.";
  $("aiBadge").textContent = s.config.aiValidation ? "AI ON" : "AI OFF";
  $("aiBadge").className = `badge ${s.config.aiValidation ? "good" : "muted"}`;

  renderChart(s.market?.chart || []);
  renderTrades(s.trades || []);
  renderScanner(s.scanner || {});
  fillSettings(s);
  renderNextRun();
}

function renderNextRun() {
  if (!state?.engine?.running || !state.engine.nextRunAt) {
    $("nextRun").textContent = state?.engine?.lastCycleAt ? `Last ${timeWita(state.engine.lastCycleAt)}` : "Idle";
    return;
  }
  const sec = Math.max(0, Math.ceil((Date.parse(state.engine.nextRunAt) - Date.now()) / 1000));
  $("nextRun").textContent = `Next scan ${sec}s`;
}

async function loadHealth() {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    health = await res.json();
    $("healthBadge").className = "badge good";
    $("healthBadge").innerHTML = '<span class="dot"></span>ONLINE';
    if (health.adminConfigured && !token()) $("authBox").classList.remove("hidden");
  } catch {
    $("healthBadge").className = "badge muted";
    $("healthBadge").innerHTML = '<span class="dot"></span>OFFLINE';
  }
}

async function loadState(silent = false) {
  try {
    const s = await api("/api/state");
    render(s);
  } catch (e) {
    if (!silent && e.message !== "ADMIN_TOKEN diperlukan") toast(e.message);
  }
}

async function action(path, message) {
  const buttons = [$("startBtn"), $("stopBtn"), $("runBtn")];
  buttons.forEach((b) => b.disabled = true);
  try {
    const s = await api(path, { method: "POST", body: "{}" });
    render(s);
    toast(message);
  } catch (e) {
    toast(e.message);
    await loadState(true);
  }
}

$("startBtn").addEventListener("click", () => action("/api/start", "Robot dimulai"));
$("stopBtn").addEventListener("click", () => action("/api/stop", "Robot dihentikan"));
$("runBtn").addEventListener("click", () => action("/api/run", "Scan selesai"));
$("toggleSettings").addEventListener("click", () => $("settingsForm").classList.toggle("hidden"));

$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    symbol: $("cfgSymbol").value,
    interval: $("cfgInterval").value,
    fastInterval: $("cfgFast").value,
    riskPerTrade: Number($("cfgRisk").value) / 100,
    maxPositionPct: Number($("cfgPosition").value) / 100,
    maxDailyLossPct: Number($("cfgLoss").value) / 100,
    minSignalConfidence: Number($("cfgConfidence").value),
    aiValidation: $("cfgAi").checked,
  };
  try {
    const s = await api("/api/config", { method: "POST", body: JSON.stringify(body) });
    render(s);
    toast("Config tersimpan");
  } catch (err) { toast(err.message); }
});

$("resetBtn").addEventListener("click", async () => {
  if (!confirm("Reset semua paper balance, posisi, signal, dan trade log?")) return;
  try {
    const s = await api("/api/reset", { method: "POST", body: "{}" });
    render(s);
    toast("Paper account di-reset");
  } catch (e) { toast(e.message); }
});

$("unlockBtn").addEventListener("click", async () => {
  const value = $("adminToken").value.trim();
  if (!value) return;
  localStorage.setItem("kaiTradAdminToken", value);
  await loadState();
});

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  $("installBtn").classList.remove("hidden");
});
$("installBtn").addEventListener("click", async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  $("installBtn").classList.add("hidden");
});

window.addEventListener("resize", () => state && renderChart(state.market?.chart || []));
setInterval(renderNextRun, 1000);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
await loadHealth();
await loadState(true);
pollTimer = setInterval(() => loadState(true), 15000);
