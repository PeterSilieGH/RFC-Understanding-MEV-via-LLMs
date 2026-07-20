# MEV Analysis Platform — Architecture

## Overview

A platform for analyzing Maximal Extractable Value (MEV) on Ethereum. It combines three proven components into one integrated, containerized stack:

1. **MEV Block Explorer** — trace-level MEV classification per block, based on Flashbots' mev-inspect-py plus five additional detectors (reference implementation: `mev-monitor/`).
2. **DiscoUI** — contract-source browsing and node/edge graph visualization, extracted from L2BEAT's `l2b` / `protocolbeat` / `discovery` packages (reference: `l2beat/` submodule, analysis in `docs/L2BEAT.md`).
3. **Agentic AI** — the pi coding harness (`@earendil-works/pi-coding-agent`) driving interpretation of execution traces and contract sources.

The platform answers: *for a given block or transaction, what MEV was extracted, how did the execution flow through which contracts, and what does it mean?* — with the last question answered interactively by an LLM agent grounded in the same data the UI shows.

## Global Requirements (binding)

| Requirement | Decision |
|---|---|
| Package manager / monorepo | pnpm workspaces + Turborepo ([ADR-001](adr/001-monorepo-tooling.md)) |
| Language | TypeScript everywhere (the inspector is native TS, `@mev/inspect` — ADR-010) |
| Lint / format | Biome |
| Frontends | Vite (+ React) |
| APIs | Express |
| Database | **One shared Postgres instance** for all services ([ADR-002](adr/002-shared-postgres-unified-env.md)) |
| Configuration | **One unified root `.env`** (API keys, RPC URLs, ports); `.env.example` kept in sync |
| Deployment | `docker compose` builds and runs every service as a container |

## Target Monorepo Layout

```
├── apps/
│   ├── explorer-api/        # Express — MEV explorer API (port of mev-monitor/server.js + lib/)
│   ├── explorer-web/        # Vite — explorer frontend (port of mev-monitor/public/)
│   ├── trace-api/           # Express — execution-trace + contract-source API (DiscoUI-derived)
│   ├── trace-web/           # Vite — standalone viewer (M2 deliverable; retired from compose, ADR-005)
│   ├── disco/               # DiscoUI clone (protocolbeat @ pinned commit) + trace panel (ADR-005)
│   └── agent-api/           # Express — pi-harness agent sessions over traces/contracts
├── packages/
│   ├── db/                  # Shared Postgres client, schema types, migrations for app-owned tables
│   ├── eth/                 # EthClient, PriceOracle, ProfitabilityEngine (absorbed from src/)
│   ├── trace-graph/         # Trace → graph model transforms (shared by trace-api and trace-web)
│   ├── inspect/             # @mev/inspect — native TS inspector (ADR-010): decode/classify/detect
│   ├── db/                  # Shared Postgres pool + owns the pipeline schema (migrate())
│   └── config/              # Unified .env loading + zod-validated config schema
├── mev-monitor/             # Reference implementation (JS/Python) — gitignored, offline reference only
│   └── mev-inspect-py/      # Retired as runtime dep (ADR-010); ported to packages/inspect
├── l2beat/                  # Git submodule — temporary read-only reference, to be obsoleted
├── docs/
│   ├── ARCHITECTURE.md      # This file
│   ├── L2BEAT.md            # DiscoUI/l2beat analysis and API map
│   └── adr/                 # Architecture Decision Records
├── .pi/                     # pi harness config (AGENTS.md, skills)
├── docker-compose.yml       # postgres + all apps
├── turbo.json / biome.json / pnpm-workspace.yaml
└── .env / .env.example      # Single source of configuration
```

## Data Flow

```
        reth/Erigon RPC (trace_block, debug_traceTransaction)
              │                          │
              ▼                          ▼
   @mev/inspect (in-process,      trace-api: getDebugTrace()
   on-demand per block)           call tree + contract sources
              │                          │
              ▼                          ▼
   ┌─────────────────────  Postgres (shared)  ─────────────────────┐
   │ pipeline tables: classified_traces, swaps, arbitrages, …      │
   │ detector tables: mev_jit_liquidity, mev_nft_flips, …          │
   │ app tables: block_builders, block_bids, trace/source caches   │
   └───────────────────────────────────────────────────────────────┘
              │                          │                    │
              ▼                          ▼                    ▼
        explorer-api                trace-api             agent-api
              │                          │                (pi harness)
              ▼                          ▼                    │
        explorer-web ── /ui/trace/:tx ─▶ disco (trace  ◀── annotates ┘
                                         panel + disco-api)
```

Two principles carried over from the reference implementations:

- **Decode, then pattern-match.** `@mev/inspect` (ADR-010) decodes raw traces into structured facts; the pattern-matchers and the five detectors run over those facts. The core decode/classify + arbitrage/sandwich/liquidation tables are written only by this pipeline; the five detectors write their own `mev_*` tables.
- **On-demand, in-process inspection.** No separate indexer service. The first request for a block triggers an in-process `inspectBlock()` (deduplicated per block number); results persist in Postgres. Bulk coverage via the backfill queue; an optional head-follower keeps the head warm.

## Milestones

Progress (2026-07-14): **M1–M4 complete and e2e-verified** (25/25 passing
against the live stack). Next up: M4.5 (trace workspace, ADR-008), then M5.

### M1 — Port the MEV Block Explorer to the platform stack

Extract the capabilities of `mev-monitor/` (Express API, five extra detectors, mempool watcher, builder/relay identification, EUR pricing, static frontend) into `apps/explorer-api` + `apps/explorer-web`, TypeScript, running as containers against the shared Postgres.

