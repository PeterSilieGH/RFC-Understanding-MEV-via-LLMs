# ADR-010: Native TypeScript inspector; retire mev-inspect-py

## Status

Accepted — 2026-07-20. **Supersedes the container decision in [ADR-003](003-port-mev-monitor.md)**
and revises the one-off-container model described in CLAUDE.md / `docs/ARCHITECTURE.md`.

## Context

ADR-003 deliberately kept mev-inspect-py (patched Flashbots inspector, Python) as a containerized
tool: explorer-api ran `docker run mev-inspect-py:local cli.py inspect-block-command <n>` per block.
That choice bought time but left several liabilities:

- **A privileged edge**: explorer-api mounted `/var/run/docker.sock` to spawn host containers.
- **A gitignored, untracked runtime dependency**: the `mev-monitor/` checkout (nested git repos)
  was the only source of the image; nothing about the pipeline was reviewable in this repo.
- **Schema owned elsewhere**: the Postgres schema lived in mev-inspect-py's 40 Alembic migrations,
  applied via a compose `tools` profile — the monorepo couldn't stand up a database on its own.
- **A load-bearing workaround**: the Python USD-summary step throws without a price feed, so a
  *failed* inspection was treated as success whenever the `blocks` row existed.
- **Frozen at 2021**: no Uniswap V4 / Aave V3 / Balancer V2 / Compound V3 coverage, and the five
  custom detectors sat in a separate app-layer, re-querying Postgres post-hoc.

The user directed removing the Python dependency entirely and reimplementing its function natively.

## Decision

- **Port the inspector to TypeScript** as `@mev/inspect` (`packages/inspect`): trace fetch
  (`trace_block` + receipts with a per-tx fallback), ABI decode (ethers `Interface`), classifier
  specs (a pluggable registry — a new protocol is one spec file + ABI + a registry line), and the
  pattern-matchers (transfers, swaps, arbitrages, sandwiches, liquidations, nft trades, miner
  payments). Ported faithfully with provenance comments; wei is `bigint`. Bug fixes from the audit
  (`docs/design/mev-inspect-audit.md`) are applied inline (B1–B6).
- **Move the five custom detectors in-pipeline** (jit liquidity, non-atomic arbitrage, liquidation
  sandwich, liquidation race, nft flip): they run per block over the in-memory facts (no re-query)
  and persist to `mev_*` tables; explorer-api reads those results. This reverses ADR-007's
  "detectors never write" stance for these app-owned tables only — mev-inspect-py's original tables
  are still written solely by the ported pipeline.
- **Own the schema in `@mev/db`** (`schema.ts` + `migrate()`), reproduced verbatim from the shapes
  mev-inspect-py created so `CREATE TABLE IF NOT EXISTS` is a no-op on existing volumes.
  explorer-api runs `migrate()` at boot, replacing `alembic upgrade head`. Dropped as dead weight:
  `mev_summary` / `latest_block_update` (broken USD summary), the Python `prices` / `tokens` cache,
  and CryptoPunks (`punk_*` tables + classifier).
- **Inspect in-process, long-running**: explorer-api's `inspector.ts` calls `inspectBlock()`
  directly — no docker, no socket mount. The existing backfill queue is the sequential many-block
  driver; an optional head-follower (`INSPECTOR_FOLLOW_HEAD`) keeps the chain head warm. The
  USD-summary workaround is deleted with the step that caused it.
- **Retire the container**: the `mev-inspect` compose service, the `tools` profile, and the
  `./mev-monitor/mev-inspect-py` build context are removed. `mev-monitor/` now has **no runtime
  role** (kept only as an offline verification reference for this change).

## Consequences

- **Parity is verified** against blocks mev-inspect-py already wrote: `classified_traces`,
  `transfers`, `miner_payments`, and (with all legacy specs) `arbitrages` / `sandwiches` /
  `liquidations` match exactly on sampled blocks. One known minor divergence: ethers decodes some
  selector-collision calldata that Python's stricter `eth_abi` rejects (observed as +1 "uniswap_v3"
  swap on a Uniswap V4 call), documented in the audit; it does not affect arb/sandwich/liq counts.
- **Modern protocols** (Uniswap V4, Aave V3, Compound V3, Balancer V2, 0x v4) are added via the
  registry; they are best-effort and unverified (no reference data), and are additive.
- The deployment loses its one privileged edge (docker socket) and becomes fully self-contained:
  `docker compose up` stands up the schema and inspects blocks with no Python image.
- Re-porting against a newer mev-inspect-py pin is no longer a concern — the logic lives here, with
  the audit + provenance comments as the map back to the original.
