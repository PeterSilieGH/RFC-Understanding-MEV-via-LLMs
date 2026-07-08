# ADR-005: WebGL-based call-graph and execution-trace visualization

## Status

Accepted — 2026-07-08

## Context

MEV transactions produce large call trees — thousands of calls through routers, pools, and proxies. SVG/DOM graph renderers degrade well below that scale. Protocolbeat already contains WebGL node/edge rendering concepts for its contract graph, and the milestone requires trace visualization to be WebGL-based. The data source is the `DebugTransactionCall` tree (`debug_traceTransaction` with `callTracer` + `withLog`) from M2.

## Decision

- `packages/trace-graph` defines the graph model shared by API and frontend: call nodes (`id`, `depth`, `from`, `to`, `type`, `selector`, `decodedFunction`, `value`, `contractName`), typed edges (`CALL | DELEGATECALL | STATICCALL | CREATE | LOG`), plus overlays for token transfers and MEV labels. The transform from raw trace to model runs server-side in `trace-api`; raw traces are available only behind a separate endpoint.
- `apps/trace-web` renders this model with a WebGL renderer (regl/pixi-level abstraction or hand-rolled, following protocolbeat's renderer concepts), with layout computed off the render thread (web worker).
- Scale is handled in the model, not just the renderer: server-side pruning of zero-value STATICCALL leaf noise (opt-in to expand), clustering of repeated identical subtrees, and lazy expansion of collapsed subtrees via depth-limited queries.
- Explorer/discovery enrichment (MEV labels, token flows, contract names, proxy implementations) attaches as overlays on the same model — this is the integration surface for M4.

## Consequences

- A custom renderer is a significant frontend investment; it is justified by the hard scale requirement and is the milestone's core deliverable.
- The 60fps-at-thousands-of-calls acceptance criterion (M3) gates merging: a canvas prototype that misses it doesn't ship.
- Because the model is shared and serialized, the renderer can be developed and tested against fixture traces (recorded from known arbitrage/sandwich txs) without a live RPC.
