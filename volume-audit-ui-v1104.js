function installVolumeAuditStyles() {
  if (document.getElementById("kaiTradVolumeAuditStyles")) return;
  const style = document.createElement("style");
  style.id = "kaiTradVolumeAuditStyles";
  style.textContent = `
    .volume-audit{display:none;margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.07)}
    .volume-audit.show{display:block}
    .volume-audit h4{margin:0 0 10px;font-size:13px}
    .volume-audit-metrics{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .volume-audit-metrics>div,.volume-profile{padding:12px;border:1px solid rgba(255,255,255,.06);border-radius:12px;background:rgba(255,255,255,.018)}
    .volume-audit-metrics span{display:block;color:var(--muted);font-size:8px;letter-spacing:.08em;font-weight:700}
    .volume-audit-metrics strong{display:block;margin-top:6px;font-size:13px}
    .volume-profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
    .volume-profile strong{display:block;font-size:11px}
    .volume-profile-line{margin-top:6px;color:var(--muted);font-size:8px;line-height:1.55}
    .volume-profile-focus{margin-top:6px;font-size:9px;color:var(--text)}
    .volume-audit-note{margin:10px 0 0;color:var(--muted);font-size:9px;line-height:1.55}
    @media(max-width:760px){.volume-profile-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function applyVolumeAuditReleaseLabel() {
  const eyebrow = document.querySelector(".broker-card .eyebrow");
  if (eyebrow) eyebrow.textContent = "BROKER CONNECTOR v1.10.4";
  const footer = document.querySelector("footer span");
  if (footer) footer.textContent = "KAI TRAD v1.10.4 • Volume Integrity Audit • PAPER Only";
}

function installVolumeAuditBlock() {
  if (document.getElementById("validationVolumeAudit")) return;
  const calibration = document.getElementById("validationCalibration");
  const host = calibration || document.getElementById("validationLabCard");
  if (!host) return;
  const block = document.createElement("div");
  block.id = "validationVolumeAudit";
  block.className = "volume-audit";
  block.innerHTML = `
    <h4>Volume Integrity & Signal Coupling</h4>
    <div class="volume-audit-metrics">
      <div><span>MAIN ZERO VOLUME</span><strong id="volumeMainZero">—</strong></div>
      <div><span>FAST ZERO VOLUME</span><strong id="volumeFastZero">—</strong></div>
      <div><span>MAIN RATIO P95 / MAX</span><strong id="volumeMainRatio">—</strong></div>
      <div><span>FAST RATIO P95 / MAX</span><strong id="volumeFastRatio">—</strong></div>
    </div>
    <div id="volumeProfileRows" class="volume-profile-grid"></div>
    <p id="volumeAuditNote" class="volume-audit-note">Historical/read-only. Volume-neutral path only removes the +8 volume confirmation bonus; safety guards remain active.</p>
  `;
  host.appendChild(block);
}

const n = (v, d = 1) => Number.isFinite(Number(v)) ? Number(v).toFixed(d) : "—";

function renderVolumeAudit(audit) {
  installVolumeAuditStyles();
  installVolumeAuditBlock();
  applyVolumeAuditReleaseLabel();
  const block = document.getElementById("validationVolumeAudit");
  const host = document.getElementById("volumeProfileRows");
  if (!block || !host || !audit?.profiles) return;
  block.classList.add("show");

  const raw = audit.rawVolume || {};
  const ratios = audit.volumeRatio || {};
  document.getElementById("volumeMainZero").textContent = `${n(raw.main?.zeroPct || 0)}% (${raw.main?.zeroCount || 0}/${raw.main?.samples || 0})`;
  document.getElementById("volumeFastZero").textContent = `${n(raw.fast?.zeroPct || 0)}% (${raw.fast?.zeroCount || 0}/${raw.fast?.samples || 0})`;
  document.getElementById("volumeMainRatio").textContent = `${n(ratios.main?.p95 || 0, 2)} / ${n(ratios.main?.max || 0, 2)}`;
  document.getElementById("volumeFastRatio").textContent = `${n(ratios.fast?.p95 || 0, 2)} / ${n(ratios.fast?.max || 0, 2)}`;

  host.innerHTML = audit.profiles.map((row) => {
    const created = Number(row.volumeCreatedAligned || 0);
    const guardBlocked = Number(row.guardBlockedVolumeCreated || 0);
    return `<div class="volume-profile">
      <strong>${row.label || row.id}</strong>
      <div class="volume-profile-focus">CURRENT ${row.currentAligned || 0} aligned → NEUTRAL ${row.neutralAligned || 0} • VOLUME-CREATED ${created}</div>
      <div class="volume-profile-line">Eligible current ${row.currentEligible || 0} • neutral ${row.neutralEligible || 0}</div>
      <div class="volume-profile-line">Volume-created blocked: ABN ${row.volumeCreatedBlockedAbnormal || 0} • LIQ ${row.volumeCreatedBlockedLiquidity || 0} • OTHER ${row.volumeCreatedBlockedOther || 0} • eligible ${row.volumeCreatedEligible || 0}</div>
      <div class="volume-profile-line">Guard-blocked coupling ${guardBlocked}/${created || 0} (${n(row.guardBlockedPctOfVolumeCreated || 0)}%)</div>
    </div>`;
  }).join("");

  const note = document.getElementById("volumeAuditNote");
  if (note) {
    const s = audit.summary || {};
    note.textContent = `Historical only • ${s.decisions || 0} decisions • volume-created aligned ${s.volumeCreatedAlignedAcrossProfiles || 0} • guard-blocked ${s.volumeCreatedGuardBlockedAcrossProfiles || 0} • production strategy unchanged.`;
  }
}

installVolumeAuditStyles();
applyVolumeAuditReleaseLabel();
window.KAITradVolumeAuditUI = { render: renderVolumeAudit };
