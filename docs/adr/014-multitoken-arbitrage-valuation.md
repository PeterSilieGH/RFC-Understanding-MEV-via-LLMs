# ADR-014: Multi-token arbitrage valuation — aggregate priced token deltas with pricing provenance

## Status

Accepted — 2026-07-22. Explorer track (`apps/explorer-api`, `apps/explorer-web`,
`packages/inspect` reference only). **Valuation-only**: the arbitrage *detector*
and the `arbitrages` schema are unchanged (confirmed scope). Builds on ADR-011
(exhaustive coverage + value-over-time timeline) and the existing EUR/ETH price
toggle.

## Context

The arbitrage-profitability visualization is wrong for any arbitrage not
denominated purely in WETH.

- **The timeline zeroes non-WETH profit.** `getMevValueSeries`
  (`apps/explorer-api/src/backfill.ts`, behind `GET /api/mev-value`) — the
  arbitrage/sandwich/liquidation value-over-time graph — sums profit as
  `SUM(CASE WHEN lower(profit_token_address) = WETH THEN profit_amount ELSE 0
  END)`. An arbitrage whose stored profit token is USDC/DAI/PEPE/… therefore
  contributes **0** to the displayed arbitrage value.
- **Only one token is ever considered.** The detector
  (`packages/inspect/src/arbitrages.ts`) models a **cyclic, single-token**
  arbitrage (route start token == end token) and stores one
  `profit_token_address` + `profit_amount`. That is correct *as detection*, but
  an arbitrage's realized profit can be a net delta across **several** tokens
  (multiple cycles in one tx, residual imbalances, profit taken in more than one
  token). The single stored token under- or mis-represents it.

The user's requirement: **aggregate the value of the token delta across all
involved tokens, not just one**, so the displayed price is accurate.

**Existing valuation infrastructure** (reused, not replaced):
- `formatAmount` (`tokens.ts`) → token units only, no price.
- `eurPrices.ts` → CoinGecko EUR per token + the ETH/EUR rate, cached (TTL).
- Frontend `showEur` toggle (`app.js`): the API returns **ETH-denominated**
  values; the toggle converts to EUR via the WETH/EUR rate (`Ξ` ⇄ EUR).

## Decision

### 1. Value the full multi-token net delta, computed from swaps (valuation-only)

- Detection and the `arbitrages` table are **unchanged**. At valuation time,
  each arbitrage's **net token-delta vector** is computed from the transaction's
  decoded swaps (`swaps` table, joined by `transaction_hash`; atomic arbitrage =
  the whole tx). Net delta per token = Σ(amount into the searcher) −
  Σ(amount out of the searcher) across the arb's swaps.
- The arbitrage's value = **Σ over tokens ( delta_token × ethPrice_token )** —
  the ETH-priced sum of every non-zero token delta, not just the stored profit
  token. For a clean single-token cycle this equals the old profit; for
  multi-token arbs it is the true aggregate.

### 2. ETH pricing with recorded provenance (the method is distinguishable)

Each token delta is priced into ETH by, in priority order, and **the method used
for each token is recorded**:

1. **`onchain`** — the token's ETH price is derived from exchange rates
   **observed in the same block's own swaps**, chained through to WETH (WETH =
   numeraire = 1). Rates are aggregated robustly per pair (volume-weighted /
   median) and shortest-path-resolved to WETH. Block-exact; no external
   dependency; historically faithful.
2. **`feed`** — CoinGecko via `eurPrices.ts`: `token_eur / weth_eur` → ETH
   price. Used when a token has no in-block path to WETH.
3. **`unpriced`** — neither source yields a price; that token's delta is
   **excluded from the total and flagged**, never silently counted as zero-value
   or dropped without a marker.

The **per-token pricing method is surfaced** in the API and the UI (a badge /
breakdown), so a viewer can tell block-derived value from feed-derived value from
unpriced. This is the "distinguishable how the price was calculated" requirement.

### 3. Denomination follows the existing EUR/ETH toggle

The API stays **ETH-denominated**. The existing `showEur` toggle + WETH/EUR
conversion renders EUR unchanged. No new denomination axis is introduced; the
aggregated value simply flows through the toggle already in place.

### 4. Wire into the timeline + per-tx display; document in the explorer Wiki

- **Timeline** (`getMevValueSeries`): the arbitrage series sums each arb's
  ETH-priced multi-token delta, replacing the WETH-only `CASE`.
- **Per-tx display** (`mev.ts`): the arbitrage entry exposes the aggregated ETH
  value **plus the per-token breakdown with pricing provenance**, so the block
  view shows how the figure was built.
- **Wiki** (`apps/explorer-web` bottom-bar **Wiki** tab, `buildLegend` in
  `app.js`): a new "How arbitrage value is priced" section explains the
  multi-token delta aggregation and the three pricing methods
  (`onchain`/`feed`/`unpriced`).

## Consequences

- **Accuracy.** Non-WETH arbitrages contribute their real value; timeline
  arbitrage totals rise and stop under-reporting. Multi-token profit is captured.
- **No migration, no reinspection.** Valuation-only keeps the inspect pipeline
  and schema stable; the change is query-time computation over swaps already
  stored. Cost moves to valuation time.
- **Pricing coverage vs. dependency.** On-chain pricing is block-exact and
  dependency-free but only covers tokens reachable from WETH within the block;
  the feed covers the rest; unpriced deltas remain **visible**, not zeroed.
- **Performance.** The per-block on-chain rate graph is built from swaps already
  loaded for that block and reused across all of the block's arbitrages; feed
  lookups are cached (`eurPrices` TTL). The timeline aggregate prices per block,
  so it must batch (one rate graph per block bucket, not per arb).
- **Auditability.** Recording pricing provenance makes the number honest and
  inspectable rather than an opaque single figure.
- **Trap — route reconstruction.** The `arbitrages` row does not store its route
  trace addresses; the delta is reconstructed from the transaction's swaps.
  Direction (which side of a swap the searcher is on) and multi-arb transactions
  must be handled carefully (WP task A). If a tx mixes an arb with unrelated
  swaps, the per-tx net delta may over-attribute — the WP defines the attribution
  rule and its bounds.
- **Consistency.** The searcher-ranking EUR profit (`insights.ts`
  `attachProfitEur`) still sums the single stored profit token; aligning it with
  the multi-token model is a follow-up noted in the WP, out of scope here to keep
  the change reviewable.
- **Negative aggregates are legitimate.** A cyclic arbitrage the detector records
  can be a *losing* round-trip (its own `profit_amount` = `end_amount` −
  `start_amount` is negative — a sandwiched or failed arb). The aggregate then
  nets **negative**, and a timeline bucket dominated by such arbs shows negative
  extracted value. This is not new to ADR-014: the old WETH-only `SUM` summed the
  same negative `profit_amount`, so the sign is preserved, not introduced. The
  valuation deliberately does **not** clamp to zero — clamping would hide losing
  arbs and diverge from the detector's own sign. (The `/api/mev-value` E2E asserts
  `Number.isFinite`, not `>= 0`, for this reason.)
- **Route reconstruction uses `arbitrage_swaps`, not the whole tx.** The WP
  refined §1's "join by `transaction_hash`" assumption: the detector *does* persist
  the arb's exact route legs in `arbitrage_swaps` (`swap_trace_address`), so the
  delta is summed over those legs (joined on `transaction_hash` **and**
  `trace_address`), which avoids over-attributing unrelated swaps in a mixed tx.
