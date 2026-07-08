# ADR-006: Agentic AI via the pi coding harness, grounded in platform APIs

## Status

Accepted — 2026-07-08

## Context

Milestone 5 integrates agentic AI to interpret traces and contracts. The repo already uses the pi harness (`@earendil-works/pi-coding-agent`, `.pi/` with `AGENTS.md` and an MEV skill), currently as an interactive CLI over the legacy framework. For the platform, agent answers must be grounded in the same data the UI shows — Postgres MEV facts, trace graphs, contract sources — and reachable from the frontends.

## Decision

- `apps/agent-api` embeds the pi harness as a service: it creates pi sessions programmatically and exposes them over HTTP with SSE streaming to the frontends (matching the EventSource pattern DiscoUI uses for terminal commands).
- The agent's grounding is **tools over platform APIs, not raw chain access**: a read-only Postgres query tool (mev-inspect + app tables), trace-api's graph/source endpoints, and explorer-api's per-block MEV summaries. The agent consumes the same `packages/trace-graph` model the UI renders, so "the node you're looking at" is addressable in both directions.
- Workflow knowledge lives in `.pi/` skills (extending `skills/mev/SKILL.md`): explain-transaction, explain-contract, classify-unlabeled-MEV. `AGENTS.md` is updated to describe the platform APIs instead of the legacy `framework/` layout.
- The research-ethics constraints in `.pi/AGENTS.md` (analysis and detection, no harmful extraction bot code) carry over verbatim into the service's system instructions.
- Model/API keys come from the unified root `.env` (ADR-002); the agent service runs as a compose container like every other app.

## Consequences

- Agent quality depends on tool design; tools are specified as zod schemas in `apps/agent-api` and versioned with the APIs they wrap.
- Long-running sessions hold server state; session lifecycle (create/attach/expire) is explorer-api-independent so the explorer stays stateless.
- Grounded citations (trace call ids, source file + line) are part of the response contract from day one — M5's acceptance criterion depends on them.
