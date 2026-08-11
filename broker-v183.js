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

function applyIndodaxPrimary(s) {
  const b = s?.broker || {};
  const indo = b.indodaxCheck || {};
  const toko = b.tokocryptoCheck || b.lastCheck || {};
  const compatibility = String(b.compatibility || "NOT_CHECKED");
  const indoOnline = Boolean(indo.reachable) || compatibility === "INDODAX_FALLBACK_OK";
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
    keys.textContent = "NOT CONFIGURED";
    keys.className = "";
  }
  if (badge) {
    badge.textContent = indoOnline ? "INDODAX READY" : "LIVE LOCKED";
    badge.className = `badge ${indoOnline ? "paper" : "muted"}`;
  }
  if (meta) {
    if (indo.checkedAt) {
      const supported = indo.symbolSupported === false ? " • pair belum tersedia" : "";
      meta.textContent = indoOnline
        ? `Indodax public API ONLINE${supported} • Live tetap terkunci.`
        : `${indo.error || "Indodax public preflight gagal"} • Live tetap terkunci.`;
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
      brokerToast(indo.reachable ? "Indodax public API ONLINE" : `Indodax check: HTTP ${res.status}`);
    } catch (e) {
      brokerToast(e.message || "Indodax check gagal");
    } finally {
      btn.disabled = false;
    }
  });
}

window.addEventListener("load", () => {
  installIndodaxCheck();
  refreshBroker();
  setInterval(refreshBroker, 15000);
});
