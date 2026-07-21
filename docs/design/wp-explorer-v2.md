# Work package: MEV Block Explorer v2 — coverage, detectors, header & timeline

Prepared 2026-07-20 from user TODO (quoted inline). Pure explorer work
(`apps/explorer-web` + `apps/explorer-api` + `packages/inspect`); independent of
the DiscoUI / MEV Discovery track (wp-mev-discovery.md). Structural decisions in
**ADR-011** (exhaustive coverage, value timeline, unified RPC provider).

## Current-state anchors

- Header: `.header-top` three-zone bar (beta/DSN left, `<h1>` "MEV Block
  Explorer" centered, toggle group right); top-row toggles are `.icon-btn`
  box-toggles (follow-latest ⟳, MEV-only ⚡, EUR, theme). See
  wp-explorer-redesign.md Amendment.
- Navigation: timeline (analysis slider + 100-block interval slider,
  `TIMELINE_SPAN` = 5000, `INTERVAL_SIZE` = 100), ticker strip, prev/next with a
  read-only `#currentBlock` label, `?block=N` deep links. No text entry / "Load"
  button (removed in the amendment).
- Backfill: `POST /api/backfill {fromBlock[,toBlock]}` → serial worker in
  `backfill.ts`; coverage from the `blocks` table (`/api/analyzed-ranges`);
  `/api/mev-activity` gives per-block **counts**.
- Detectors: all five custom detectors run in-pipeline (`packages/inspect/src/
  detectors/*`, `runDetectors`) and persist to `mev_*` tables; explorer-api
  reads them (`detectorReads.ts`) and merges into one `mev[]` per tx (`mev.ts`).
  Stats bar surfaces Arbitrages / Sandwiches / Liquidations.
- RPC: **one `ethers.JsonRpcProvider` per module** (`inspector`,
  `inspectorLoop`, `mempoolWatcher`, `builder`, `tokens`, `server`) against one
  connection-capped node; `tokens.ts` carries a connection-dedupe workaround.
- Address lookup + "Income vs bid" live in the bottom tab bar.

## Tasks

### X1 — Persistent classified sessions across reload (S) — ADR-011 §4

> "make sessions persistent, so all classified txs show up after reload."

The facts are already durable in Postgres (ADR-010); the gap is front-end
hydration. On load / interval change, hydrate the tx + MEV list from persisted
facts for the focused block(s) via the existing read endpoints so a reload
restores everything classified rather than an empty view. Guarantee every MEV
row the UI shows has a durable source. No new storage.

### X2 — Investigate detector surfacing gap (M)

> "inspect why only arbitrage and sandwiches are detected and not other mev
> types listed in the wiki."

All five detectors are wired (`runDetectors`) — so this is a **surfacing or
firing** gap, not missing code. Investigate in order and fix what's found:
1. Are the `mev_*` tables actually **populated** over inspected ranges? (query
   counts) — if empty, the detectors aren't firing → step 3.
2. Does `detectorReads.ts` / `mev.ts` **read and merge** every detector type
   into the per-tx `mev[]`, and does explorer-web **render** each type? (liq
   sandwich, liq race, JIT liquidity, non-atomic arb, NFT flip) — surfacing gap.
3. If under-firing, is it **classifier coverage** (missing protocol specs →
   no swaps/liquidations for the detector to match) or over-strict detector
   thresholds? Cross-check against a block the mev-inspect-py reference wrote
   (offline verification, CLAUDE.md).

Deliver a short findings note (extend `docs/design/mev-inspect-audit.md` or a
new note) + the fix (wire the missing reads/render, or the classifier/detector
correction). Feeds X9's value series (needs liquidation values to be real).

### X3 — Extend DEX / token / pool registries (M)

> "extend the list of known dexes, tokens and liquidity pools."

Add protocol classifier specs (`packages/inspect/src/classifiers/specs/*`, one
file per protocol, `registerClassifierSpecs()`) for currently-unclassified DEXes
and their pools, and extend the known-token metadata. More classified swaps/
pools directly improves arbitrage/sandwich coverage and X2's detectors. Keep the
provenance/porting convention. Add ABIs under `packages/inspect/abis/`.

### X4 — ETH-mode "xhi" currency display (S)

> "make ethereum mode show xhi when currency is displayed (i.e. on 'Income vs.
> bid' panel)"

When the currency toggle is in ETH mode, render the unit as **xhi** wherever a
currency unit is shown (starting with the Income vs bid panel; audit all
`ETH`/`Ξ` labels). Values unchanged — label only. Confirm the intended scope
(xhi as the ETH-mode unit label everywhere vs. that panel only) at review.

### X5 — Remove the block-number field caption (XS)

> "remove the field stating #block number block selector in MEV Block Explorer"

Remove the `#block number` selector caption/field from the block selector.
(Read against current header/selector markup — the text-entry was already
removed in the amendment; this drops the residual label.)

### X6 — Show arbitrage victim loss (M)

> "show the loss of arbitrage victims"

For arbitrages, compute and display the **counterparty/victim loss** (adverse
price impact borne by the ordinary swap the arbitrage exploited), not just
arbitrageur profit. Requires deriving the victim leg from the swap set and a
loss metric; surface it per-arbitrage in the tx/MEV detail. Pin the exact metric
(price-impact vs. slippage-vs-mid) with the value-metric decision shared by X9.

### X7 — MEV filter button icon (XS)

> "replace the lightning symbol for the mev filter button with another icon
> indicating 'filter' that is gray and turns green on toggle like the other top
> row buttons."

Swap the ⚡ icon on the MEV-only box-toggle for a **filter** glyph; gray when
off, green when on, matching the other top-row box-toggles. State/logic
unchanged.

### X8 — Header → Block/Address mode switch + unified search (M)

> "remove 'MEV Block Explorer' Caption and replace it with a button toggling
> between Block and Address and a search bar to its right where depending on
> mode a block is fetched or the information currently in the address lookup
> tab. align the displaying of the transactions fetched via address lookup such
> that it is the same as those fetched via block."

- Replace the centered `<h1>` with a **Block ⇄ Address** mode toggle + a search
  input to its right. Block mode: entry fetches/loads a block. Address mode:
  entry runs the current address-lookup query.
- **Unify the transaction rendering**: address-lookup results use the **same tx
  list/MEV presentation** as block results (share the render path). The
  standalone Address-lookup tab's bespoke layout is retired or reduced to the
  input's host.

### X9 — Timeline as value line-graph (L) — ADR-011 §1–2

> "turn the time-line block selector into a line-graph starting from block
> 11 000 000. colorcode arbs liquidation and sandwiches into 3 lines that
> indicate the volume of value extracted that way through time. remove the
> backfilling button as backfilling is exhaustive from that block. retain the
> interval selection but only display it as a slider."

- New bucketed aggregate endpoint (extend `/api/mev-activity` to value-per-type
  or add `/api/mev-value?from&to&bucket`) over the MEV-fact tables, from block
  **11,000,000**.
- Timeline becomes a **3-series line/area graph** (arbitrage / sandwich /
  liquidation, color-coded) of **value extracted** over the block-time axis.
- **Remove** the analysis slider + backfill button; inspection is driven by the
  continuous fixed-range worker (X10 / ADR-011 §1). Show remaining gaps subtly,
  not as a primary channel.
- **Retain** the 100-block interval selection, rendered **only as a slider**
  over the graph; still scopes the ticker and auto-focuses the interval's
  highest-**value** block.
- Depends on X2 (real per-type values) and the shared value metric (X6/X9).

### X10 — Continuous fixed-range inspection worker (M) — ADR-011 §1, §3

> (from item 9) "backfilling is exhaustive from that block"

- Convert the request-scoped backfill into a **service-lifecycle worker** that
  continuously fills **[11,000,000 … head]**, reusing the serial
  `inspectBlockIfNeeded` dedupe + timeout + skip/cooldown. Coverage still
  derived from the `blocks` table (restart-safe). Observable: cursor, progress,
  failures. `POST /api/backfill` may remain as an internal seed/re-inspect
  control.
- Ensure the worker and the head-follower share **one serial process-wide
  queue** (no racing on the capped node).

### X11 — Unify RPC provider / remove connection sharding (M) — ADR-011 §3

> "review the connection sharding of rpc calls. remove it if possible."

There is no cross-endpoint sharding — just uncoordinated per-module providers
against one capped node. Consolidate to a **single shared `JsonRpcProvider**
(new `@mev/rpc` singleton or exported from `@mev/config`); remove the per-module
`new ethers.JsonRpcProvider(...)`. Keep inspection serial process-wide. Simplify
the `tokens.ts` connection-dedupe to plain request coalescing on the shared
provider. If a module provably needs an isolated budget (e.g. mempool
long-poll), document the exception in ADR-011.

### X12 — e2e + docs (S)

e2e: reload-hydration (X1), value-timeline endpoint shape + 3-series render
(X9), interval slider still scopes/focuses, address-mode search returns
block-shaped tx list (X8), MEV filter icon state (X7), detector types surfaced
(X2). Update CLAUDE.md explorer paragraph + README; note ADR-011.

## Order & dependencies

Quick wins first: X4, X5, X7 (independent XS/S). X1 independent. X2 → X3 (both
improve fact coverage) and X2 gates X9's liquidation series. X11 and X10 are
the ADR-011 backend pair (X11 before/with X10 so the worker uses the shared
provider). X9 depends on X2 + X10. X8 mid-track. X6 pairs with the value-metric
decision shared by X9. X12 last. Suggested: X4/X5/X7 → X1 → X11 → X10 → X2 → X3
→ X6 → X9 → X8 → X12.

## Acceptance

- Reloading the explorer restores every classified tx/MEV row from Postgres
  (X1); no empty list after a session of classification.
- All MEV types with detector output (arb, sandwich, liquidation, liq sandwich,
  liq race, JIT, non-atomic arb, NFT flip) are surfaced where present, with a
  findings note explaining any that legitimately don't fire (X2); registries
  extended (X3).
- ETH mode labels currency as "xhi" on Income vs bid (and audited spots) (X4);
  block-number caption gone (X5); MEV filter uses a gray→green filter icon (X7).
- Arbitrage detail shows victim loss (X6).
- Header shows a Block/Address toggle + search; address-lookup txs render
  identically to block txs (X8).
- Timeline is a 3-series value-over-time graph from block 11,000,000 with the
  interval slider retained; the analysis slider and backfill button are gone
  and coverage is driven by the continuous worker (X9/X10).
- A single shared RPC provider serves all modules; inspection stays serial and
  the connection-cap degradation is not reintroduced (X11).

## Risks

- **Coverage scale (ADR-011).** [11,000,000 … head] ≈ 15M blocks at a serial,
  node-friendly rate is a multi-week fill. Treat "exhaustive" as a trend, not a
  precondition: the UI must render partially-filled ranges (gaps shown, not
  errors), and the value graph must handle sparse buckets. Do **not** relax the
  serial/timeout/cooldown safeguards to go faster — that is exactly what
  degrades the node.
- **Value metric definition.** X6 (victim loss) and X9 (value per type) hinge on
  defensible metrics per MEV type; agree arbitrage profit / sandwich profit /
  liquidation premium and victim-loss definitions before building the graph, or
  the series are meaningless.
- **Single provider = single failure domain (X11).** Consolidation is correct
  but centralizes degradation; keep the head-query vs. inspection distinction
  observable so a degraded node is diagnosable (memory `rpc-node-connection-cap`).
- **Interpretation flags:** "xhi" scope (X4), and whether `POST /api/backfill`
  should be fully removed or retained as ops-only (X10) — confirm at review.

## Findings (implementation, 2026-07-21)

All tasks landed on `ts-pi-framework`. ADR-011 is **Accepted**; ADR-012 / the
MEV-Discovery WP (`wp-mev-discovery.md`) are deferred to a separate effort.

- **X11 (RPC provider).** The "sharding" was 6 uncoordinated per-module
  `ethers.JsonRpcProvider` instances, not intentional sharding. Consolidated
  into `@mev/rpc` `getProvider()` (lazy singleton); server, inspector,
  inspectorLoop, builder, mempoolWatcher, tokens, and trace-api's provider all
  use it. Legacy `packages/eth` is left alone (not in the live path). The
  token-metadata request-coalescing (`tokens.ts`) is kept on top of the shared
  provider — batching bundles calls, coalescing avoids issuing them at all.
- **X10 (fill worker).** Added a process-wide serial queue (`backgroundInspect`)
  so the fill worker, head-follower, and manual backfill never race the capped
  node; interactive views stay non-blocking. `POST /api/backfill` is **retained
  as ops-only** (not removed). New status endpoint `GET /api/fill`.
- **X2 (surfacing).** Static analysis: the read/merge/render path is complete
  for all five detectors — the "only arb/sandwich" observation is firing-rate
  (classifier coverage: decode-only UniV4 / Balancer V2 Vault / `batchSwap`) plus
  deliberately strict thresholds, not a surfacing bug. See
  `detector-surfacing.md`; verify on a live corpus with the SQL there.
- **X9 / X6 value metric.** No price oracle at aggregation time, so the value
  graph and victim-loss are **WETH-denominated** (the EUR toggle re-prices at
  render). Victim loss for an atomic arbitrage = the arbitrage profit (value
  removed from the mispriced pools). `GET /api/mev-value` buckets arbitrage /
  sandwich / liquidation ETH; buckets are sparse until coverage fills.
- **X1.** Persistence is client-side: `loadBlock` stores `lastBlock`, `setLive`
  stores `live`; on load the viewer restores the last block unless follow-latest
  was on (a `?block=N` deep link still wins and disables follow).
- **Verification.** No live Postgres/RPC in this environment — verified via
  `pnpm turbo build` (all packages green), `pnpm biome check` (apps/packages +
  `e2e/`), and `pnpm --filter @mev/explorer-web build`. The e2e additions
  (`e2e/explorer.spec.ts`) are runtime-gated on an inspected corpus (`test.skip`
  when empty), so they exercise the new endpoints/UI only against a live stack.
- **Known follow-ups (out of scope).** Turn the decode-only UniV4 / Balancer V2
  Vault / `batchSwap` specs into swap-emitting classifiers (transfer-delta
  extraction) so MEV routed exclusively through those venues produces
  swaps/arbitrages.
