# RFC: Understanding MEV via LLMs

A platform for analyzing Maximal Extractable Value (MEV) on Ethereum. It combines a
trace-level **MEV Block Explorer** (a native TypeScript port of Flashbots' inspector), **contract-source
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
│   ├── agent-api/      # Express — persistent pi sessions + reusable analysis bundles
│   ├── trace-web/      # Vite + React — standalone viewer (retired from the compose stack)
│   └── disco/          # DiscoUI clone (protocolbeat @ pinned commit) + trace panel
├── packages/
│   ├── config/         # Unified .env loading, zod-validated (@mev/config)
│   ├── db/             # Shared Postgres pool + app-owned tables (@mev/db)
│   ├── eth/            # EthClient, PriceOracle, ProfitabilityEngine (@mev/eth)
│   ├── inspect/        # Native trace decode/classify/detect pipeline (@mev/inspect)
│   ├── rpc/            # Shared ethers RPC provider (@mev/rpc)
│   ├── flat-store/     # Content-addressed flattened-source store prototype
│   └── trace-graph/    # Trace graph model + transforms (@mev/trace-graph)
├── mev-monitor/        # Reference implementation (plain JS) — gitignored local checkout
│   └── mev-inspect-py/ # Retired runtime; offline behavior-verification reference only
├── l2beat/             # Git submodule — temporary read-only reference, to be obsoleted
├── docs/               # ARCHITECTURE.md, L2BEAT.md analysis, adr/
├── .pi/                # pi harness config (AGENTS.md, /skill:mev)
├── docker-compose.yml  # postgres + all services
└── .env / .env.example # One unified config file for everything
```

## Prerequisites

- Linux with Git, OpenSSH, Docker Engine, and the Compose v2 plugin. The stack
  uses host networking so a host-local RPC endpoint remains reachable without
  exposing it on a Docker bridge.
- Node.js v22.22.3 (`.node-version`). Corepack installs the repository-pinned
  pnpm 10.33.4.
- An Ethereum RPC node with `trace_block` and `debug_traceTransaction` support —
  reth or Erigon; plain geth is insufficient. Archive state and usable
  `eth_getLogs` performance are strongly recommended. Compose does not start an
  Ethereum node.
- A configured pi coding-agent directory if agentic analysis is required.
  `agent-api` reads credentials, models, and the default model from that
  directory; no model or API key is baked into its image.

## Set up on a new device

### 1. Clone the repository and submodule

```bash
git clone --recurse-submodules \
  https://github.com/PeterSilieGH/RFC-Understanding-MEV-via-LLMs.git
cd RFC-Understanding-MEV-via-LLMs

# Safe to repeat if the initial clone omitted --recurse-submodules.
git submodule update --init --recursive
```

`l2beat/` is a pinned, temporary, read-only reference. Do not commit generated
projects or other submodule working-tree changes.

### 2. Install the JavaScript toolchain

Install the Node version from `.node-version` with your preferred version
manager, then:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

The host install is needed for development and tests. Docker images also install
their filtered dependencies during `docker compose build`.

### 3. Configure the unified environment

```bash
cp .env.example .env
```

Edit `.env` and set at least:

- `RPC_URL`: the reth/Erigon endpoint. Because services use host networking,
  `http://localhost:<port>` works for a node or SSH tunnel on the same host.
- `POSTGRES_PASSWORD`: replace the development default on a shared machine.
- `DISCO_UID` and `DISCO_GID`: use `id -u` and `id -g`. This keeps synthetic
  discovery projects owned by your host user.
- `PI_AGENT_DIR`: normally `${HOME}/.pi/agent`.
- `ETHERSCAN_API_KEY`: recommended for verified sources and discovery.

Optional keys and worker settings are explained inline in `.env.example`.
`RPC_URL_DOCKER` is retained for older bridge-based workflows but is not used by
the current host-networked Compose stack.

If the RPC node is remote, create an SSH local forward or adapt
`scripts/tunnel.sh`, then verify the endpoint:

```bash
curl -sS -X POST "$RPC_URL" \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
```

### 4. Configure pi for agentic research

Run pi once on the host, configure/authenticate a provider, and select a default
model. This should create the directory referenced by `PI_AGENT_DIR`:

```bash
pnpm exec pi
test -d "${HOME}/.pi/agent"
```

Without a configured pi directory, explorer and trace features still run, but
Discovery analysis cannot start a model session.

### 5. Create persistent storage and start the stack

The Postgres volume is deliberately external so `docker compose down -v` cannot
erase inspected blocks. Create it once on a new machine:

```bash
docker volume create mev_inspect_pgdata
docker compose build
docker compose up -d
docker compose ps
```

Schema migration runs automatically when `explorer-api` starts; there is no
mev-inspect-py image, tools profile, Alembic command, or per-block container.

### 6. Open and verify the services

| Service | URL |
|---|---|
| Explorer | <http://localhost:8080> |
| Explorer API | <http://localhost:3000> |
| DiscoUI | <http://localhost:8082> |
| Disco API | <http://localhost:2021> |
| Trace API | <http://localhost:2022> |
| Agent API | <http://localhost:3100> |
| pgAdmin | <http://localhost:5050> |

```bash
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:2021/health
curl -fsS http://localhost:2022/health
curl -fsS http://localhost:3100/health
docker compose logs --tail=100
```

To stop services without removing inspected data:

```bash
docker compose down
```

Requesting a block in the explorer triggers on-demand inspection: `explorer-api` calls the
native `@mev/inspect` engine in-process (ADR-010 — no per-block container) for that block,
which writes classified traces, swaps, arbitrages, sandwiches, and liquidations to the
shared Postgres. For bulk coverage a continuous fill worker (ADR-011) walks the chain
exhaustively from a fixed floor (`INSPECT_FLOOR_BLOCK`, default 11,000,000) up to the head,
one block at a time through a single process-wide serial queue it shares with the
head-follower — background inspection never doubles up on the connection-capped node, and
interactive views never wait behind it. Coverage survives restarts, being derived from
Postgres (`GET /api/analyzed-ranges`), not client state. The explorer's timeline is a
value-over-time line graph from the floor to the head — three series (arbitrage / sandwich
/ liquidation ETH extracted, `GET /api/mev-value`) — with a 100-block interval slider that
selects the block strip and auto-focuses the interval's highest-MEV block
(`GET /api/mev-activity`). `POST /api/backfill` is retained as an ops-only manual walk.

## Development

```bash
pnpm dev                                  # turbo dev (all apps)
pnpm --filter @mev/explorer-api dev       # API only (tsx watch)
pnpm --filter @mev/explorer-web dev       # frontend only (vite, proxies /api)

pnpm test                                 # all tests via turbo
pnpm --filter @mev/eth exec vitest run tests/oracle.test.ts   # single test file

pnpm lint                                 # biome check apps packages
pnpm format                               # biome format --write

# E2E against an already-running Compose stack. The current Playwright config
# expects a Chromium executable at /usr/bin/chromium.
pnpm exec playwright test
```

For local (non-container) dev you still need the shared Postgres:
`docker compose up -d postgres`.

## MEV detection

Detection is two steps: **decode, then pattern-match**. `@mev/inspect` decodes raw block
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
- [x] M2 (in progress): `trace-api` — call-tree graphs via `debug_traceTransaction`,
      contract sources/metadata via Etherscan; remaining: discovery-style relation
      metadata, verification against live traces (`trace-web`, the interim viewer,
      is retired from the compose stack in favor of the DiscoUI trace panel)
- [x] M3 (in progress): DiscoUI cloned into `apps/disco`, with trace routes
      reusing the nodes-panel graph stack (incl. its WebGL renderer); backed by a
      writable `l2b ui` (project creation, terminal discover, sources from disk);
      remaining: trace-panel polish (details sidebar, token-flow overlay) and scale work
- [x] M4: explorer ↔ trace wiring (ADR-007) — every explorer tx deep-links to
      `/ui/trace/:txHash` in DiscoUI; trace nodes are overlaid with the explorer's
      MEV facts (swap nodes highlighted, sandwich/JIT/race legs one jump away) and
      each contract's verified source is one click from the selected node
- [x] M5 — Agentic AI over traces and contracts (`agent-api`): persistent MEV
      and vulnerability Discovery sessions, typed reusable bundles, selectable
      context budgets, and grounded code/value enrichment (ADR-012)

## License

MIT
