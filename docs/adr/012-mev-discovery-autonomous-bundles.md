# ADR-012: MEV Discovery panel — persistent sessions, autonomous bundle-based context

## Status

Accepted — 2026-07-20

## Context

ADR-009 gave the trace workspace an **Analyze panel** and an **Incident panel**
backed by `apps/agent-api`. Two design choices from that ADR are now the
friction:

- **Stateless, one-session-per-request.** agent-api creates a fresh pi session
  per call and reconstructs context each turn (analyze transcripts + trace tree
  + swaps re-sent every time). `verdict-chat` explicitly re-sends the whole
  conversation each turn. This keeps the service restart-safe but makes every
  interaction re-pay the full context cost, and it caps how deep a conversation
  can usefully go.
- **Manual context selection.** The Analyze panel operates on whatever nodes
  the user multi-selected (`highlighted`); the human decides what to analyze and
  when. ADR-009 itself flagged (M5) that full autonomy was not yet met.

The TODO asks for the next step: rename Incident → **MEV Discovery**, make its
LLM session **persistent**, make analysis **autonomous** (the model decides
what context it needs), have the model **write reusable analysis bundles to the
DB**, only invoke the model for **unknown contracts without an existing
bundle**, let the MEV Discovery pane **select/deselect which bundles it
consumes**, and **remove the standalone Analyze pane**. This supersedes the
manual-analyze half of ADR-009 while keeping its grounding rules, config
sourcing, transcript persistence, and run-indicator machinery.

A "bundle" here is the durable, reusable unit of understanding about a
**contract (by bytecode/codehash, mirroring discovery's template model)**: an
LLM-produced structured note about what the contract is and does, keyed so it
applies to every address sharing that code. Bundles are the cache that makes
analysis incremental — the model is asked to produce one only when a selection
contains an **unknown contract with no bundle yet**.

## Decision

### 1. Persistent agent sessions

- agent-api gains a **session store** keyed by workspace/project (and, for the
  Discovery pane, by incident) so a conversation retains server-side context
  across turns instead of re-sending everything. The session outlives a single
  request; `verdict-chat`-style follow-ups attach to the live session rather
  than replaying the transcript.
- Statelessness/restart-safety is preserved by **persisting session state to
  Postgres** (app-owned, ADR-002) and rehydrating on demand — the in-memory pi
  session is a cache over durable state, not the source of truth. Runs are
  still serialized process-wide (ADR-009 load rule unchanged).
- This **supersedes ADR-009's** "one session per request" and the
  re-send-each-turn behavior of `verdict-chat`. The compact-transcript and
  `agent_runs` persistence remain, now complemented by session persistence.

### 2. Bundles are the reusable context unit, written by the LLM to the DB

- New app-owned table (e.g. `contract_bundles`) keyed by **codehash** (with the
  representative addresses that share it), holding the model's structured
  analysis: role, entry points of interest, control- and fund-flow summary,
  MEV-relevance notes, and provenance (which run produced it). Mirrors
  discovery's "same bytecode → same template" principle (CLAUDE.md).
- When analysis runs over a selection, the pipeline **partitions the selected
  contracts into (has-bundle) and (unknown, no-bundle)**. The LLM is invoked
  **only for the unknown set**, and its output is **written back as new
  bundles**. Contracts that already have a bundle contribute their stored
  bundle as context for free — no model call.
- Bundles are the shared substrate for the verdict: `build-preview` consumes
  the relevant bundles (plus the trace tree + decoded swaps, unchanged from
  ADR-009) rather than re-deriving per-contract understanding each time.

### 3. Autonomous context selection replaces the Analyze pane

- The manual **Analyze panel is removed**. Context selection becomes a
  **heuristic + agent-driven** step: given an incident/selection, the system
  automatically assembles the candidate contract set (from the trace legs and
  the graph), checks bundle coverage, and requests bundles for the gaps — no
  human node-picking required. The `get_function_code` / signature-parsing
  tools and the grounding rules from ADR-009 are retained and now serve the
  autonomous flow.
- The nodes-panel run indicators (C/V ticks, amber "!") from ADR-009 are
  repurposed to reflect **bundle coverage** (a node has a bundle / is flagged
  important-but-unbundled) instead of per-skill analyze coverage.

### 4. MEV Discovery pane consumes a selectable set of bundles

- The **Incident panel is renamed to "MEV Discovery"** (tab label; panel id
  stays `preview` for storage stability, same convention ADR-009 used for the
  Incident relabel).
- The pane shows the **set of bundles it will consume** for the current
  incident; each bundle can be **deselected by clicking it**, removing it from
  the context the verdict/chat is built on. This makes the autonomous selection
  auditable and correctable — the human curates by exclusion, not by picking
  nodes.
- The verdict + follow-up chat run against the **selected bundles + persistent
  session**, so follow-ups are cheap (no full re-send) and scoped to exactly
  the bundles the user left enabled.

## Consequences

- **Autonomy vs. cost control.** Restricting model calls to unknown,
  un-bundled contracts makes repeat analysis of common protocols (routers,
  pools, multisigs) free after the first encounter — the bundle cache is what
  makes "fully automated" affordable. Cache correctness depends on the codehash
  key being the right granularity (proxies/minimal-proxies may need the
  implementation codehash, not the proxy's — a known trap to handle in the WP).
- **Persistent sessions add lifecycle surface.** Sessions must be evictable,
  size-bounded, and rehydratable from Postgres; a stale session must not serve
  a changed bundle set. This is the session-lifecycle work ADR-006/ADR-009 left
  open, now in scope.
- Removing the Analyze pane deletes a user-facing capability (ad-hoc "analyze
  these nodes"); its function is absorbed into the automated flow. If ad-hoc
  analysis is still wanted, it becomes "force a bundle refresh for these
  contracts" rather than a separate panel.
- **Grounding still holds.** Bundles are derived only from submitted
  code/state/traces (ADR-006 rule); a bundle records its provenance so a verdict
  can cite which contract understanding it rests on.
- ADR-009's stateless model, Analyze panel, and manual-selection flow are
  **superseded**; its config sourcing (pi agent dir, `.pi/SYSTEM.md`), NDJSON
  streaming, transcript persistence, run indicators, and grounding rules are
  **retained**.
- The config-improvement PROMPT (discovery `template.jsonc` / `config.jsonc`
  enrichment) is **not** an agent-api concern — it is an offline/interactive
  discovery task tracked in the WP, not part of this ADR.
