# Work package: multi-token arbitrage valuation (ADR-014)

Prepared 2026-07-22. Explorer track only (`apps/explorer-api`,
`apps/explorer-web`). **Valuation-only** — the arbitrage detector
(`packages/inspect/src/arbitrages.ts`) and the `arbitrages` schema are
unchanged; no migration, no reinspection. Feature branch
`feat/arbitrage-multitoken-valuation` off `main`, resolved via MR. Decision in
**ADR-014**.

## Current-state anchors

- **Timeline** = `getMevValueSeries` (`apps/explorer-api/src/backfill.ts`, behind
  `GET /api/mev-value`). Arbitrage value =
  `SUM(CASE WHEN lower(profit_token_address)=WETH THEN profit_amount ELSE 0 END)`
  per block bucket — non-WETH arbs count as **0**.
- **Per-tx display** = `apps/explorer-api/src/mev.ts` `getBlockMev`: the
  `arbitrage` entry carries `profitAmountRaw` + `profitTokenAddress`, formatted
  by `formatAmount` (token units, no price).
- **Route recovery**: `arbitrage_swaps (arbitrage_id → swap_transaction_hash,
  swap_trace_address)` joins `arbitrages.id` to the exact route swaps in `swaps`.
  `swaps` has `from_address`, `to_address`, `token_in_address`,
  `token_in_amount`, `token_out_address`, `token_out_amount`, `trace_address`.
- **Pricing infra**: `eurPrices.ts` (CoinGecko EUR per token + ETH/EUR, cached);
  `tokens.ts` `getTokenInfo` (decimals/symbol, cached). Frontend `showEur` toggle
  (`app.js`): API is **ETH-denominated**, toggle converts to EUR via WETH/EUR.
- **Wiki** = explorer bottom-bar **Wiki** tab → `buildLegend` (`app.js`), section
  list rendered into `#legend`.

## Tasks

### A — Per-arbitrage multi-token net delta from route swaps (M)

New module `apps/explorer-api/src/arbValue.ts`.
- For a set of arbitrages (by block), join `arbitrages → arbitrage_swaps →
  swaps` to get each arb's route swaps.
- Net delta per token = Σ `token_out_amount` (credited, `token_out_address`) −
  Σ `token_in_amount` (debited, `token_in_address`) across the route (searcher
  gives `token_in`, receives `token_out`). Keep amounts as `bigint`; group by
  lowercased token address.
- Result: `Map<arbitrageId, Map<tokenAddress, bigint delta>>`. A clean cycle
  yields one non-zero token (== old profit); multi-token arbs yield several.
- **Trap:** dust deltas from `equalWithinPercent` rounding on intermediate legs —
  drop tokens whose delta rounds below a decimals-aware epsilon so intermediate
  hops don't add noise.

### B — Block-derived on-chain ETH price graph (M/L)

New module `apps/explorer-api/src/onchainPrices.ts`.
- From **one block's** swaps build an undirected rate graph: node = token, edge
  = observed rate between `token_in`/`token_out` (decimals-adjusted). Aggregate
  multiple observations of the same pair (volume-weighted median) for robustness.
- WETH is the numeraire (price 1.0). Resolve each token's ETH price by shortest
  path to WETH (fewest hops; product of edge rates). Cache per block.
- Return `{ tokenAddress → { ethPrice: number, method: 'onchain' } }` for every
  token connected to WETH in-block.

### C — Unified token→ETH pricing with provenance (M)

`priceTokensToEth(blockNumber, tokens)` (in `onchainPrices.ts` or a `pricing.ts`):
1. `onchain` from task B where available;
2. else `feed`: `getEurPrices([token, WETH])` → `token_eur / weth_eur` (guard
   null/zero) → ETH price, `method: 'feed'`;
3. else `method: 'unpriced'` (no price).
Returns `Map<token, { ethPrice: number | null, method: 'onchain'|'feed'|'unpriced' }>`.
Batch per block; reuse across all of the block's arbs.

### D — Aggregate arb value (S)

In `arbValue.ts`: `arbEthValue(delta, priced)` = Σ `deltaTokenUnits × ethPrice`
over priced tokens (`deltaTokenUnits = Number(delta)/10**decimals`). Carry a
**breakdown**: per token `{ symbol, delta, ethPrice, ethValue, method }`, and an
`unpricedTokens` list. Unpriced deltas are excluded from the total but returned
so the UI can flag them.

### E — Timeline wiring (M) — ADR-014 §4

In `getMevValueSeries`, replace the arbitrage `agg(...)` WETH-only CASE with the
aggregated per-arb ETH value:
- Fetch the block-bucket's arbitrages + route deltas (task A) and price per block
  (task C), sum `arbEthValue` into the bucket's `arbitrageEth`.
- Keep it **batched by block** (one rate graph per block, not per arb). Sandwich
  and liquidation series stay as-is for now (follow-up).
- The endpoint contract is unchanged (still ETH-denominated); only the arbitrage
  number changes.

### F — Per-tx display wiring (M) — ADR-014 §4

- `mev.ts`: the `arbitrage` entry gains `ethValue: number`, `pricedBreakdown`
  (per-token symbol/delta/ethPrice/ethValue/method), and `unpricedTokens`.
  Compute via tasks A/C/D for the block being rendered.
- `apps/explorer-web/public/app.js`: render the aggregated `ethValue` (through
  the existing `displayUnit`/`showEur` path) and a small **method badge**
  (`onchain`/`feed`/`unpriced`) per token in the tx detail, so the pricing
  method is distinguishable. Types in the frontend `TxMevEntry` if applicable.

### G — Wiki note (S) — ADR-014 §4

Add a "How arbitrage value is priced" section to `buildLegend` (`app.js`,
rendered in the Wiki tab): explain (1) value = sum of every token's net delta,
not one token; (2) the three pricing methods — `onchain` (block's own swap
rates → WETH, block-exact), `feed` (CoinGecko fallback), `unpriced` (flagged,
excluded); (3) that the ETH/EUR toggle controls denomination. Add matching
styles if needed (`style.css`).

### H — Tests + verification (M)

- Unit (vitest): delta computation (clean cycle → single token; synthetic
  multi-token route → multiple), on-chain rate resolution (chained hops to
  WETH), aggregation with an `unpriced` token excluded.
- Verification (Playwright/API against the live stack, per AGENTS.md): pick a
  known **non-WETH** arbitrage (`arbitrages` where `profit_token_address != WETH`)
  and confirm (a) `/api/mev-value` bucket `arbitrageEth` is now **> 0** for its
  block where it was 0 before, (b) the block view shows the aggregated value +
  method badges, (c) the Wiki tab shows the new section. Rebuild the
  `explorer-api`/`explorer-web` containers first.

## Out of scope (follow-ups)

- Aligning `insights.ts` `attachProfitEur` (searcher ranking) with the
  multi-token model — still sums the single stored profit token.
- Extending multi-token aggregation to sandwich/liquidation series.
- Persisting deltas/prices (kept query-time per ADR-014 valuation-only scope).
