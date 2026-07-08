# ADR-003: Port mev-monitor to TypeScript apps; keep mev-inspect-py as a containerized Python tool

## Status

Accepted — 2026-07-08

## Context

`mev-monitor/` is a working plain-JS Express server (`server.js` + `lib/`) with a static vanilla-JS frontend (`public/`). It embodies hard-won behavior: five extra MEV detectors, on-demand block inspection with in-memory dedup, the USD-summary failure workaround, mempool public/private classification, builder/relay identification with per-block caching, and EUR price caching. Beneath it, mev-inspect-py (patched, Python) does trace decoding and base classification. Milestone 1 requires these capabilities on the platform stack.

## Decision

- **Port, don't wrap.** `server.js` + `lib/` are rewritten as `apps/explorer-api` (TypeScript, ESM, Express 5, `pg`), preserving API routes and detector semantics 1:1. Each detector's documented heuristic (including the tuned thresholds: 1% arbitrage leg matching lives in mev-inspect-py; 30% amount tolerance for non-atomic arbitrage; tx-hash dedup in liquidation races) is carried over with its rationale as comments/tests.
- **The frontend is ported to Vite** as `apps/explorer-web` (from `public/`), served as its own container; the API no longer serves static files.
- **mev-inspect-py is not ported.** It stays a patched Python codebase consumed strictly as the `mev-inspect-py:local` docker image (built via the compose `tools` profile) and invoked per block. Rewriting its classifier library (Uniswap/Curve/Balancer/Aave/… ABIs and helpers) would be high-cost, high-risk, zero-benefit.
- `mev-monitor/` remains a **gitignored local checkout**, frozen, as the verification reference: it contains nested git repos (its own and mev-inspect-py's), so tracking it would create broken gitlinks. Ported behavior is validated by comparing API responses for the same blocks against it. The docker image is the only runtime dependency on this checkout.

## Consequences

- Two HTTP hops (web → api) replace the single static-file server; compose networking and a Vite dev proxy handle this.
- The port surfaces implicit types (wei as `bigint`, address strings) — divergences from the reference output must be treated as bugs, not improvements, until M1 is verified.
- Once M1 is verified, new detector work happens only in `apps/explorer-api`.
