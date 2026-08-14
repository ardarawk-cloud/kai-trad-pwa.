const PANEL_GROUPS = {
  1: [".metrics-grid", ".goal-grid", ".performance-card"],
  2: [".regime-card", ".scanner-card", ".split-grid"],
  3: ["#validationLabCard"],
  4: [".safety-card", ".broker-card", "section.card:has(#toggleSettings)"],
  5: [".decision-card"],
};

function queryAllSafe(selector) {
  try { return [...document.querySelectorAll(selector)]; } catch { return []; }
}

function executionLogCards() {
  return [...document.querySelectorAll("section.card")].filter((el) => {
    const text = String(el.textContent || "").toUpperCase();
    return text.includes("EXECUTION LOG") || text.includes("RECENT TRADES");
  });
}

function panelsForGroup(group) {
  const set = new Set();
  (PANEL_GROUPS[group] || []).forEach((selector) => queryAllSafe(selector).forEach((el) => set.add(el)));
  if (Number(group) === 5) executionLogCards().forEach((el) => set.add(el));
  return [...set];
}

function collectManagedPanels() {
  const set = new Set();
  Object.keys(PANEL_GROUPS).forEach((group) => panelsForGroup(group).forEach((el) => set.add(el)));
  executionLogCards().forEach((el) => set.add(el));
  return [...set];
}

function installPadStyles() {
  if (document.getElementById("kaiTradDashboardPadStyles")) return;
  const style = document.createElement("style");
  style.id = "kaiTradDashboardPadStyles";
  style.textContent = `
    .dashboard-pad{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:12px 0}
    .dashboard-pad button{min-height:42px;border:1px solid rgba(255,255,255,.10);border-radius:12px;background:#0d0d0d;color:var(--muted);font-weight:800;font-size:15px}
    .dashboard-pad button.active{color:#72e6ff;border-color:rgba(114,230,255,.48);background:rgba(114,230,255,.08)}
    .dashboard-pad-note{margin:0 0 12px;color:var(--muted);font-size:9px;text-align:center;letter-spacing:.04em}
    .pad-hidden{display:none!important}
    .brand .logo{width:108px!important;height:84px!important;object-fit:contain!important;transform:scaleX(1.20) scaleY(1.04)!important;transform-origin:left center!important;filter:none!important}
    @media(max-width:760px){
      .dashboard-pad{position:sticky;top:8px;z-index:20;background:#050505;padding:6px 0}
      .dashboard-pad button{min-height:40px}
      .brand .logo{width:96px!important;height:76px!important;transform:scaleX(1.20) scaleY(1.04)!important}
    }
    @media(max-width:390px){.brand .logo{width:88px!important;height:70px!important}}
  `;
  document.head.appendChild(style);
}

function applyUiReleaseLabels() {
  const eyebrow = document.querySelector(".broker-card .eyebrow");
  if (eyebrow) eyebrow.textContent = "BROKER CONNECTOR v1.10.5";
  const footer = document.querySelector("footer span");
  if (footer) footer.textContent = "KAI TRAD v1.10.5 • Historical Volume Reliability Audit • PAPER Only";
}

function installDashboardPad() {
  if (document.getElementById("dashboardPad")) return;
  installPadStyles();
  applyUiReleaseLabels();
  const controls = document.querySelector(".controls.card");
  const hero = document.querySelector(".hero.card");
  if (!controls || !hero) return;

  const wrap = document.createElement("div");
  wrap.id = "dashboardPad";
  wrap.innerHTML = `<div class="dashboard-pad">${[1,2,3,4,5].map((n)=>`<button type="button" data-pad="${n}" aria-label="Open panel ${n}">${n}</button>`).join("")}</div><p class="dashboard-pad-note">Tap nomor untuk buka panel • tap lagi untuk kembali ke dashboard utama</p>`;
  hero.insertAdjacentElement("afterend", wrap);

  let active = 0;

  const apply = () => {
    applyUiReleaseLabels();
    const managed = collectManagedPanels();
    const visible = new Set(active > 0 ? panelsForGroup(active) : []);
    managed.forEach((el) => el.classList.toggle("pad-hidden", !visible.has(el)));
    hero.classList.remove("pad-hidden");
    controls.classList.toggle("pad-hidden", active > 0);
    wrap.querySelectorAll("button[data-pad]").forEach((btn) => btn.classList.toggle("active", Number(btn.dataset.pad) === active));
    if (active > 0) requestAnimationFrame(() => wrap.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  wrap.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-pad]");
    if (!btn) return;
    const next = Number(btn.dataset.pad);
    active = active === next ? 0 : next;
    apply();
  });

  const observer = new MutationObserver(() => apply());
  observer.observe(document.querySelector("main.shell") || document.body, { childList: true, subtree: true });
  apply();
}

if (document.readyState === "loading") window.addEventListener("load", installDashboardPad, { once: true });
else installDashboardPad();
