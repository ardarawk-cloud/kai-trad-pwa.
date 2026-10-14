export const SCANNER_SUBREQUEST_POLICY = "ROTATING_BATCH_2_V1";
export const DEFAULT_SCANNER_BATCH_SIZE = 2;

export function selectScannerBatch(symbols = [], cursor = 0, batchSize = DEFAULT_SCANNER_BATCH_SIZE) {
  const universe = [...new Set((Array.isArray(symbols) ? symbols : [])
    .map((x) => String(x || "").trim().toUpperCase())
    .filter(Boolean))];
  if (!universe.length) return { symbols: [], nextCursor: 0, total: 0, startCursor: 0 };

  const size = Math.max(1, Math.min(universe.length, Math.floor(Number(batchSize) || DEFAULT_SCANNER_BATCH_SIZE)));
  const startCursor = ((Math.floor(Number(cursor) || 0) % universe.length) + universe.length) % universe.length;
  const selected = [];
  for (let i = 0; i < size; i += 1) {
    selected.push(universe[(startCursor + i) % universe.length]);
  }
  return {
    symbols: selected,
    nextCursor: (startCursor + size) % universe.length,
    total: universe.length,
    startCursor,
  };
}
