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
| Language | TypeScript everywhere (mev-inspect-py stays Python, containerized) |
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
│   ├── trace-web/           # Vite — lightweight call-tree + source viewer
│   ├── disco/               # DiscoUI clone (protocolbeat @ pinned commit) + trace panel (ADR-005)
│   └── agent-api/           # Express — pi-harness agent sessions over traces/contracts
├── packages/
│   ├── db/                  # Shared Postgres client, schema types, migrations for app-owned tables
│   ├── eth/                 # EthClient, PriceOracle, ProfitabilityEngine (absorbed from src/)
│   ├── trace-graph/         # Trace → graph model transforms (shared by trace-api and trace-web)
│   └── config/              # Unified .env loading + zod-validated config schema
├── mev-monitor/             # Reference implementation (JS) — gitignored local checkout
│   └── mev-inspect-py/      # Patched inspector, consumed only as docker image (Python)
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
   mev-inspect-py (on-demand      trace-api: getDebugTrace()
   docker run per block)          call tree + contract sources
              │                          │
              ▼                          ▼
   ┌─────────────────────  Postgres (shared)  ─────────────────────┐
   │ mev-inspect tables: classified_traces, swaps, arbitrages, …   │
   │ app tables: block_builders, block_bids, trace/source caches   │
   └───────────────────────────────────────────────────────────────┘
              │                          │                    │
              ▼                          ▼                    ▼
        explorer-api                trace-api             agent-api
              │                          │                (pi harness)
              ▼                          ▼                    │
        explorer-web  ── links tx ──▶ trace-web  ◀── annotates ┘
```

Two principles carried over from the reference implementations:

- **Decode, then pattern-match.** mev-inspect-py decodes raw traces into structured facts; all MEV detectors (its own and the five extra ones) are read-only pattern matches over those facts. New detectors follow the same rule: query, never write, mev-inspect-py's tables.
- **On-demand inspection.** No background indexer. The first request for a block triggers a containerized `mev-inspect-py` run (deduplicated per block number); results persist in Postgres.

## Milestones

### M1 — Port the MEV Block Explorer to the platform stack

Extract the capabilities of `mev-monitor/` (Express API, five extra detectors, mempool watcher, builder/relay identification, EUR pricing, static frontend) into `apps/explorer-api` + `apps/explorer-web`, TypeScript, running as containers against the shared Postgres.

**Done when:** `docker compose up` serves the explorer; requesting a block triggers on-demand inspection; all detector classes from `mev-monitor/README.md` render; behavior verified against the reference implementation on the same block.

### M2 — Extract DiscoUI capabilities from l2beat

Stand up `apps/trace-api` exposing contract sources, discovery metadata, and `debug_traceTransaction` call trees, following the extraction map in `docs/L2BEAT.md` (provider patterns from `packages/discovery`, API patterns from `l2b`'s discovery-ui). `apps/trace-web` renders the DiscoUI-style project/contract views. The l2beat submodule stays unmodified and pinned.

**Done when:** for an address in an inspected block, the UI shows contract sources and metadata; for a tx hash, the API returns a normalized call-tree JSON (`eth:0x…` vs `0x…` address forms reconciled).

### M3 — WebGL call-graph and execution-trace visualization

Add a WebGL-based graph renderer to `apps/trace-web` for transaction call trees (calls, delegatecalls, creates, logs, token flows), with a trace-specific graph model in `packages/trace-graph` — not a retrofit of DiscoUI's static `ApiProjectResponse` ([ADR-005](adr/005-webgl-trace-visualization.md)). Must handle large MEV transactions (pruning, clustering, lazy expansion).

**Done when:** a known arbitrage/sandwich tx renders as an interactive graph at 60fps for traces with thousands of calls; nodes link to contract sources from M2.

### M4 — Wire the explorer to the trace visualization

Every transaction in the explorer links to its execution trace view; trace nodes are enriched with explorer knowledge (MEV labels, token transfers, decoded swaps from Postgres) and discovery metadata (contract names, proxy implementations).

**Done when:** clicking a sandwich transaction in the explorer opens its trace with front-run/victim/back-run legs and the involved pool contracts visually annotated, and each contract's source is one click away.

### M5 — Agentic AI over traces and contracts

`apps/agent-api` embeds the pi coding harness with tools to read the shared Postgres, fetch traces via trace-api, and retrieve contract sources — so an agent can answer "explain what this transaction did and why it was profitable" grounded in the same data the UI shows. Sessions stream to the frontends; `.pi/` skills define the research workflows.

**Done when:** from a trace view, a user can start an agent session about the visible transaction and receive a grounded, citable explanation referencing actual trace calls and source lines.

## External Dependencies

- **RPC node with `trace_block` + `debug_traceTransaction`** (reth or Erigon; plain geth lacks `trace_block`). Provided externally, configured via `.env` — never started by compose.
- **MEV-Boost relay data APIs** (winning-bid lookup) and **CoinGecko** (EUR prices) — public HTTP, cached in Postgres/memory.

## Notes & Caveats

- mev-inspect-py's USD-summary step fails without a price feed; treat that failure as success when the block row exists (see `mev-monitor/lib/inspector.js`).
- DiscoUI's API is internal and unversioned — required parts are ported into the monorepo with provenance headers rather than imported; the pinned l2beat submodule is a temporary reference slated for removal ([ADR-004](adr/004-discoui-extraction.md)).
- `mev-monitor/` is a gitignored local checkout (nested git repos); the platform's only runtime dependency on it is building `mev-inspect-py:local` via the compose `tools` profile.
- MEV traces can be huge; the trace API returns a reduced graph model by default, raw traces only on request.
