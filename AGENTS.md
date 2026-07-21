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
- **One shared Postgres instance** for all services (the ported pipeline schema, owned by `@mev/db`, plus app-owned tables)
- Everything buildable and runnable via `docker compose`; all services run as containers
- **One unified `.env` file at the repo root** for all API keys, RPC URLs, ports, etc., with a maintained `.env.example`

## Repository Layout

- `src/`, `tests/` — legacy "MEV research framework" (EthClient, PriceOracle, ProfitabilityEngine). Predates the platform effort; being absorbed into the monorepo packages. The README's `framework/` paths are stale — code lives at `src/`.
- `mev-monitor/` — **reference implementation, plain JS, gitignored local checkout** (contains nested git repos, so it is deliberately untracked). All of its JS has been ported: `server.js` + `lib/` → `apps/explorer-api` and `packages/db`, `public/` → `apps/explorer-web`. Its `README.md` remains the authoritative description of the MEV detection pipeline and the five extra detectors (JIT liquidity, non-atomic arbitrage, liquidation sandwich, liquidation race, NFT flip). Use it only to verify ported behavior; never build features inside it.
- `mev-monitor/mev-inspect-py/` — patched Flashbots inspector (Python). **Retired as a runtime dependency (ADR-010).** Its pipeline (trace decode/classify + arbitrage/sandwich/liquidation/nft/miner-payment extraction) is ported natively to `packages/inspect` (`@mev/inspect`); this checkout is now only an **offline verification reference** (compare native output against blocks it previously wrote). No `mev-inspect-py:local` image, no `tools` profile, no `docker run` per block. `docs/design/mev-inspect-audit.md` records the bugs fixed and protocol gaps during the port.
- `packages/inspect/` — **`@mev/inspect`**, the native TypeScript inspector (ADR-010). `trace_block` fetch → ABI decode (ethers) → classifier-spec registry (`src/classifiers/specs/*`, one file per protocol; `registerClassifierSpecs()` to add more) → pattern-matchers → the five custom detectors (`src/detectors/*`, now in-pipeline) → `writeBlock` persists to Postgres. ABIs live in `packages/inspect/abis/`. Wei is `bigint`.
- `l2beat/` — **git submodule, read-only, temporary**. DiscoUI = `packages/l2b` (Express backend, port 2021) + `packages/protocolbeat` (React/Vite frontend) + `packages/discovery` (contract discovery, `getDebugTrace()` over `debug_traceTransaction`). `docs/L2BEAT.md` is a detailed map of the relevant files and API surface — read it before touching anything DiscoUI-related. Long-term the submodule becomes obsolete: required parts are ported into the monorepo (with provenance headers) rather than imported from it (ADR-004). Do not modify it, and never commit submodule state — it may hold local uncommitted files (e.g. `.env`s).
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

