# Work package: Trace workspace polish (post-M4.5, refines ADR-008)

User-directed UI refinements to the trace workspace after the ADR-008
completion (commit 221c8e2d). The workspace's information architecture
stays; this package removes duplicated chrome from the nodes panel and
moves per-call detail into the docking system.

## Tasks

### P1 — Nodes panel loses the manual trace form (XS)

The tx-hash input + "Trace" button only render on the manual `/ui/trace`
page (no `:txHash` route param). In the workspace and on the resolve screen
the deep link already determines the transaction; leg switching happens
through the List panel.

### P2 — Call-type prefixes out, legend in (S)

Node headers drop the `CALL` / `STATICCALL` / `DELEGATECALL` prefix (title
becomes the resolved contract name / shortened address); field rows drop
the lowercase type prefix (just the decoded function name or selector).
The call type stays expressed through the existing node colors; a small
legend overlay in the graph corner maps color → call type / reverted /
decoded swap.

### P3 — Call details become a `Trace` section in Values (M)

Clicking a node no longer opens the floating details window inside the
graph. The selected call's facts and decoded swap render as a **"Trace"
folder section inside the Values panel**, alongside Fields/ABI (revised
per user direction from an initial docked-pane variant; the panel catalog
stays untouched — no `trace` panel id). No source viewer in the section:
the Code panel owns sources. Cross-panel plumbing: the graph publishes its
active transaction hash in the trace workspace store; the section reads
the shared nodes-store selection and renders nothing outside the trace
workspace. Storage key bumps (`docking/v4:trace`) past the short-lived
docked variant.

### P4 — Pool names for decoded swaps (XS)

Wherever a decoded swap surfaces its pool (`swap.contractAddress`), show
the discovered contract name from the synthetic project instead of the
bare address (address stays as the Etherscan link target).

### P5 — MEV strip out, extracted value into the TopBar (S)

The strip above the graph (incident badges, leg-jump buttons, "x decoded
swaps highlighted") is removed — the List panel already navigates legs.
The TopBar incident identity becomes `<kind> · <extracted value>`
(e.g. `sandwich · 0.0028 WETH`), the value taken from the first MEV entry
with a profit across the incident's legs; falls back to the short tx hash
while MEV facts load or when no profit is attributed. Shared label/amount
helpers move to `mev-format.ts`.

### P6 — Verification + docs (S)

Rebuild disco-web; adjust e2e (node titles no longer carry `CALL`, strip
assertions replaced by legend/TopBar-value assertions, four default
panels); in-browser screenshot pass; record findings here.

## Findings (2026-07-15, implemented and verified)

- All six tasks landed in one pass; `pnpm tsc --noEmit` clean, verified
  in-browser on the trace-49b09f78 sandwich: no form, legend bottom-left,
  prefix-free node titles (`UniswapV3Pool ⇅ uniswap_v3`), default layout
  `list | nodes | values/trace`, TopBar `sandwich · -0.6398 WETH` (red for
  negative - matches the explorer's attribution for this incident), swap
  node click fills the trace tab with named pool details.
- The Trace section subscribes to `traceNodesStore` directly (no
  `NodesStoreProvider` needed) and joins the selection onto the MEV facts
  of the leg published via `activeTxHash` - the react-query key
  `['mev-tx', hash]` is shared with the graph, so no extra fetches.
- P3 was revised mid-package on user direction: first shipped as a docked
  `trace` pane under Values, then folded into the Values panel as a
  Folder section like Fields/ABI, dropping the source-viewer button (the
  Code panel owns sources). One consequence: the section only shows for
  calls whose selection lands in the Values panel scroll - it renders
  above the contract sections and independently of them.
- Selector-less calls label their field `()` (plain value transfer) or
  `create`; the legend swatches come from `getColor` itself, so they stay
  in sync with the node palette by construction.
- The `trace` panel id returned to the catalog, but project workspaces
  hide it in the switcher (route check in PanelHeader) - ADR-008's "no
  trace tab in projects" e2e assertion still passes unchanged.

## Risks / notes

- Removing the strip also removes the "block not inspected" hint from the
  manual trace page; acceptable — the workspace resolve ribbon and the
  explorer cover it.
- The `trace` details panel depends on the shared nodes-store selection;
  the graph and panel must agree on the active leg (published hash).
