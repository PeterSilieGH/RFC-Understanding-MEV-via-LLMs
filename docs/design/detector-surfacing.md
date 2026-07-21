# Detector surfacing investigation (X2, wp-explorer-v2)

Prepared 2026-07-20. Answers the TODO "inspect why only arbitrage and sandwiches
are detected and not other MEV types listed in the wiki."

## Finding: the read/merge/render path is complete — the gap is firing rate

All five custom detectors are wired end-to-end. The chain is intact at every
layer:

1. **Pipeline** — `packages/inspect/src/detectors/index.ts` `runDetectors()`
   runs all five (JIT liquidity, non-atomic arbitrage, liquidation sandwich,
   liquidation race, NFT flip) in-process per block and persists to the `mev_*`
   tables (ADR-010).
2. **Read** — `apps/explorer-api/src/detectorReads.ts` reads every `mev_*`
   table; `mev.ts` `getBlockMev()` merges all of them (plus the core
   arbitrage/sandwich/liquidation/nft tables) into each transaction's `mev[]`.
3. **Render** — `apps/explorer-web/public/app.js` `MEV_INFO` has entries for
   **all** types and `renderMevDetail()` has a `case` for each, so any populated
   type renders as a badge + detail panel.

So nothing is being detected-but-hidden. What the user observes ("only arbitrage
and sandwiches") is two separate things:

- **The stats bar** (`renderStats`) intentionally summarises only three types
  (Arbitrages / Sandwiches / Liquidations) as headline cards (E4). The detail
  table already shows every other type where present. This is by design, not a
  bug.
- **The other types genuinely fire rarely.** They are downstream of the facts
  the classifier produces, and firing is gated by two things below.

## Why the advanced detectors fire rarely

1. **Classifier coverage bounds the inputs.** The detectors consume `swaps`,
   `liquidations`, and `nftTrades`. Those only exist for protocols with a swap/
   liquidation classifier. DEX **pools are matched generically by ABI + swap
   signature** (`classifiers/specs/uniswap.ts`), so every Uniswap V2/V3- and
   Sushiswap-shaped pool is covered — but the modern singletons are
   **decode-only** today (`specs/modern.ts`): Uniswap V4 PoolManager, the
   Universal Router, and the Balancer V2 Vault label their calls but emit **no
   swaps**, and Balancer `batchSwap` is likewise unextracted. Liquidations are
   classified for Aave V1/V2/V3, Compound, and Cream only. Anything routed
   through an un-classified venue produces no fact for a detector to match.
2. **The detectors are deliberately strict** (they encode rare, specialized
   patterns): a liquidation sandwich needs the *same* address to swap and then
   liquidate in the same block; a liquidation race needs two addresses
   liquidating the *same* borrower with one reverting; JIT needs a mint and
   decrease of the *same* position around a swap within one block; NFT flip
   needs a buy and resale of the *same* token in one block. These are genuinely
   uncommon, so low counts are expected and correct, not a defect.

## Actions taken

- **No surfacing fix needed** — the merge and render already cover all types
  (verified above). Documented here so the "why" is on record.
- **X3 (registry)** extends the known-token set (`tokens.ts`) so more swaps
  resolve token metadata; DEX/pool matching is already generic by signature.
- **Known swap-emission gaps** (scoped follow-ups, not in this WP): turn the
  decode-only Uniswap V4 / Balancer V2 Vault / `batchSwap` specs into
  swap-emitting classifiers via transfer-delta extraction. Until then, MEV
  routed exclusively through those venues will not produce swaps/arbitrages.

## How to confirm on a live corpus

Once a range is inspected, per-type population is observable directly:

```sql
SELECT 'jit'          t, count(*) FROM mev_jit_liquidity
UNION ALL SELECT 'non_atomic',  count(*) FROM mev_non_atomic_arbitrages
UNION ALL SELECT 'liq_sandwich', count(*) FROM mev_liquidation_sandwiches
UNION ALL SELECT 'liq_race',    count(*) FROM mev_liquidation_races
UNION ALL SELECT 'nft_flip',    count(*) FROM mev_nft_flips;
```

Non-zero rows there that don't appear in the UI would indicate a real surfacing
bug; zero rows over a large inspected range point at classifier coverage /
threshold strictness (expected), per the analysis above.
