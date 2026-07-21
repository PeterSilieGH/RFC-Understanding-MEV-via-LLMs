# ADR-012: MEV & Vulnerability Discovery — persistent sessions, typed autonomous bundles, context budgeting, value-pane enrichment, .flat dedup

## Status

Accepted — 2026-07-20. **Amended 2026-07-21** (second TODO): typed bundles + a
parallel **Vulnerability Discovery** pane and startup research-mode selector
(§5), **context budgeting** with a live meter (§2–4), the config-improvement
PROMPT promoted to an in-scope **value-pane enrichment** (§6, reversing the
original "not an agent-api concern" note), and **content-addressed `.flat`
deduplication** (§7, prototyped as `@mev/flat-store`).

**Operational amendment — 2026-07-21:** both research modes now default off,
the stable panel label is always **Discovery**, bundle-generation failures are
contract-scoped retryable warnings, and analysis scheduling supports bounded
independent concurrency while preserving per-session ordering (§1, §5).

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

The first TODO asked to rename Incident → **MEV Discovery**, make its session
**persistent**, make analysis **autonomous**, have the model **write reusable
bundles to the DB**, invoke the model only for **unknown contracts without a
bundle**, let the pane **select/deselect consumed bundles**, and **remove the
Analyze pane**.

The second TODO extends this and is the subject of the amendment:

- **Context budgeting.** Analyze runs must produce bundles that **jointly fit
  the aggregation context** that reaches Discovery, and the Discovery pane must
  show a **live preview** of how much of the current model's context the base
  prompt + selected bundles consume.
- **Two research kinds.** A startup selector offers **[MEV Research]** and
  **[Vulnerability Research]** (MEV on by default). A **Vulnerability Discovery**
  pane mirrors MEV Discovery with a different system prompt and its own
  **vulnerability bundles**. When both kinds are active, a **single** analyze
  run produces **both** bundle types for an unknown contract (not two runs).
