import { aggregateIndodaxCandles } from "./indodax.js";

const MINUTE_MS = 60_000;
const round = (n, d = 1) => Number(Number(n || 0).toFixed(d));

export function auditCandleSeries(candles = [], intervalMs, fromMs = 0, toMs = 0) {
  const rows = [...candles].sort((a, b) => Number(a.openTime) - Number(b.openTime));
  const unique = new Map();
  let duplicates = 0;
  for (const row of rows) {
    const ts = Number(row.openTime);
    if (unique.has(ts)) duplicates += 1;
    unique.set(ts, row);
  }
  const values = [...unique.values()].sort((a, b) => Number(a.openTime) - Number(b.openTime));
  const zeroCount = values.filter((c) => Number(c.volume || 0) <= 0).length;
  let missingSlots = 0;
  let largestGapMs = 0;
  for (let i = 1; i < values.length; i++) {
    const gap = Number(values[i].openTime) - Number(values[i - 1].openTime);
    if (gap > intervalMs) {
      missingSlots += Math.max(0, Math.round(gap / intervalMs) - 1);
      largestGapMs = Math.max(largestGapMs, gap - intervalMs);
    }
  }
  const span = Number(toMs) > Number(fromMs) ? Number(toMs) - Number(fromMs) : 0;
  const expected = span > 0 ? Math.max(0, Math.floor(span / intervalMs)) : values.length + missingSlots;
  return {
    samples: values.length,
    expected,
    coveragePct: expected ? round(Math.min(100, (values.length / expected) * 100), 1) : 100,
    zeroCount,
    zeroPct: values.length ? round((zeroCount / values.length) * 100, 1) : 0,
    activePct: values.length ? round(((values.length - zeroCount) / values.length) * 100, 1) : 0,
    duplicateTimestamps: duplicates,
    missingSlots,
    largestGapMinutes: round(largestGapMs / MINUTE_MS, 1),
  };
}

function compareVolume(direct = [], derived = []) {
  const derivedByTime = new Map(derived.map((c) => [Number(c.openTime), c]));
  let matched = 0;
  let zeroDisagreement = 0;
  for (const row of direct) {
    const other = derivedByTime.get(Number(row.openTime));
    if (!other) continue;
    matched += 1;
    if ((Number(row.volume || 0) <= 0) !== (Number(other.volume || 0) <= 0)) zeroDisagreement += 1;
  }
  return { matched, zeroDisagreement, zeroDisagreementPct: matched ? round((zeroDisagreement / matched) * 100, 1) : 0 };
}

export function runHistoricalVolumeReliabilityAudit({ raw1m = [], fast5m = [], main15m = [], fromMs = 0, toMs = 0 } = {}) {
  const derived5m = aggregateIndodaxCandles(raw1m, 5 * MINUTE_MS, 5).filter((c) => c.openTime >= fromMs && c.closeTime <= toMs);
  const derived15m = aggregateIndodaxCandles(raw1m, 15 * MINUTE_MS, 15).filter((c) => c.openTime >= fromMs && c.closeTime <= toMs);
  const raw = auditCandleSeries(raw1m, MINUTE_MS, fromMs, toMs);
  const fast = auditCandleSeries(fast5m, 5 * MINUTE_MS, fromMs, toMs);
  const main = auditCandleSeries(main15m, 15 * MINUTE_MS, fromMs, toMs);
  const derivedFast = auditCandleSeries(derived5m, 5 * MINUTE_MS, fromMs, toMs);
  const derivedMain = auditCandleSeries(derived15m, 15 * MINUTE_MS, fromMs, toMs);

  let status = "RELIABLE";
  let reason = "Timestamp coverage and active volume are within audit tolerance.";
  if (raw.coveragePct < 95 || raw.missingSlots > Math.max(3, raw.expected * 0.05)) {
    status = "DATA_GAPS";
    reason = "Raw 1m history contains material timestamp gaps.";
  } else if (raw.zeroPct >= 50 || fast.zeroPct >= 50 || main.zeroPct >= 50) {
    status = "SOURCE_ZERO_VOLUME_DOMINANT";
    reason = "Timestamps are mostly present, but the source reports zero volume on most samples.";
  } else if (raw.zeroPct >= 20 || fast.zeroPct >= 20 || main.zeroPct >= 20) {
    status = "DEGRADED_VOLUME_DATA";
    reason = "Historical volume has substantial zero-volume density.";
  }

  return {
    version: "1.10.5",
    status,
    reliableForVolumeStrategyCalibration: status === "RELIABLE",
    reason,
    source: { raw1m: raw, direct5m: fast, direct15m: main },
    derivedFromRaw1m: { fast5m: derivedFast, main15m: derivedMain },
    consistency: { fast5m: compareVolume(fast5m, derived5m), main15m: compareVolume(main15m, derived15m) },
    interpretation: "Read-only data-quality audit; no production strategy or safety settings are changed.",
  };
}
