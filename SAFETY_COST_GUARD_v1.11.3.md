# KAI TRAD v1.11.3 — Hard Breaker + Cost Guard

## Hard loss-streak breaker
- Trigger: `consecutiveLosses >= MAX_CONSECUTIVE_LOSSES` (default 3).
- Action: block new BUY decisions and enforce `LOSS_STREAK` cooldown (default 240 minutes).
- Migration safety: persisted states such as `5/3 + CLEAR` are immediately re-tripped instead of being allowed to trade.
- Recovery: after a valid loss-streak cooldown expires, the streak counter resets to 0 for the next risk cycle. Historical `maxConsecutiveLossesSeen` remains intact.

## Pre-entry execution cost guard
PAPER BUY is allowed only with a fresh, verified Indodax bid/ask quote.

Projected round-trip cost:

`current full bid/ask spread % + 2 × PAPER_FEE_RATE`

Default gates:
- hard projected round-trip cost cap: 0.60%
- minimum expected gross edge: 1.00%
- volatility edge estimate: max(1.00%, 6 × main-timeframe ATR%)
- minimum edge / projected-cost ratio: 2.0x

Rejected entries are recorded as HOLD with one of:
- `EXECUTION_COST_QUOTE_UNVERIFIED`
- `EXECUTION_COST_TOO_HIGH`
- `EXECUTION_COST_EXCEEDS_EDGE_BUDGET`

## Evidence and LIVE
- Existing Strict Evidence is not reset or deleted.
- Future accepted trades continue the same evidence ledger with additional entry-cost metadata.
- LIVE remains hard locked.
