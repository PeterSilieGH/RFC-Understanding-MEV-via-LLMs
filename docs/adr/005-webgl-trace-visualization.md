# ADR-005: Trace visualization inside a cloned DiscoUI, reusing its nodes-panel renderer

## Status

Accepted — 2026-07-08. **Superseded in part — 2026-07-09**: instead of a
hand-rolled WebGL renderer in `apps/trace-web`, the trace graph is a panel
inside a cloned DiscoUI (`apps/disco`), heavily reusing the nodes tab
(decided during M3; the original text is below the divider).

## Context

MEV transactions produce large call trees — thousands of calls through routers, pools, and proxies. Protocolbeat (DiscoUI's frontend) already ships a proven graph stack for its contract graph: a zustand store with drag/pan/zoom/selection/undo/hide/color and persisted layouts, a DOM renderer, and a WebGL renderer (`NodesAndConnectionsWebGL`). Building a second renderer in `apps/trace-web` would duplicate all of it.

## Decision

- **Clone protocolbeat into `apps/disco`** (ADR-004: port, don't import; pinned at l2beat@18532eac). `src/vendor/` replaces the `@l2beat/*` workspace packages via tsconfig/vite aliases so the 300+ cloned files stay byte-identical to upstream; deliberate edits are marked `DIVERGENCE(mev)`.
- **The trace graph is a new `trace` panel** in DiscoUI's multi-view tabs, next to `nodes`. It reuses the nodes panel wholesale: the store was factory-ized (`createNodesStore`) with the instance resolved through React context, so the discovery graph and the trace graph coexist with identical behavior — including the WebGL renderer path (`useExperimentalRenderer` preference).
- `packages/trace-graph` keeps the shared model (call nodes, typed edges, ERC20-transfer overlay) plus `layoutTraceGraph`, a deterministic tidy-tree layout (depth on x, siblings stacked by actual node height on y) applied after load; users can then drag/re-layout with the standard controls, and per-trace layouts persist like project layouts do.
- The trace panel maps `TraceGraph` → DiscoUI `Node[]`: one node per call (id = trace path), one field per child call (typed edge label: kind + selector), colors by call kind, revert marking, token-transfer counts.
- The DiscoUI backend (`l2b ui --readonly`) runs unmodified from the submodule via its own `Dockerfile.disco-ui`; nginx routes `/api/traces` to our `trace-api` and the rest of `/api` to it.

## Consequences

- The trace view inherits every nodes-tab capability (and future upstream improvements port over by re-cloning) at the cost of carrying ~1.7 MB of cloned source in-tree.
- The `DIVERGENCE(mev)` markers and vendor README are the re-porting contract: upstream refreshes mean re-clone + re-apply marked edits.
- `apps/trace-web` remains as the lightweight standalone viewer (M2 deliverable); the DiscoUI trace panel is the primary visualization going forward.
- Scale beyond the renderer (server-side pruning, `?maxDepth` lazy expansion) still lives in the model/API, unchanged from the original decision.

---

### Original decision (2026-07-08, superseded)

- `packages/trace-graph` defines the graph model shared by API and frontend; the transform runs server-side in `trace-api`; raw traces behind a separate endpoint. *(unchanged)*
- `apps/trace-web` renders this model with a hand-rolled WebGL renderer, layout in a web worker. *(superseded by the DiscoUI panel above)*
- Scale handled in the model: pruning, clustering, depth-limited queries. *(unchanged)*
- Explorer/discovery enrichment attaches as overlays on the same model — the integration surface for M4. *(unchanged)*
