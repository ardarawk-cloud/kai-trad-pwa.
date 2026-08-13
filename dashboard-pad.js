const PANEL_GROUPS = {
  1: [".metrics-grid", ".goal-grid", ".performance-card"],
  2: [".regime-card", ".scanner-card", ".split-grid"],
  3: ["#validationLabCard"],
  4: [".safety-card", ".broker-card", "section.card:has(#toggleSettings)"],
  5: [".decision-card", "section.card:has(#executionList)"],
};

function queryAllSafe(selector) {
  try { return [...document.querySelectorAll(selector)]; } catch { return []; }
}

function collectManagedPanels() {
  const set = new Set();
  Object.values(PANEL_GROUPS).flat().forEach((selector) => queryAllSafe(selector).forEach((el) => set.add(el)));
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
    @media(max-width:760px){.dashboard-pad{position:sticky;top:8px;z-index:20;background:#050505;padding:6px 0}.dashboard-pad button{min-height:40px}}
  `;
  document.head.appendChild(style);
}

function installDashboardPad() {
  if (document.getElementById("dashboardPad")) return;
  installPadStyles();
  const controls = document.querySelector(".controls.card");
  const hero = document.querySelector(".hero.card");
  if (!controls || !hero) return;

  const wrap = document.createElement("div");
  wrap.id = "dashboardPad";
  wrap.innerHTML = `<div class="dashboard-pad">${[1,2,3,4,5].map((n)=>`<button type="button" data-pad="${n}" aria-label="Open panel ${n}">${n}</button>`).join("")}</div><p class="dashboard-pad-note">Tap nomor untuk buka panel • tap lagi untuk kembali ke dashboard utama</p>`;
  hero.insertAdjacentElement("afterend", wrap);

  const frontKeep = new Set([hero, controls]);
  let active = 0;

  const apply = () => {
    const managed = collectManagedPanels();
    managed.forEach((el) => {
      const show = active > 0 && PANEL_GROUPS[active]?.some((selector) => queryAllSafe(selector).includes(el));
      el.classList.toggle("pad-hidden", !show);
    });
    frontKeep.forEach((el) => el?.classList.remove("pad-hidden"));
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
