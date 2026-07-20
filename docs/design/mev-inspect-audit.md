# mev-inspect-py audit — bugs & protocol gaps

Audit of the patched Flashbots inspector (`mev-monitor/mev-inspect-py/`) performed while porting
its pipeline to the native TypeScript engine `@mev/inspect` (ADR-010). Findings are grouped into
**correctness bugs** (carried into the port as fixes, with the original behavior noted) and
**protocol staleness** (the "align with up-to-date protocols" work).

Provenance: line references are against the pinned checkout at `mev-monitor/mev-inspect-py`.

## Correctness bugs

### B1 — `equal_within_percent` divides by zero on empty legs
`mev_inspect/utils.py:8-14` computes `abs((a-b) / (0.5*(a+b)))`. When both swap amounts are `0`
(e.g. a decoded swap whose in/out transfers netted to zero, or a degenerate pool call) the
denominator is `0` and Python raises `ZeroDivisionError`, aborting `get_arbitrages` for the whole
transaction. **Fix in port:** treat two zero legs as equal, unequal legs against zero as not-equal;
only then take the ratio.

### B2 — arbitrage start/end pool check is asymmetric
`mev_inspect/arbitrages.py:_get_all_start_end_swaps` (lines 147-177). The docstring states an arb
opening/closing must satisfy **both** `not swap[start].from_address in pools` **and**
`not swap[end].to_address in pools`, but the code only checks the start side
(`not potential_start_swap.from_address in pool_addrs`). Routes that terminate *into* a pool
address can be admitted, over-counting arbitrages. **Fix in port:** also require
`potential_end_swap.to_address not in pool_addrs`.

### B3 — stale sandwich router exclusion list
`mev_inspect/sandwiches.py:6-8` hardcodes only three router addresses (UniV2 router, UniV3
SwapRouter, UniV3 SwapRouter02) as "not a sandwicher". Modern order flow routes through the
**Uniswap Universal Router**, 1inch, 0x Settler, CoW, etc. A batch swap through an unlisted router
whose `to_address` fronts other users' same-pool swaps can be misread as a sandwich →
**false positives**. **Fix in port:** maintain a broader modern-router set and exclude by the
classifier's `router` role rather than a bare address list. (The single-pool-only nature of the
heuristic — it cannot see multi-pool sandwiches — is a documented limitation, left as-is.)

### B4 — `transaction_index` vs `transaction_position` inconsistency
`swaps`/`classified_traces` carry a nullable `transaction_position`; `miner_payments` carries a
non-null `transaction_index`. The custom detectors join across these interchangeably
(`liquidationSandwich` orders by `miner_payments.transaction_index`, `jitLiquidity` by
`swaps.transaction_position`), so ordering can disagree when `transaction_position` is null.
**Fix in port:** `writeBlock` always populates `transaction_position` from the trace's transaction
index, so both columns carry the same value and detectors have one consistent ordering source.

### B5 — non-portable receipts fetch
`mev_inspect/block.py:108-110` fetches all receipts via `eth_getBlockReceipts`. Not every node
serves it. **Fix in port:** try `eth_getBlockReceipts`, fall back to batched
`eth_getTransactionReceipt`. (Receipts are only needed for miner-payment gas accounting; swaps and
transfers are reconstructed from the call traces themselves.)

### B6 — USD-summary step fails and is papered over
The optional USD-summary step throws without a configured price feed, so
`mev-monitor/lib/inspector.js` (and `apps/explorer-api/src/inspector.ts:88-95`) treat a *failed*
inspection as success whenever the `blocks` row exists. The native engine drops the USD-summary
step entirely (the explorer computes its own USD/EUR figures via `eurPrices.ts`), so the
workaround is removed and a real failure is once again a real failure.

## Decoder strictness (native vs eth_abi) — known minor divergence
Python's `eth_abi.decode_abi` is strict: it raises `NonEmptyPaddingBytes` /
`InsufficientDataBytes` on non-canonical calldata, so a selector *collision*
(calldata whose first 4 bytes equal, say, `UniswapV3Pool.swap` but whose args
aren't a canonical encoding) is rejected → `unknown`. ethers'
`decodeFunctionData` is more lenient and decodes it anyway. Observed on block
25538163: native detected one extra "uniswap_v3" swap for a call that is
actually a Uniswap **V4** interaction (its children hit the V4 PoolManager
`0x000000000004444c5dc75cb358380d2e3de08a90`) whose selector collides with the
V3 swap selector. Net effect there: +1 swap / +0 sandwiches, and up to a few
extra candidate arbitrages. Parity on `classified_traces`, `transfers`, and
`miner_payments` is exact. Tracked for Phase 2 (proper Uniswap V4 support plus a
decode round-trip/strictness guard); documented here rather than papered over.

## Known limitations (kept, documented — not "bugs")
- `create_swap_from_pool_transfers` (`classifiers/helpers.py:65`) selects `transfers_to_pool[-1]`
  as the input leg; a single pool touched by multiple inbound transfers in one call can be
  misattributed. Left as-is for parity.
- Arbitrage/sandwich IDs are random `uuid4` (`crud/arbitrages.py`, `crud/sandwiches.py`); rows are
  made idempotent by delete-by-block-range before re-insert. The port keeps this exact contract.

## Protocol staleness (alignment work)
The classifier specs are 2021-era. Present: Uniswap V2/V3, Sushiswap, Balancer V1, Curve,
Aave V1/V2, Compound V2, Cream, 0x (v3/v4 exchange proxy), Bancor V1, WETH, ERC20, OpenSea (Wyvern).
Missing high-volume modern protocols added in the port (ADR-010, pluggable spec registry):
- **Uniswap V4** (singleton `PoolManager` + hooks + flash accounting) — best-effort swap extraction
  via net transfer deltas around `PoolManager.swap` / Universal Router `execute`.
- **Aave V3** (`Pool.liquidationCall` / `flashLoan`).
- **Compound V3 (Comet)** (`absorb` / `buyCollateral`).
- **Balancer V2** (`Vault.swap` / `batchSwap`).
- **0x v4 settler** (current Exchange Proxy features).

Dropped as dead weight (never surfaced by the explorer UI): **CryptoPunks** classifier and the
`punk_bids` / `punk_bid_acceptances` / `punk_snipes` tables. Generic `nft_trades` (OpenSea/Seaport)
plus the `nftFlip` detector are retained.
