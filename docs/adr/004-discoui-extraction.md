# ADR-004: Extract DiscoUI capabilities by adaptation against a pinned l2beat submodule

## Status

Accepted — 2026-07-08

## Context

DiscoUI lives across three l2beat packages: `l2b` (Express backend), `protocolbeat` (React/Vite frontend), and `discovery` (contract discovery, sources, `getDebugTrace()`). Its API is internal — no versioning, no OpenAPI, endpoints gated by `--readonly`, types duplicated between packages (full analysis: `docs/L2BEAT.md`). Options: (a) run DiscoUI as-is and script against its API, (b) fork the packages into our monorepo, (c) build our own `trace-api`/`trace-web` apps that adapt DiscoUI's patterns and depend on l2beat packages only where they are consumable as libraries.

## Decision

Option (c), staged as in `docs/L2BEAT.md`:

1. The `l2beat/` submodule stays **read-only and pinned**; we never modify it. Where a package is importable (notably `@l2beat/discovery` for `getDebugTrace()`, `ConfigReader`, source fetching), we depend on it from the pinned submodule; where it isn't, we re-implement the pattern in our own code (e.g. `l2b`'s `getProjects`/`getCode` route logic, protocolbeat's graph-render concepts).
2. `apps/trace-api` exposes our own stable API (`/api/traces/:chain/:txHash/graph`, `/api/contracts/:address/code`, …) returning our own types from `packages/trace-graph` — DiscoUI types never leak past the adapter layer.
3. Traces get a **dedicated graph model**, not a retrofit of `ApiProjectResponse` (whose edges are static address-valued contract fields, semantically wrong for dynamic call flow).
4. Address normalization (`eth:0x…` chain-specific vs plain `0x…`) happens once, at the adapter boundary in `trace-api`.

## Consequences

- Upgrading the submodule is a deliberate, reviewed action (re-pin + adapter check), not routine maintenance.
- Some duplication with l2beat code we couldn't import — accepted in exchange for a stable API surface of our own.
- If depending on unpublished workspace packages from the submodule proves brittle under pnpm, the fallback is vendoring the few needed source files with provenance headers; that choice is local to `trace-api` and doesn't change this ADR's shape.
