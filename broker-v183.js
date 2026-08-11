const $b = (id) => document.getElementById(id);

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

function applyReleaseLabel() {
  const eyebrow = document.querySelector(".broker-card .eyebrow");
  if (eyebrow) eyebrow.textContent = "BROKER CONNECTOR v1.9.0";
  const footer = document.querySelector("footer span");
  if (footer) footer.textContent = "KAI TRAD v1.9.0 • Indodax Primary Public Route • PAPER Only";
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
    badge.textContent = pairReady ? "INDODAX READY" : indoOnline ? "API ONLINE • CHECK PAIR" : "LIVE LOCKED";
    badge.className = `badge ${pairReady ? "paper" : "muted"}`;
  }
  if (meta) {
    if (indo.checkedAt) {
      const supported = indo.symbolSupported === false ? " • pair belum tersedia di Indodax" : "";
      meta.textContent = indoOnline
        ? `Indodax public API ONLINE${supported} • PAPER only.`
        : `${indo.error || "Indodax public preflight gagal"} • PAPER only.`;
    } else {
      meta.textContent = "Public preflight only • tidak mengirim order.";
    }
  }
}

async function refreshBroker() {
  try {
    applyIndodaxPrimary(await brokerState());
  } catch {}
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
      if (indo.reachable && indo.symbolSupported !== false) brokerToast("Indodax public API + pair ONLINE");
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
  applyReleaseLabel();
  installIndodaxCheck();
  refreshBroker();
  setInterval(refreshBroker, 15000);
});
