# ADR-004: Extract DiscoUI capabilities by adaptation against a pinned l2beat submodule

## Status

Accepted — 2026-07-08

## Context

DiscoUI lives across three l2beat packages: `l2b` (Express backend), `protocolbeat` (React/Vite frontend), and `discovery` (contract discovery, sources, `getDebugTrace()`). Its API is internal — no versioning, no OpenAPI, endpoints gated by `--readonly`, types duplicated between packages (full analysis: `docs/L2BEAT.md`). Options: (a) run DiscoUI as-is and script against its API, (b) fork the packages into our monorepo, (c) build our own `trace-api`/`trace-web` apps that adapt DiscoUI's patterns and depend on l2beat packages only where they are consumable as libraries.

## Decision

Option (c), staged as in `docs/L2BEAT.md`, with the explicit end state that **the submodule becomes obsolete**:

1. The `l2beat/` submodule stays **read-only and pinned**; we never modify it, and we do not import from it. Required parts (the `getDebugTrace()` provider pattern, source fetching, `l2b` route logic, protocolbeat graph-render concepts) are ported into the monorepo with provenance headers pointing at the pinned commit. Once all needed capabilities are ported, the submodule is removed.
2. `apps/trace-api` exposes our own stable API (`/api/traces/:chain/:txHash/graph`, `/api/contracts/:address/code`, …) returning our own types from `packages/trace-graph` — DiscoUI types never leak past the adapter layer.
3. Traces get a **dedicated graph model**, not a retrofit of `ApiProjectResponse` (whose edges are static address-valued contract fields, semantically wrong for dynamic call flow).
4. Address normalization (`eth:0x…` chain-specific vs plain `0x…`) happens once, at the adapter boundary in `trace-api`.

## Consequences

- Duplication with l2beat code — accepted in exchange for a stable API surface of our own and independence from an unversioned internal API.
- Ported code drifts from upstream by design; upstream fixes must be cherry-picked consciously (the provenance headers say where to look).
- The submodule serves as reference documentation only (it may also hold local uncommitted files like `.env`s); its removal is the completion criterion for this ADR.