- **Value-pane enrichment via the config PROMPT.** The provided PROMPT (improve
  each project's `template.jsonc` / `config.jsonc` — permissions + descriptions)
  is now to be **integrated as value-pane enrichment**, not left as a purely
  offline task.
- **`.flat` deduplication.** "Can templates' mechanism dedup `.flat` files?" —
  yes: discovery already content-addresses *config* via template **shape
  hashes** (flatten → normalize → sha256, address/pragma-independent). The same
  key deduplicates the *source bodies*, validated by the `@mev/flat-store`
  prototype (73% reduction on the live corpus, byte-exact round-trip).

A "bundle" is the durable, reusable, **typed** unit of understanding about a
**contract (by codehash, mirroring discovery's template model)**: an
LLM-produced structured note. `mev` bundles feed MEV Discovery; `vuln` bundles
feed Vulnerability Discovery. Bundles are the cache that makes analysis
incremental — the model is asked to produce the missing bundle *types* only for
an **unknown contract that lacks them**.

## Decision

### 1. Persistent agent sessions

- agent-api gains a **session store** keyed by workspace/project (and, for the
  Discovery panes, by incident + research kind) so a conversation retains
  server-side context across turns instead of re-sending everything. The session
  outlives a single request; `verdict-chat`-style follow-ups attach to the live
  session rather than replaying the transcript.
- Statelessness/restart-safety is preserved by **persisting session state to
  Postgres** (app-owned, ADR-002) and rehydrating on demand — the in-memory pi
  session is a cache over durable state, not the source of truth. Runs are
  bounded process-wide. Independent ephemeral runs may overlap when
  `AGENT_MAX_CONCURRENCY` is greater than one, while turns sharing a persistent
  session key remain serialized. The default is two: a live two-run benchmark
  reduced wall time from 37.6s to 20.8s without rate limiting or provider 5xx
  responses; higher limits remain opt-in.
- **Supersedes ADR-009's** "one session per request" and the
  re-send-each-turn behavior of `verdict-chat`. Compact-transcript and
  `agent_runs` persistence remain, complemented by session persistence.

### 2. Typed bundles are the reusable context unit, written by the LLM, budget-aware

- New app-owned table (e.g. `contract_bundles`) keyed by **(codehash, kind)**
  where `kind ∈ {mev, vuln}` (with the representative addresses that share the
  codehash), holding the model's structured analysis: role, entry points of
  interest, control-/fund-flow summary, kind-specific notes (MEV-relevance /
  vulnerability surface), an **estimated token size**, and provenance (run id).
  Mirrors discovery's "same bytecode → same template" principle.
- When analysis runs over a selection, the pipeline **partitions the selected
  contracts by which bundle *kinds* are missing** for the active research modes.
  The LLM is invoked **only where a needed (codehash, kind) bundle is absent**;
  its output is **written back as new bundles**. Contracts already bundled for
  the active kinds contribute their stored bundles as context for free.
- **Joint creation:** when both research kinds are active, one analyze run over
  an unknown contract emits **both** the `mev` and `vuln` bundle in a single
  model call (structured multi-output), not two separate runs.
- **Budget-aware:** each bundle carries a token estimate; analyze runs are
  **nudged to keep bundles compact** so that the bundles a Discovery run will
  aggregate **jointly fit the model's context** alongside the base prompt (see
  §3/§4). Bundles are the shared substrate for the verdict, replacing per-run
  re-derivation.

### 3. Autonomous, budget-fitting context selection replaces the Analyze pane

- The manual **Analyze panel is removed**. Context selection becomes a
  **heuristic + agent-driven** step: given an incident/selection, the system
  automatically assembles the candidate contract set (trace legs + graph),
  checks bundle coverage per active kind, and requests the missing bundles — no
  human node-picking. The `get_function_code` / signature-parsing tools and the
  ADR-009 grounding rules are retained and now serve the autonomous flow.
- **Context-budget nudging:** the aggregator computes the token cost of the base
  prompt + candidate bundles against the **current model's context window**;
  when the candidate set would overflow, analyze runs are steered to emit
  tighter bundles and/or the selection is trimmed (lowest-relevance first) so the
  aggregate fits. The budget is measured, not assumed — a size probe runs before
  aggregation.
- The nodes-panel run indicators (C/V ticks, amber "!") from ADR-009 are
  repurposed to reflect **bundle coverage per active kind** (has bundle / flagged
  important-but-unbundled) instead of per-skill analyze coverage.

### 4. Discovery panes consume a selectable bundle set with a live context meter

- The **Incident panel is renamed to "MEV Discovery"** (tab label; panel id
  stays `preview` for storage stability, same convention ADR-009 used).
- The pane shows the **set of bundles it will consume** for the current
  incident; each bundle is **click-to-deselect**, removing it from the context
  the verdict/chat is built on — the human curates by exclusion, not by picking
  nodes.
- A **live context meter** shows how much of the current model's total context
  the **base prompt + currently-selected bundles** consume (updates as bundles
  are toggled). This makes the budget in §3 visible and gives the human a direct
  lever over cost/scope.
- The verdict + follow-up chat run against the **selected bundles + persistent
  session**, so follow-ups are cheap and scoped to exactly the enabled bundles.

### 5. Research modes and the Vulnerability Discovery pane

- On DiscoUI startup, a selector offers **[MEV Research]** and **[Vulnerability
  Research]**; **both are deselected by default**. The choice is persisted and
  determines which Discovery panes are shown and **which bundle kinds analyze
  produces**.
- **Vulnerability Discovery** is a pane that mirrors MEV Discovery (persistent
  session, selectable bundles, live meter, verdict + chat) but with a **distinct
  system prompt** and consuming **`vuln` bundles**. The two panes are the same
  machinery parameterized by `kind`.
- The docking panel label is always **Discovery**, regardless of which research
  modes are active. Kind-specific headings remain inside the panel.
- With both modes active, autonomous analysis produces both bundle kinds in one
  run per unknown contract (§2 joint creation); each pane consumes only its own
  kind.

### 6. Value-pane enrichment via the config PROMPT

- The config-improvement PROMPT (comprehensively improve each project's
  `template.jsonc` / `config.jsonc` — permissions with custom `interact`
  descriptions, `act` only for permission inheritance/forwarding, template config
  keyed to **code not state**, per-address specifics via `config.jsonc`
  overrides, no hardcoded assumed permissions) becomes an **agent-backed
  enrichment of the Value pane**: the agent (with foundry `cast`, RPCs, and the
  Etherscan keys from `packages/config/.env`) proposes/writes config + template
  edits, and the resulting **permissions and field descriptions surface in the
  Value pane** (they "resolve by themselves and are shown on the frontend").
- **This reverses** the original ADR-012 note that the PROMPT is "not an
  agent-api concern." It is now in scope as a Discovery-adjacent agent skill,
  subject to the submodule-hygiene constraint: edits land as **untracked
  `l2beat/` files** and are **never committed as submodule state** (CLAUDE.md);
  the upstreaming/persistence story is a WP risk.

### 7. Content-addressed `.flat` deduplication

- Discovery's template matching already content-addresses config by a
  **flattening shape hash** (flatten → `formatIntoHashable` → sha256), so all
  deployments of the same code share one template. The **same key deduplicates
  the flattened source bodies**: store each distinct `.flat` blob once under its
  hash and reduce each project to a `path → hash` manifest — `discovered.json`
  already records `sourceHashes` per entry.
- This is **validated by the `@mev/flat-store` prototype** (`packages/flat-store`):
  on the live `l2beat/packages/config/src/projects` corpus it collapses 1013
  flat files / 71.7 MiB to 294 blobs / 19.2 MiB (73% saved) with a **byte-exact
  round-trip**, dominated by the recurring `trace-*` pool/token sources. The
  prototype reads output only and does not touch the read-only submodule.
- **Direction:** the discovery pipeline's `saveFlatSources` writes into a shared
  content-addressed store + manifest instead of a full per-project `.flat/`
  copy; the same content-addressing extends to ABIs and, via templates, to
  config. Productionizing this (and where the store lives relative to the
  submodule) is WP + submodule-hygiene work, not done in the prototype.

## Consequences

- **Autonomy vs. cost control.** Restricting model calls to unknown, un-bundled
  (codehash, kind) pairs makes repeat analysis of common protocols free after
  the first encounter. Correctness depends on the codehash key granularity —
  proxies/minimal-proxies may need the implementation codehash, not the proxy's
  (a WP trap).
- **Latency is multiplicative.** Initial preparation is one provider turn per
  unknown codehash, each turn may perform several `get_function_code` tool
  calls, and the pi harness may retry a transient provider failure twice. A
  large incident, slow model, provider rate limiting/5xx responses, bounded
  concurrency, RPC codehash lookups, and oversized verified sources can
  therefore make first-run analysis take minutes. Cached bundles make repeat
  opens fast. In-flight codehash deduplication prevents overlapping panes from
  paying for the same missing bundle twice.
- **Budget is now first-class.** Bundles carry size estimates, the aggregator
  measures against the model window, and the pane surfaces it live. This adds a
  token-accounting surface but prevents silent context overflow and makes "fully
  automated" predictable.
- **Two kinds double the bundle surface** but reuse one pipeline; joint creation
  keeps it to one model call per unknown contract. The research-mode selector
  must gate which kinds are produced/consumed so a MEV-only user never pays for
  vuln analysis.
- **Persistent sessions add lifecycle surface** (evictable, size-bounded,
  rehydratable; a stale session must not serve a deselected/updated bundle set —
  couple tightly with §4). This is the session-lifecycle work ADR-006/009 left
  open.
- **Value-pane PROMPT edits touch the submodule.** Improved configs land as
  untracked `l2beat/` files; never committed as submodule state — the
  persistence/upstreaming story must be decided before running broadly.
- **`.flat` dedup** trades per-project self-containment for a shared store +
  indirection; rehydration must stay byte-exact (the prototype's round-trip is
  the guardrail).
- **Grounding still holds.** Bundles and value-pane annotations derive only from
  submitted code/state/traces (ADR-006), and each records provenance.
- ADR-009's stateless model, Analyze panel, and manual-selection flow are
  **superseded**; its config sourcing (pi agent dir, `.pi/SYSTEM.md`), NDJSON
  streaming, transcript persistence, run indicators, and grounding rules are
  **retained**.
