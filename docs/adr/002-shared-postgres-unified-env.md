# ADR-002: One shared Postgres instance, one unified root .env, everything in docker compose

## Status

Accepted — 2026-07-08

## Context

mev-inspect-py writes its schema (`classified_traces`, `swaps`, `arbitrages`, …) to Postgres and the explorer adds app-owned cache tables (`block_builders`, `block_bids`). DiscoUI/trace features and the agent service also need persistence (trace caches, source caches, sessions). The reference `mev-monitor/docker-compose.yml` already runs a single `postgres:16` container. Project requirements mandate: one shared Postgres, one unified `.env` (with `.env.example`), and all services buildable/runnable via docker compose.

## Decision

- **One Postgres 16 container** (`postgres` service, named volume) hosts a single database. mev-inspect-py's Alembic migrations own its tables; each app owns its additional tables via migrations in `packages/db`. App code never writes to mev-inspect-py tables (read-only pattern-matching, per the reference design).
- **One root `.env`** is the single configuration source: RPC URLs, Postgres credentials, service ports, external API keys (CoinGecko, Anthropic, Etherscan, relays). `packages/config` loads and validates it with zod; every app and the compose file consume the same variables. `.env.example` lists every variable with a comment and safe default, and is updated in the same commit as any new variable.
- **`docker-compose.yml` at the repo root** defines: `postgres`, `explorer-api`, `explorer-web`, `trace-api`, `trace-web`, `agent-api`, plus a build of the `mev-inspect-py:local` image (used for one-off per-block runs, not a long-running service). The external RPC node is deliberately *not* a compose service — it is referenced via `RPC_URL`.

## Consequences

- Single point of failure and shared connection pool — acceptable for a research platform; per-service databases can be split later since access already goes through `packages/db`.
- Compose services invoke `docker run mev-inspect-py:local` for inspection; the explorer-api container therefore needs access to the Docker socket (or a small runner sidecar). This is the one privileged edge in the deployment and is documented in the compose file.
- The scattered env files (`framework/.env` per README, `mev-monitor/.env`) are superseded; ported code reads only injected environment variables.
