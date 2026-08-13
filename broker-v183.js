const $b = (id) => document.getElementById(id);
let brokerPollTimer = null;

function brokerAuthHeaders() {
  const token = localStorage.getItem("kaiTradAdminToken") || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function brokerToast(message) {
  const el = $b("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(el._brokerTimer);
  el._brokerTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

async function brokerState() {
  const res = await fetch("/api/state", { cache: "no-store", headers: brokerAuthHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function installMobilePerformanceMode() {
  if (document.getElementById("kaiTradMobilePerf")) return;
  const style = document.createElement("style");
  style.id = "kaiTradMobilePerf";
  style.textContent = `
    .brand .logo {
      width: 100px !important;
      height: 82px !important;
      object-fit: contain !important;
      transform: scaleX(1.14) scaleY(1.05);
      transform-origin: left center;
    }
    @media (max-width: 760px) {
      body { background: #050505 !important; }
      .bg-grid { display: none !important; }
      .card {
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
        box-shadow: 0 8px 24px rgba(0,0,0,.32) !important;
        background: #0d0d0d !important;
      }
      .brand .logo {
        width: 92px !important;
        height: 76px !important;
        transform: scaleX(1.14) scaleY(1.05);
      }
      .logo { filter: none !important; }
      .badge .dot { box-shadow: none !important; }
      .decision-card,
      .performance-card,
      .safety-card,
      .broker-card,
      .regime-card,
      .scanner-card,
      .validation-card {
        content-visibility: auto;
        contain-intrinsic-size: auto 320px;
      }
      #priceChart { contain: paint; }
    }
    @media (max-width: 390px) {
      .brand .logo {
        width: 84px !important;
        height: 70px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function applyReleaseLabel() {
  const eyebrow = document.querySelector(".broker-card .eyebrow");
  if (eyebrow) eyebrow.textContent = "BROKER CONNECTOR v1.10.4";
  const footer = document.querySelector("footer span");
  if (footer) footer.textContent = "KAI TRAD v1.10.4 • Volume Integrity Audit • PAPER Only";
}

function applyIndodaxPrimary(s) {
  const b = s?.broker || {};
  const indo = b.indodaxCheck || {};
  const toko = b.tokocryptoCheck || b.lastCheck || {};
  const compatibility = String(b.compatibility || "NOT_CHECKED");
  const indoOnline = Boolean(indo.reachable) || compatibility === "INDODAX_FALLBACK_OK";
  const pairReady = indoOnline && indo.symbolSupported !== false;
  const tokoWaf = String(toko.error || "").includes("403") || String(b.tokocryptoStatus || "").includes("WAF");

  const primary = $b("brokerPrimary");
  const secondary = $b("brokerSecondary");
  const reach = $b("brokerReachable");
  const badge = $b("brokerBadge");
  const meta = $b("brokerCheckMeta");
  const live = $b("brokerLiveStage");
  const keys = $b("brokerKeys");

  if (primary) primary.textContent = "INDODAX";
  if (secondary) secondary.textContent = `TOKOCRYPTO • ${tokoWaf ? "WAF BLOCKED" : toko.reachable ? "ONLINE" : "STANDBY"}`;
  if (reach) {
    reach.textContent = indo.checkedAt ? (indoOnline ? "ONLINE" : "FAILED") : "NOT CHECKED";
    reach.className = indo.checkedAt ? (indoOnline ? "positive" : "negative") : "";
  }
  if (live) {
    live.textContent = "LOCKED";
    live.className = "";
  }
  if (keys) {
    keys.textContent = "NOT REQUIRED (PAPER)";
    keys.className = "";
  }
  if (badge) {
    badge.textContent = pairReady ? "INDODAX DATA READY" : indoOnline ? "API ONLINE • CHECK PAIR" : "LIVE LOCKED";
    badge.className = `badge ${pairReady ? "paper" : "muted"}`;
  }
  if (meta) {
    if (indo.checkedAt) {
      const supported = indo.symbolSupported === false ? " • pair belum tersedia di Indodax" : "";
      meta.textContent = indoOnline
        ? `Indodax public API + native market data ONLINE${supported} • PAPER only.`
        : `${indo.error || "Indodax public preflight gagal"} • PAPER only.`;
    } else {
      meta.textContent = "Indodax public preflight + native market data • tidak mengirim order.";
    }
  }
}

async function refreshBroker() {
  if (document.visibilityState === "hidden") return;
  try {
    applyIndodaxPrimary(await brokerState());
  } catch {}
}

function startBrokerPolling() {
  clearInterval(brokerPollTimer);
  brokerPollTimer = null;
  if (document.visibilityState !== "visible") return;
  brokerPollTimer = setInterval(refreshBroker, 60000);
}

function installIndodaxCheck() {
  const oldBtn = $b("brokerCheckBtn");
  if (!oldBtn || oldBtn.dataset.indodaxPrimary === "1") return;
  const btn = oldBtn.cloneNode(true);
  btn.dataset.indodaxPrimary = "1";
  btn.textContent = "◎ CHECK INDODAX";
  oldBtn.replaceWith(btn);
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const res = await fetch("/api/broker/check", {
        method: "POST",
        headers: { "content-type": "application/json", ...brokerAuthHeaders() },
        body: "{}",
      });
      await refreshBroker();
      const s = await brokerState();
      const indo = s?.broker?.indodaxCheck || {};
      if (indo.reachable && indo.symbolSupported !== false) brokerToast("Indodax API + pair ONLINE");
      else if (indo.reachable) brokerToast("Indodax API ONLINE • pair perlu dicek");
      else brokerToast(`Indodax check: HTTP ${res.status}`);
    } catch (e) {
      brokerToast(e.message || "Indodax check gagal");
    } finally {
      btn.disabled = false;
    }
  });
}

window.addEventListener("load", () => {
  installMobilePerformanceMode();
  applyReleaseLabel();
  installIndodaxCheck();
  refreshBroker();
  startBrokerPolling();
  import("./calibration-ui-v1102.js")
    .then(() => import("./validation-v110.js"))
    .then(() => import("./volume-audit-ui-v1104.js"))
    .catch(() => {});
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshBroker();
  startBrokerPolling();
});