1. An RPC node with `trace_block` support (reth/Erigon — plain geth won't work) supplies block traces.
2. `@mev/inspect` inspects a block **in-process** (ADR-010): explorer-api's `inspector.ts` calls `inspectBlock()` on first request (deduped in-memory), which fetches traces, decodes/classifies, and writes decoded facts (`classified_traces`, `swaps`, `liquidations`, …) plus pattern-matches (`arbitrages`, `sandwiches`, …) to Postgres. No `docker run`.
3. The five custom detectors run **in the same pipeline** (`packages/inspect/src/detectors/*`) over the in-memory facts and persist to `mev_*` tables; explorer-api reads those (`detectorReads.ts`) and merges everything into one `mev[]` array per transaction (`mev.ts`). The core mev-inspect-py-shaped tables are still written only by the ported pipeline.
4. `@mev/db` owns the whole schema (`schema.ts` + `migrate()`, run at explorer-api boot — replaces `alembic upgrade head`). App-owned cache tables (`block_builders`, `block_bids`) hold builder graffiti and MEV-Boost relay bids.
5. Bulk coverage is exhaustive from a fixed floor (ADR-011 §1): a continuous fill worker (`apps/explorer-api/src/backfill.ts` `startFillWorker`, gated on `INSPECTOR_FILL_RANGE`) walks `INSPECT_FLOOR_BLOCK` (default 11,000,000) ascending to the head, filling the next uncovered block (bounded `generate_series` anti-join against the `blocks` table). It shares ONE process-wide serial queue (`inspector.ts` `backgroundInspect`) with the head-follower (`INSPECTOR_FOLLOW_HEAD`, `inspectorLoop.ts`) and the retained ops-only `POST /api/backfill`, so background inspection never doubles up on the connection-capped node; interactive block views call `inspectBlockIfNeeded` directly and may overlap. All modules share one RPC provider (`@mev/rpc` `getProvider()`, ADR-011 §3). Coverage (`GET /api/analyzed-ranges`) is derived from the `blocks` table so it survives restarts; `GET /api/mev-activity` gives per-block MEV counts, `GET /api/mev-value` the per-type ETH value extracted per bucket (arbitrage/sandwich/liquidation, WETH-denominated), and `GET /api/fill` the worker's status. The explorer-web timeline is a 3-series value-over-time line graph from the floor to the head (ADR-011 §2) with only the 100-block interval slider retained — the old analysis slider and manual backfill button are gone; the viewer restores its last block from `localStorage` unless follow-latest was on (X1), and a header Block/Address toggle drives a unified search (X8).

Retired quirk: mev-inspect-py's USD-summary step threw without a price feed, so a failed inspection was treated as success when the block row existed. The native engine has no USD-summary step (audit B6), so that workaround is gone — a failure is now a real failure.

Trace visualization lives in `apps/disco` — a clone of l2beat's protocolbeat (pinned commit, vendored `@l2beat/*` shims in `src/vendor/`, deliberate edits marked `DIVERGENCE(mev)`) whose **nodes panel is route-aware**: inside a discovery project it is the stock dependency graph; on a trace route it renders MEV execution traces via the same graph stack (factory-ized store, ADR-005) — there is no separate `trace` panel id. Its backend is `l2b ui` built from the submodule (`disco-api`, port 2021), run **without** `--readonly` via a compose command override (enables project creation, `l2b discover` from the terminal panel, and sources from disk) and API-only (the image's own protocolbeat build is masked by a tmpfs; discovery projects/cache are bind-mounted from `l2beat/packages/config/`, so UI-created projects land on the host as untracked submodule files). nginx routes `/api/traces` + `/api/contracts` to our `trace-api` (port 2022), `/api/mev` to `explorer-api` — the trace graph overlays the explorer's per-tx MEV facts (`GET /api/mev/tx/:hash`, joined onto graph nodes via `swaps.trace_address`) (ADR-007) — and `/api/agent` to `agent-api` (port 3100, buffering off for NDJSON streaming). The **Analyze panel** is route-agnostic and backed by agent-api (ADR-009): analyze-code / analyze-value review the selected nodes' Code / Values context as an MEV expert (code sent as parsed signatures + a `get_function_code` tool), build-preview (from the **Incident panel** — the relabelled Preview panel; panel id stays `preview`) combines the stored transcripts plus a compact structural trace tree and the incident's decoded swaps (token amounts in/out) into a verdict and can `flag_important_nodes`; covered nodes get two red ticks (C/V) and verdict-flagged-but-unanalyzed nodes an amber "!". A follow-up chat under the verdict (`verdict-chat`, `POST /api/agent/verdict/chat`) is stateless — the conversation is held client-side and re-sent each turn with the verdict/transcripts/trace-tree/swaps as context (replies are ephemeral, never saved). The selection the skills operate on (`highlighted`) is built by multi-select in the nodes graph (shift-click/rubber-band) and the List panel (modifier-click) — on the trace route these are `TracePanel`/`TraceListPanel`, which publish every selected call node's contract into `highlighted`, not just the focused one. agent-api bakes in no model/key — it reads them from the pi agent dir (`$PI_CODING_AGENT_DIR`, host `~/.pi/agent` mounted in compose) and takes its system prompt from `.pi/SYSTEM.md`. `/ui/trace/:txHash` opens a **full workspace** (ADR-008): trace-api resolves the hash to all legs of its MEV incident, runs one bounded discovery (`maxDepth: 0`, trace addresses as `initialAddresses`, runs serialized process-wide — the discovery cache is SQLite) into a synthetic disposable project `trace-<hash8>` (canonical name = smallest leg hash; hidden from the home list, safe to delete, never commit), then redirects to `/ui/trace/:txHash/:project` where the stock panels (values/code/preview) work unmodified, the List shows incident folders (Initial + one per leg), and nodes/fields are auto-named from the discovery output. The explorer renders **one** trace link per incident (`trace (N tx)` on the first rendered leg). Keep clone edits minimal and marked — re-porting against a newer submodule pin must stay reviewable. Addresses need normalization: l2beat uses `eth:0x…` chain-specific addresses, raw traces use plain `0x…` (`toShortenedAddress` expects the former and crashes on the latter).

## Conventions

- ESM throughout (`"type": "module"`); TypeScript strict mode.
- Wei amounts are `bigint`, never `number`.
- Logging via pino (`src/utils/logger.ts`).
- Research ethics (from `.pi/AGENTS.md`): this project is for detection, analysis, simulation, and research reporting — do not write executable bot code designed to extract MEV in ways that harm ordinary users.
