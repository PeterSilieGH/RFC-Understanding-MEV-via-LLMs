# ADR-007: Explorer ↔ trace wiring via a per-transaction MEV endpoint

## Status

Accepted — 2026-07-09 (M4).

## Context

M4 requires the two halves of the platform to reference each other: every
explorer transaction should open its execution trace, and the trace view
should show what the explorer's detectors know about that transaction
(MEV role, decoded swaps, the other legs of multi-tx strategies) with
contract sources one click away.

The MEV facts live in the shared Postgres and are merged per transaction by
`explorer-api`'s `getBlockMev()` — including the five extra detectors, which
are block-scoped heuristics with no per-tx query form. The trace graph lives
in `trace-api`/`apps/disco`, keyed by trace paths (`"0.1.2"`). mev-inspect's
`swaps.trace_address` (`integer[]`) is the natural join between the two
worlds.

## Decision

- **`explorer-api` owns the enrichment**: a new `GET /api/mev/tx/:txHash`
  resolves the block from `miner_payments`, runs the existing `getBlockMev()`
  merge, and returns that one transaction (`{ inspected, blockNumber,
  transaction }`). MEV logic is not duplicated into trace-api. The endpoint
  never triggers inspection; for unknown txs it resolves the block number via
  RPC so the UI can link to the explorer's block view (which inspects on
  demand, `?block=` deep link).
- **`BlockSwap` carries `traceAddress`** so the trace panel can map each
  decoded swap onto exactly one graph node (`[] → "root"`, `[0,1] → "0.1"`).
- **The trace panel overlays, never re-detects**: swap nodes turn orange with
  the protocol name; a strip above the graph shows the transaction's merged
  `mev[]` entries with jump buttons for related transactions
  (sandwich front-/back-run, victims, JIT counterpart, race winner/losers).
  A details sidebar for the selected node shows call facts, the decoded swap,
  and fetches verified sources from trace-api (`/api/contracts/:addr/code`).
- **Deep links**: `apps/disco` gains a standalone route `/ui/trace/:txHash`
  (full-screen TracePanel, no discovery-project context), and every tx row in
  `explorer-web` links to it. The explorer's DiscoUI port reaches the static
  frontend via an nginx-injected `/env.js` (`window.__ENV`), defaulting to
  the compose ports.
- **Routing**: disco-web's nginx (and the vite dev proxy) sends `/api/mev` to
  explorer-api and `/api/contracts` to trace-api; `/api/traces` was already
  routed to trace-api (ADR-005).

## Consequences

- The trace view degrades gracefully: without an inspected block it still
  renders the raw trace and points at the explorer for inspection; without
  RPC trace support it still shows the MEV strip.
- `getBlockMev()` per tx re-computes the whole block (detectors are
  block-scoped). Acceptable at research scale; a per-block cache in
  explorer-api is the obvious optimization if it ever hurts.
- The `/env.js` pattern is the precedent for frontend-to-frontend links in a
  static-nginx deployment (no build-time port coupling).
