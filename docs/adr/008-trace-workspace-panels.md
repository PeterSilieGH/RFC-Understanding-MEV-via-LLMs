# ADR-008: The trace view becomes a full DiscoUI workspace (ported panel tabs)

## Status

Accepted — 2026-07-14. Implementation pending (next trace milestone); the
Analyze tab is explicitly deferred to the agent milestone (M5, ADR-006).

## Context

Today the trace feature is a single panel: `/ui/trace/:txHash` renders one
full-screen `TracePanel` (graph + MEV strip + details sidebar), with no
multi-view layout around it (ADR-005/007). The cloned DiscoUI, however, ships
a complete workspace we already carry in-tree: dockable panels
(list/values/nodes/code/preview/analyze/…) around a shared selection store
(`panel-store`), a TopBar (search, discover/kill, layout slots, panel
management) and a BottomBar (status ribbon, keyboard shortcuts). Those panels
are all *project-scoped*: they consume `l2b ui`'s per-project API
(`getProject`, `getCode`, `getPreview`, …), where a "project" is a discovery
output (`discovered.json`) whose contracts have names, fields, templates,
sources, and permission metadata produced automatically by the discovery
pipeline.

MEV analysis wants exactly that workspace, but keyed by an *incident* rather
than a project: a sandwich is three or more transactions (front-run, victims,
back-run), each with its own call tree, all touching an overlapping set of
contracts. The MEV facts per transaction (legs, counterpart tx hashes,
victims, swap trace addresses) already come from `explorer-api`'s
`GET /api/mev/tx/:txHash` (ADR-007).

## Decision

### One trick makes the ported panels cheap: a trace is a synthetic project

The trace workspace represents the incident as a **synthetic, disposable
discovery project** named `trace-<first 8 hash hex>`: on first open, the
unique contract addresses of the incident's traces are fed as
`initialAddresses` to a **bounded** discovery run (no recursive reference
following beyond the trace's own address set; discovery cache shared with
regular runs, `RPC_MAX_SOCKETS` applies). The output is a normal
`discovered.json`, so **Values, Code and Preview work against `disco-api`
unmodified** — no MEV-specific forks of those panels. Synthetic projects are
excluded from the home page project list, live alongside regular projects in
the bind-mounted projects dir, and are deletable at any time (nothing but a
cache).

Contract addresses repeat massively across incidents (routers, pools, WETH),
so the per-address discovery cache keeps repeat cost near zero after the
first few incidents.

### The tabs

- **List — the entry point.** Replaces the project List's `Initial /
  Discovered / EOAs` folders with incident-shaped folders:
  - **Initial** holds the root node of every leg of the MEV incident — for a
    sandwich: the front-run root, each victim's root, the back-run root. For
    a transaction with no detected MEV it holds just that transaction's root.
  - **One folder per leg** (`Front-run`, `Victim` / `Victim 2`, …,
    `Back-run`), containing that leg's remaining call-tree nodes in trace
    order. Folder legs map 1:1 to the transactions returned by the MEV
    endpoint (`counterpartTxHash`, `victimTxHashes`), which means the
    workspace loads *all* of the incident's traces, not just the deep-linked
    one.
  - Entries are call nodes (id = trace path within a leg), displayed with the
    resolved contract name (below) plus the decoded selector; selecting one
    drives the shared selection like the project List does today.
- **Nodes** stays the graph we have (factory-ized nodes store, WebGL path,
  ADR-005) with one addition: **automatic naming from discovery output**.
  Node titles use the synthetic project's contract names (template/meta names
  when discovery matched one, else the verified source name, else shortened
  address), and node fields get names by decoding call selectors against the
  discovered ABIs instead of raw 4-byte selectors. The MEV overlay (ADR-007)
  is unchanged.
- **Values / Code** are the stock DiscoUI panels pointed at the synthetic
  project. Selecting a node in List or Nodes resolves to its contract address
  in the shared `panel-store`; Values then shows the discovered fields
  (auto-named by handlers/templates) of that contract, Code fetches its
  verified sources through `getCode` into the editor view. The trace-specific
  details sidebar (call facts, decoded swap) stays part of the trace panel
  itself.
- **Preview** works as it does in DiscoUI: it renders the project's
  *publish preview* — the endpoint (`getPreview`) walks the discovery output
  and returns, per chain, the **permission structure** (roles and actors with
  their addresses, multisig participants, descriptions) and the **contract
  list** (name, description from templates, "can be upgraded by X with Y
  delay"). The panel highlights whichever entry contains the currently
  selected address and has a "show only selected" filter. In the trace
  workspace this becomes the incident dossier: who controls the contracts the
  MEV bot touched, which of them are upgradable proxies and by whom — with
  the selected call's contract highlighted.
- **Analyze** is ported as a tab but **reserved for the agent integration
  (M5, ADR-006)**: its existing shape — pick a target, run a backend
  analyzer, render a markdown report — is exactly the surface the pi-based
  `agent-api` will fill (per-incident interpretation instead of per-source
  static analysis). Until then the tab ships disabled with a pointer to this
  ADR.

### Top and bottom bars

The standalone trace route wraps the docked panels with the same two bars the
project page has, trimmed to trace semantics:

- **TopBar**: incident identity (tx hash / MEV type instead of project name),
  node search, the layout-slot switcher (1–6), add-panel, reset-layout, and
  settings. The Discover/Kill pair drives the bounded synthetic-project
  discovery run (with the terminal panel available for its output).
- **BottomBar**: the status ribbon (discovery/trace fetch state — this is
  where "inspecting block…", "trace unavailable, node degraded" and RPC
  health surface), fullscreen/remove/add panel shortcuts, layout hotkeys and
  the F1 help overlay — all inherited, plus trace-load status.
- The docked layout persists under its own storage key
  (`docking/v2:trace`), defaulting to `list | nodes | values`.

## Consequences

- The `/ui/trace/:txHash` deep link (used by every explorer row) now opens a
  workspace instead of a lone panel; the panel-only form remains available
  inside discovery projects as today.
- First view of an incident costs a bounded discovery run against the RPC
  node (state-read traffic, the class that hurts a degraded node) — mitigated
  by the shared discovery cache, the socket cap, and the fact that the
  address set is fixed up front. Subsequent views are served from disk.
- Synthetic `trace-*` projects accumulate in the projects dir; they are
  disposable caches, filtered from project listings, and trivially cleaned
  (`rm -r`). If growth ever matters, an LRU sweep is the obvious fix.
- Values/Code/Preview stay byte-identical to upstream (re-porting against a
  newer submodule pin stays reviewable, ADR-004/005); the new surface area is
  concentrated in List's incident folders, node naming, and the trace
  TopBar/BottomBar variants — all `DIVERGENCE(mev)`-marked.
- Selection is address-based in the shared store but node-based in
  List/Nodes; two nodes calling the same contract select the same address in
  Values/Code/Preview. That is the correct semantic (those panels describe
  contracts, not calls) and the trace sidebar keeps the per-call view.
- The Analyze tab's contract (target + run + markdown report) becomes a
  design constraint on `agent-api`'s HTTP surface for M5.
