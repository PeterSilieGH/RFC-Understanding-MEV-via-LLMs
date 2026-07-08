# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

Build a MEV (Maximal Extractable Value) analysis platform that combines:

- **MEV Block Explorer** capabilities from `mev-monitor/` (backed by Flashbots' mev-inspect-py),
- **DiscoUI** contract-source and graph visualization capabilities from the `l2beat/` submodule,
- **Agentic AI** via the pi coding harness (`@earendil-works/pi-coding-agent`) for interpreting traces and contracts.

Milestones, target architecture, and acceptance criteria are formalized in `docs/ARCHITECTURE.md`. Design decisions are recorded as ADRs in `docs/adr/` — read the relevant ADRs before making structural changes, and add a new ADR for any significant decision.

### Global stack requirements (fixed, do not deviate)

- pnpm workspaces + Turborepo, TypeScript, Biome (lint/format), Vite (frontends), Express (APIs)
- **One shared Postgres instance** for all services (mev-inspect-py schema plus app-owned tables)
- Everything buildable and runnable via `docker compose`; all services run as containers
- **One unified `.env` file at the repo root** for all API keys, RPC URLs, ports, etc., with a maintained `.env.example`

## Repository Layout

- `src/`, `tests/` — legacy "MEV research framework" (EthClient, PriceOracle, ProfitabilityEngine). Predates the platform effort; being absorbed into the monorepo packages. The README's `framework/` paths are stale — code lives at `src/`.
- `mev-monitor/` — **reference implementation, plain JS, vendored** (has its own node_modules, not a workspace). Express API + static frontend over mev-inspect-py's Postgres. Its `README.md` is the authoritative description of the MEV detection pipeline and the five extra detectors (JIT liquidity, non-atomic arbitrage, liquidation sandwich, liquidation race, NFT flip). Port capabilities out of it; don't build new features inside it.
- `mev-monitor/mev-inspect-py/` — patched Flashbots inspector (Python). Runs as a one-off Docker container per block (`mev-inspect-py:local`), writes classified traces/swaps/arbitrages/sandwiches/liquidations to Postgres. Not a long-running service.
- `l2beat/` — **git submodule, read-only reference**. DiscoUI = `packages/l2b` (Express backend, port 2021) + `packages/protocolbeat` (React/Vite frontend) + `packages/discovery` (contract discovery, `getDebugTrace()` over `debug_traceTransaction`). `docs/L2BEAT.md` is a detailed map of the relevant files and API surface — read it before touching anything DiscoUI-related. Pin against the submodule commit; do not modify the submodule.
- `.pi/` — pi harness config: `AGENTS.md` (agent instructions) and `skills/mev/SKILL.md` (research workflow skill).
- `docs/` — `ARCHITECTURE.md` (target architecture + milestones), `L2BEAT.md` (DiscoUI analysis), `adr/` (decision records), `design/`.

## Commands

Root package (legacy framework):

```bash
pnpm install
pnpm build              # tsc
pnpm test               # vitest (watch mode); tests live in tests/**/*.test.ts
pnpm vitest run                          # single pass, no watch
pnpm vitest run tests/oracle.test.ts     # single test file
pnpm vitest run -t "name substring"      # single test by name
pnpm dev                # tsx watch src/cli/index.ts
```

Node version is pinned in `.node-version` (v22). Use pnpm, never npm/yarn.

As the monorepo lands (`apps/`, `packages/`), turbo drives builds: `pnpm turbo build|test|lint`, with Biome replacing eslint (`pnpm biome check .`). The `lint: eslint` script in the root package.json is legacy.

Reference stack (mev-monitor, only for verifying ported behavior):

```bash
cd mev-monitor && ./restore.sh   # idempotent: postgres container, mev-inspect-py image, migrations, server
```

It needs an external RPC node with `trace_block` support (reth/Erigon — plain geth won't work), default `http://localhost:8504`.

## Architecture Essentials

The MEV pipeline is **decode, then pattern-match** (see `mev-monitor/README.md` for the full write-up):

1. An RPC node with `debug`/`trace` support supplies block traces.
2. mev-inspect-py replays a block's traces on demand (first request for a block triggers a `docker run`, deduped in-memory) and writes decoded facts (`classified_traces`, `swaps`, `liquidations`, …) plus its own pattern-matches (`arbitrages`, `sandwiches`, …) to Postgres.
3. The explorer layers five additional read-only detectors over those tables and merges everything into one `mev[]` array per transaction. Detectors never write to mev-inspect-py's tables.
4. App-owned cache tables (`block_builders`, `block_bids`) hold builder graffiti and MEV-Boost relay bids.

Quirk worth knowing: mev-inspect-py's USD-summary step throws without a configured price feed; the inspector treats that failure as success when the block row exists (`mev-monitor/lib/inspector.js`).

For trace visualization, the intended path (per `docs/L2BEAT.md`) is a dedicated trace API + frontend app modeled on DiscoUI's patterns — reusing `packages/discovery`'s `getDebugTrace()` call-tree shape and the protocolbeat graph-renderer concepts — rather than forcing traces into DiscoUI's static `ApiProjectResponse` model. Addresses need normalization: l2beat uses `eth:0x…` chain-specific addresses, raw traces use plain `0x…`.

## Conventions

- ESM throughout (`"type": "module"`); TypeScript strict mode.
- Wei amounts are `bigint`, never `number`.
- Logging via pino (`src/utils/logger.ts`).
- Research ethics (from `.pi/AGENTS.md`): this project is for detection, analysis, simulation, and research reporting — do not write executable bot code designed to extract MEV in ways that harm ordinary users.
