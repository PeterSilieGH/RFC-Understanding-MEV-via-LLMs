# ADR-009: Analyze panel skills via an embedded pi agent (agent-api)

## Status

Accepted — 2026-07-16

## Context

ADR-006 decided that agentic AI enters the platform as `apps/agent-api`, a
service embedding the pi harness with tools over platform APIs. ADR-008 left
the Analyze tab of the trace workspace as a disabled stub reserved for this.
The first concrete UI need is small and well-shaped: from the nodes view, run
an LLM review of what the user is looking at — the same context the
"copy panel context" button already assembles from the Code and Values panels —
and later fold those reviews into a per-transaction (or per-incident-bundle)
verdict in the Preview panel.

Two constraints shape the design:

- **Prompt economy.** Flattened verified sources are routinely 100k+ tokens.
  Sending whole contracts per request is slow, expensive, and mostly noise.
- **Grounding.** Answers must be about the code/state actually shown, not the
  model's memory of a protocol (ADR-006's grounding rule).

## Decision

- **`apps/agent-api`** (Express, `AGENT_API_PORT`, compose service like every
  other app) embeds the pi SDK (`createAgentSession` from
  `@earendil-works/pi-coding-agent`) — one in-memory session per request, no
  filesystem/bash tools. Runs are serialized process-wide (same reasoning as
  trace-api's discovery queue: bound the load we put on one upstream).
- **Config sourcing (no baked model or key).** Base config — credentials and
  model selection — comes from pi's agent dir (`~/.pi/agent` by default, or
  `$PI_CODING_AGENT_DIR`): `auth.json`, `models.json`, and the default model
  in `settings.json`. The service passes no `model` to `createAgentSession`
  and injects no API key, so which model runs is the user's pi configuration,
  not a constant in the code or a platform `.env` var. In compose the host's
  agent dir is mounted read-only and pointed at via `PI_CODING_AGENT_DIR`.
  The project `.pi/` **supplements** that base: `.pi/SYSTEM.md` overrides the
  system prompt (a single MEV-expert + research-ethics framing — the ethics
  text from ADR-006 carries over there), while `.pi/AGENTS.md` and
  `.pi/skills/` load through normal discovery. Per-skill differences are
  user-prompt task lead-ins, not separate system prompts.
- **Panel skills live in agent-api**, versioned with the API that executes
  them, not in `.pi/skills/` (which remains the interactive-CLI surface).
  Three skills:
  - `analyze-code` — review the selected nodes' contract sources as an MEV
    expert. The client sends the Code-panel context (the exact
    "copy panel context" text); the server **parses function signatures**
    out of it and prompts with [system prompt + signatures], not full
    sources. A custom pi tool `get_function_code(contract?, name)` lets the
    model pull individual function bodies from the submitted code on demand.
  - `analyze-value` — same shape, but the initial context is the Values-panel
    context (state fields + ABI). The code-lookup tool stays available when
    code context was submitted alongside.
  - `build-preview` — combines the **stored transcripts** of previous analyze
    runs for the project into a verdict about the transaction (for `trace-*`
    projects, about the incident bundle). On a trace route the client also
    ships a **compact structural trace tree** (call hierarchy with contract
    names + selectors + links, no calldata/state) built from trace-api's
    workspace + graph endpoints, the **decoded swaps** of each leg (protocol,
    pool, token amounts in → out, from the explorer's per-tx MEV facts) so the
    verdict can reason about value flow, plus the list of already-analyzed
    addresses. A custom pi tool `flag_important_nodes(addresses[])` lets the
    model report contracts that matter to the incident but have **not** yet
    been analyzed; those persist as the verdict run's `addresses[]` and drive
    the important marker (below).
  - `verdict-chat` (`POST /api/agent/verdict/chat`) — a follow-up conversation
    under the rendered verdict. agent-api stays stateless (one session per
    request), so the session that produced the verdict is gone: the server
    reconstructs its context from the stored verdict report, the analyze
    transcripts, and the same trace tree + swaps the client re-sends, then
    appends the conversation history (held client-side) and the new question.
    Replies stream but are **ephemeral** — never persisted as runs, so they do
    not pollute the analyze transcripts a later verdict consumes.
- **Transcripts are a stored by-product, not UI.** Every analyze run persists
  `(project, skill, addresses[], question, report, compact transcript)` to an
  app-owned Postgres table `agent_runs` (shared instance, ADR-002; never
  touching mev-inspect tables). The compact transcript is built
  programmatically (targets, signatures offered, tool lookups made, capped
  report) — deterministic, no second LLM pass.
- **Streaming**: `POST /api/agent/analyze` (and `/verdict`) responds with
  NDJSON events (`delta`, `tool`, `flagged`, `done`, `saved`, `error`) read via
  fetch streaming — EventSource is GET-only and the context payload needs a
  body. nginx (disco-web) routes `/api/agent/` to agent-api with buffering off.
- **Frontend**: the Analyze panel is replaced by `panel-agent/` (new files,
  clean provenance per ADR-004): it lists the skills (foldable) with their
  descriptions up front, offers one free-text question input, runs a skill
  against the nodes currently selected in the nodes view (multi-select
  `highlighted`, falling back to `selected`). Both the nodes graph
  (shift-click / rubber-band) and the **List panel** (modifier-click) build
  the `highlighted` set, so the panel works on both project and trace routes.
  The stock l2b analyzer UI is superseded; the "copy panel context" formatters
  move to a shared `utils/panelContext.ts` used by both the copy button and the
  panel.
- **Run indicators**: nodes carry two distinct ticks (red "C"/"V", one per
  analyze skill) once a skill has covered their address, plus an amber "!"
  when the verdict flagged the node as important-but-unanalyzed (suppressed
  once covered) — all keyed by plain lowercase address so the same marks render
  on dependency-graph and trace-graph nodes. Marks hydrate from
  `GET /api/agent/runs?project=…` (important flags come from the newest
  `build-preview` run's `addresses[]`) and update live after a run. DOM
  renderer only; the experimental WebGL renderer does not draw them.
- The **Incident panel** (the Preview panel — its tab is relabelled; the panel
  id stays `preview` for storage stability) gains a "build verdict" button
  triggering the `build-preview` skill; the latest stored verdict renders at
  the top of the panel and survives reloads. Below the verdict, a follow-up
  chat (`verdict-chat`) lets the user interrogate the verdict; the exchange is
  held client-side and re-sent each turn (statelessness, above).

## Consequences

- The signature parser (regex + brace matching over comment-stripped
  Solidity) is best-effort; unparsed constructs degrade to "function not
  listed", and the model can still ask for a contract's full source as a
  fallback lookup. It is unit-tested against the flattened-source shapes
  discovery produces.
- One session per request keeps agent-api stateless (restart-safe; state is
  Postgres). Genuine multi-turn chat is not available, so `verdict-chat`
  approximates it by re-sending the conversation each turn — cheap for a few
  short follow-ups, but token cost grows with the history and there is no
  server-side memory of a live session; ADR-006's session-lifecycle work stays
  open for a later milestone.
- Serialized runs mean a second user's run waits; the stream emits a
  `queued` event so the UI can say so.
- The verdict is only as good as the accumulated transcripts; the Preview
  button reports when no analyze runs exist yet instead of hallucinating a
  verdict from nothing.
- ADR-008's "Analyze tab is a disabled stub" is superseded; M5's acceptance
  criterion (grounded, citable explanation from a trace view) is partially
  met — citations reference function signatures and submitted state, not yet
  trace call ids.
