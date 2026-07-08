# RFC: Understanding MEV via LLMs

A platform for analyzing Maximal Extractable Value (MEV) on Ethereum. It combines a
trace-level **MEV Block Explorer** (based on Flashbots' mev-inspect-py), **contract-source
and call-graph visualization** (derived from L2BEAT's DiscoUI), and **agentic AI** (the pi
coding harness) that interprets execution traces and contracts grounded in the same data
the UI shows.

The target architecture and the five milestones — with acceptance criteria — are in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Design decisions are recorded as ADRs in
[`docs/adr/`](docs/adr).

## Repository layout

```
├── apps/
│   ├── explorer-api/   # Express — MEV explorer API (TypeScript port of mev-monitor)
│   ├── explorer-web/   # Vite — explorer frontend
│   ├── trace-api/      # Express — execution traces + contract sources (DiscoUI-derived)
│   └── trace-web/      # Vite + React — call-tree & source viewer (WebGL graph in M3)
├── packages/
│   ├── config/         # Unified .env loading, zod-validated (@mev/config)
│   ├── db/             # Shared Postgres pool + app-owned tables (@mev/db)
│   ├── eth/            # EthClient, PriceOracle, ProfitabilityEngine (@mev/eth)
│   └── trace-graph/    # Trace graph model + transforms (@mev/trace-graph)
├── mev-monitor/        # Reference implementation (plain JS) — gitignored local checkout
│   └── mev-inspect-py/ # Patched Flashbots inspector, consumed only as a docker image
├── l2beat/             # Git submodule — temporary read-only reference, to be obsoleted
├── docs/               # ARCHITECTURE.md, L2BEAT.md analysis, adr/
├── .pi/                # pi harness config (AGENTS.md, /skill:mev)
├── docker-compose.yml  # postgres + all services
└── .env / .env.example # One unified config file for everything
```

Planned apps (see milestones M2–M5): `trace-api`, `trace-web` (WebGL call-graph
visualization), and `agent-api` (pi-harness agent sessions).

## Prerequisites

- Node.js v22 (`.node-version`), pnpm, Docker with compose
- An Ethereum RPC node with `trace_block` and `debug_traceTransaction` support —
  reth or Erigon; plain geth won't work. This is the one external dependency the
  compose stack does not provide. `scripts/tunnel.sh` manages an SSH tunnel to a
  remote node and binds it on both loopback and the docker bridge, so containers
  reach it as `http://host.docker.internal:<port>` (`RPC_URL_DOCKER`).
- With a default-deny firewall (e.g. ufw), admit docker-network traffic to the
  bridge-bound tunnel port:
  `sudo ufw allow from 172.16.0.0/12 to 172.17.0.1 port 8545 proto tcp`

## Quick start

```bash
# 1. Configure — one .env for everything
cp .env.example .env
# set at least RPC_URL

# 2. Install & build
pnpm install
pnpm build          # turbo build across the workspace

# 3. Build the mev-inspect-py image + run migrations
#    (needs the gitignored mev-monitor/ checkout locally; the image is the
#    only thing the platform uses from it)
docker compose --profile tools build mev-inspect
docker compose --profile tools run --rm mev-inspect -m alembic upgrade head

# 4. Run everything as containers
docker compose build
docker compose up -d

# Explorer:  http://localhost:8080  (EXPLORER_WEB_PORT)
# API:       http://localhost:3000  (EXPLORER_API_PORT)
# Traces:    http://localhost:8081  (TRACE_WEB_PORT)
# Trace API: http://localhost:2021  (TRACE_API_PORT; contract sources need ETHERSCAN_API_KEY)
```

Requesting a block in the explorer triggers on-demand inspection: `explorer-api` runs the
`mev-inspect-py:local` image once for that block, which writes classified traces, swaps,
arbitrages, sandwiches, and liquidations to the shared Postgres. There is no background
indexer.

## Development

```bash
pnpm dev                                  # turbo dev (all apps)
pnpm --filter @mev/explorer-api dev       # API only (tsx watch)
pnpm --filter @mev/explorer-web dev       # frontend only (vite, proxies /api)

pnpm test                                 # all tests via turbo
pnpm --filter @mev/eth exec vitest run tests/oracle.test.ts   # single test file

pnpm lint                                 # biome check apps packages
pnpm format                               # biome format --write
```

For local (non-container) dev you still need the shared Postgres:
`docker compose up -d postgres`.

## MEV detection

Detection is two steps: **decode, then pattern-match**. mev-inspect-py decodes raw block
traces into structured facts and pattern-matches a fixed set of strategies (arbitrage,
sandwiches, liquidations, NFT trades, punk snipes). The explorer adds five read-only
detectors over those facts, covering gaps flagged in MEV literature:

| Detector | What it finds |
|---|---|
| JIT liquidity | Uniswap V3 position minted and removed within one block, around a swap |
| Non-atomic arbitrage | A round trip split across two transactions from the same sender |
| Liquidation sandwich | The liquidator's own swap pushing a position underwater first |
| Liquidation race | Competing liquidation attempts on the same borrower; losers revert |
| NFT flip | Same NFT bought and resold at a profit within one block |

The full write-up of the pipeline, heuristics, and their research basis is in
[`mev-monitor/README.md`](mev-monitor/README.md).

## Using the pi harness

```bash
npx pi          # from the repo root
```

Then `/skill:mev` loads the MEV research workflow. Agent instructions live in
[`.pi/AGENTS.md`](.pi/AGENTS.md). This project is for detection, analysis, simulation,
and research reporting — not for building extraction bots that harm ordinary users.

## Status

- [x] Monorepo: pnpm workspaces + Turborepo + Biome, unified `.env`, docker compose (ADR-001/002)
- [x] M1 (in progress): `mev-monitor` ported to TypeScript (`explorer-api` + `explorer-web`);
      remaining: behavior verification against the reference on live-inspected blocks
- [x] M2 (in progress): `trace-api` + `trace-web` — call-tree graphs via
      `debug_traceTransaction`, contract sources/metadata via Etherscan;
      remaining: discovery-style relation metadata, verification against live traces
- [ ] M3 — WebGL call-graph and execution-trace visualization
- [ ] M4 — Explorer ↔ trace visualization wiring
- [ ] M5 — Agentic AI over traces and contracts (`agent-api`)

## License

MIT