**Done when:** `docker compose up` serves the explorer; requesting a block triggers on-demand inspection; all detector classes from `mev-monitor/README.md` render; behavior verified against the reference implementation on the same block.

*Status: done ([ADR-003](adr/003-port-mev-monitor.md)).*

### M2 — Extract DiscoUI capabilities from l2beat

Stand up `apps/trace-api` exposing contract sources, discovery metadata, and `debug_traceTransaction` call trees, following the extraction map in `docs/L2BEAT.md` (provider patterns from `packages/discovery`, API patterns from `l2b`'s discovery-ui). `apps/trace-web` renders the DiscoUI-style project/contract views. The l2beat submodule stays unmodified and pinned.

**Done when:** for an address in an inspected block, the UI shows contract sources and metadata; for a tx hash, the API returns a normalized call-tree JSON (`eth:0x…` vs `0x…` address forms reconciled).

*Status: done. `apps/trace-web` was the M2 viewer; it was later retired from the compose stack in favor of the DiscoUI trace panel (ADR-005).*

### M3 — WebGL call-graph and execution-trace visualization

Add a WebGL-based graph renderer to `apps/trace-web` for transaction call trees (calls, delegatecalls, creates, logs, token flows), with a trace-specific graph model in `packages/trace-graph` — not a retrofit of DiscoUI's static `ApiProjectResponse` ([ADR-005](adr/005-webgl-trace-visualization.md)). Must handle large MEV transactions (pruning, clustering, lazy expansion).

**Done when:** a known arbitrage/sandwich tx renders as an interactive graph at 60fps for traces with thousands of calls; nodes link to contract sources from M2.

*Status: done, via a pivot: instead of a hand-rolled renderer in `trace-web`, the trace graph is a panel in a cloned DiscoUI (`apps/disco`) reusing its nodes-tab store and WebGL renderer (ADR-005, superseded-in-part).*

### M4 — Wire the explorer to the trace visualization

Every transaction in the explorer links to its execution trace view; trace nodes are enriched with explorer knowledge (MEV labels, token transfers, decoded swaps from Postgres) and discovery metadata (contract names, proxy implementations).

**Done when:** clicking a sandwich transaction in the explorer opens its trace with front-run/victim/back-run legs and the involved pool contracts visually annotated, and each contract's source is one click away.

*Status: done 2026-07-09 ([ADR-007](adr/007-trace-mev-enrichment.md)), acceptance verified by e2e 2026-07-14. Along the way the explorer also gained mempool-visibility persistence and statistics (public/private share + effective tip), pgAdmin, and RPC-degradation hardening (inspection timeouts, socket bounds).*

### M4.5 — Trace workspace: ported DiscoUI panel tabs ([ADR-008](adr/008-trace-workspace-panels.md))

The standalone trace view grows into a full DiscoUI workspace: List (incident-shaped folders) as entry point, discovery-named Nodes, stock Values/Code/Preview panels working against a synthetic per-incident discovery project, trace-scoped top/bottom bars, and a disabled Analyze tab reserved as M5's UI surface. Work package: [docs/design/wp-trace-workspace.md](design/wp-trace-workspace.md).

**Done when:** opening a sandwich deep link shows all legs' traces in List folders (Initial + one per leg); selecting a call in List or Nodes shows that contract's discovered fields (Values), verified sources (Code), and permissions dossier (Preview); the first open triggers exactly one bounded discovery run, subsequent opens are served from disk.

### M5 — Agentic AI over traces and contracts

`apps/agent-api` embeds the pi coding harness with tools to read the shared Postgres, fetch traces via trace-api, and retrieve contract sources — so an agent can answer "explain what this transaction did and why it was profitable" grounded in the same data the UI shows. Sessions stream to the frontends; `.pi/` skills define the research workflows.

The first UI surface (ADR-009) wires the disco **Analyze panel** to agent-api: three skills — *analyze-code* and *analyze-value* review the selected nodes' Code / Values "copy panel context" as an MEV expert (code is sent as parsed function signatures, with a `get_function_code` tool for on-demand bodies), and *build-preview* (triggered from the Preview panel) combines the stored analysis transcripts into a verdict about the transaction or the whole multi-tx incident. Runs stream NDJSON, persist to an app-owned `agent_runs` table, and mark covered nodes with two ticks. agent-api bakes in no model or key — credentials and the model come from the user's pi agent dir; `.pi/SYSTEM.md` overrides the system prompt.

**Done when:** from a trace view, a user can start an agent session about the visible transaction and receive a grounded, citable explanation referencing actual trace calls and source lines.

## External Dependencies

- **RPC node with `trace_block` + `debug_traceTransaction`** (reth or Erigon; plain geth lacks `trace_block`). Provided externally, configured via `.env` — never started by compose.
- **MEV-Boost relay data APIs** (winning-bid lookup) and **CoinGecko** (EUR prices) — public HTTP, cached in Postgres/memory.

## Notes & Caveats

- The inspector is native TypeScript (`@mev/inspect`, [ADR-010](adr/010-native-inspector.md)); mev-inspect-py is retired as a runtime dependency. The old USD-summary failure workaround is gone (the native engine has no such step). Bug fixes + protocol-coverage notes from the port: `docs/design/mev-inspect-audit.md`.
- DiscoUI's API is internal and unversioned — required parts are ported into the monorepo with provenance headers rather than imported; the pinned l2beat submodule is a temporary reference slated for removal ([ADR-004](adr/004-discoui-extraction.md)).
- `mev-monitor/` is a gitignored local checkout (nested git repos) with **no runtime role** since ADR-010 — kept only as an offline reference for verifying ported behavior.
- MEV traces can be huge; the trace API returns a reduced graph model by default, raw traces only on request.
