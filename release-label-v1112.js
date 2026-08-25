const FALLBACK_VERSION = "1.11.3";
let currentVersion = FALLBACK_VERSION;
let versionObserver = null;
let versionPoll = null;

function headers() {
  const token = localStorage.getItem("kaiTradAdminToken") || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function normalizeVersion(version) {
  const clean = String(version || FALLBACK_VERSION).trim().replace(/^v/i, "");
  return clean || FALLBACK_VERSION;
}

function expectedLabels() {
  return {
    broker: `BROKER CONNECTOR v${currentVersion}`,
    footer: `KAI TRAD v${currentVersion} • KAI SANBAN Evidence Gate • Safety + Cost Guard • PAPER Only`,
  };
}

function apply(version = currentVersion) {
  currentVersion = normalizeVersion(version);
  const labels = expectedLabels();
  const broker = document.querySelector(".broker-card .eyebrow");
  const footer = document.querySelector("footer span");
  if (broker && broker.textContent !== labels.broker) broker.textContent = labels.broker;
  if (footer && footer.textContent !== labels.footer) footer.textContent = labels.footer;
}

async function refresh() {
  if (document.visibilityState === "hidden") return;
  try {
    const res = await fetch("/api/state", { cache: "no-store", headers: headers() });
    if (!res.ok) return apply();
    const s = await res.json();
    apply(s?.version || FALLBACK_VERSION);
  } catch {
    apply();
  }
}

function observeLabels() {
  versionObserver?.disconnect();
  const targets = [
    document.querySelector(".broker-card .eyebrow"),
    document.querySelector("footer span"),
  ].filter(Boolean);
  if (!targets.length) return;
  versionObserver = new MutationObserver(() => apply());
  for (const target of targets) versionObserver.observe(target, { childList: true, characterData: true, subtree: true });
}

function startPolling() {
  clearInterval(versionPoll);
  versionPoll = null;
  if (document.visibilityState !== "visible") return;
  versionPoll = setInterval(refresh, 30000);
}

apply();
observeLabels();
refresh();
startPolling();
setTimeout(() => { observeLabels(); apply(); }, 300);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    observeLabels();
    refresh();
  }
  startPolling();
});

window.KAITradReleaseLabel = { apply, refresh, getVersion: () => currentVersion };
