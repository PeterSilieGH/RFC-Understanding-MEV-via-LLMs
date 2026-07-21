# Work package: DiscoUI — MEV Discovery pane, autonomous bundles, flow edges, config enrichment

Prepared 2026-07-20 from user TODO (quoted inline). DiscoUI / agent track
(`apps/disco`, `apps/agent-api`, discovery configs under
`l2beat/packages/config/`); independent of the explorer track
(wp-explorer-v2.md). Agent-model decisions in **ADR-012** (persistent sessions,
autonomous bundle-based context); builds on ADR-009 (agent-api) / ADR-008
(trace workspace) / ADR-005 (route-aware nodes panel).

## Current-state anchors

- **Incident panel** (relabelled Preview; panel id `preview`): "build verdict"
  → `build-preview` skill (agent-api), verdict + stateless `verdict-chat`
  follow-up re-sent client-side each turn (ADR-009).
- **Analyze panel** (`panel-agent/`): manual skills (`analyze-code`,
  `analyze-value`) over the multi-selected `highlighted` nodes; parses function
  signatures, `get_function_code` tool; runs persist to `agent_runs`.
- **agent-api**: Express, embeds pi SDK, **one in-memory session per request**,
  serialized process-wide; config from pi agent dir + `.pi/SYSTEM.md`; NDJSON
  streaming; no baked model/key.
- **Nodes panel** (route-aware, ADR-005): dependency graph in a project,
  MEV trace graph on a trace route; Show/Hide controls; run-indicator ticks
  (C/V, amber "!") keyed by lowercase address (`GET /api/agent/runs`).
- **Value panel**: discovery state fields + ABI. **Code panel**: parsed
  signatures + on-demand source.
- Discovery configs: `template.jsonc` / `config.jsonc` per project under
  `l2beat/packages/config/src/projects/<name>/`; `.flat` sources + `discovered.
  json` are gitignored; foundry `cast`, RPCs + Etherscan keys in
  `packages/config/.env`. `packages/discovery/README.md` documents config/handlers.

## Tasks

### D1 — Rename Incident → MEV Discovery (XS) — ADR-012 §4

> "Rename the <Incident> pane into <MEV Discovery>"

Relabel the tab to **"MEV Discovery"**. Keep the panel **id `preview`** for
storage stability (same convention as the Preview→Incident relabel, ADR-009).
Text/label only.

### D2 — Persistent agent sessions (L) — ADR-012 §1

> "Make the new <MEV Discovery> LLM session persistent, so interaction does not
> need to continuously resend context."

- agent-api gains a **session store** keyed by project (+ incident for
  Discovery), so a conversation keeps server-side context across turns instead
  of re-sending transcripts/trace-tree/swaps each call.
- Persist session state to Postgres (app-owned, ADR-002); rehydrate on demand —
  the in-memory pi session is a cache over durable state (restart-safe). Runs
  stay serialized process-wide.
- `verdict-chat` follow-ups attach to the live session (no full re-send).
- **Supersedes** ADR-009's one-session-per-request + re-send-each-turn.
  Sessions must be evictable, size-bounded, and must not serve a stale bundle
  set (see D5/D6).

### D3 — Control-flow & fund-flow edge enrichment on the nodes panel (M)

> "Extend the <nodes> panel by two buttons (Control and Funds + icon each) next
> to Show/Hide, that enrich the graph by control flow and fund flow
> information, visible on the edges."

- Two new toggle buttons **Control** and **Funds** (each with an icon) beside
  Show/Hide in the nodes panel.
- **Control** overlays control-flow on edges (call/permission relationships —
  from discovery permissions on a project route, from the call hierarchy on a
  trace route). **Funds** overlays fund-flow (value/token transfers along
  edges — on a trace route from the decoded swaps/transfers; on a project route
  from applicable state).
- Edge rendering only (DOM renderer per ADR-009; WebGL renderer need not draw
  them). Keep clone edits minimal and marked `DIVERGENCE(mev)`. Reuse the
  factory-ized graph store (ADR-005).

### D4 — LLM value-pane enrichment (M) — ADR-012 grounding

> "Integrate PROMPT for an LLM to enrich the <value> pane of a discovery
> project."

Add an agent-backed enrichment that annotates the **Value panel**'s discovered
state fields with LLM-produced descriptions (what each field means / why it
matters for MEV), grounded strictly in the submitted state + ABI (ADR-006
rule). Wire as an agent-api skill; annotations attach to the value rows. (This
is UI/pane enrichment — distinct from the offline config PROMPT in D7.)

### D5 — Autonomous bundle-based context; remove Analyze pane (L) — ADR-012 §2–3

> "Build smarter and automated context selection heuristics to make analyze
> fully autonomous/automated. The LLM shall write its bundles to db. the LLM
> shall only be requested to create bundles if there are unknown contracts in
> the selection, for which there exist no bundles yet. remove the <analyze>
> pane."

- New app-owned table **`contract_bundles`** keyed by **codehash** (+
  representative addresses sharing it): structured LLM analysis (role, key entry
  points, control/fund-flow summary, MEV-relevance, provenance run id). Mirrors
  discovery's "same bytecode → same template" model.
- **Autonomous selection**: given an incident/selection, auto-assemble the
  candidate contract set (trace legs + graph), **partition into has-bundle vs.
  unknown-no-bundle**, invoke the LLM **only for the unknown set**, and **write
  results back as bundles**. Bundled contracts contribute stored context for
  free (no model call).
- **Remove the Analyze pane** (`panel-agent/`). Retain the signature parser /
  `get_function_code` tool / grounding, now serving the autonomous flow.
- **Repurpose nodes-panel run indicators** to reflect **bundle coverage**
  (has-bundle / important-but-unbundled) instead of per-skill analyze coverage.
- Watch the **codehash granularity** trap: proxies/minimal-proxies may need the
  implementation codehash, not the proxy's.

### D6 — MEV Discovery bundle selection (M) — ADR-012 §4

> "The <MEV Discovery> pane shall have a selection of bundles it will consume,
> which may be deselected by clicking on them."

The MEV Discovery pane lists the **bundles it will consume** for the current
incident; each bundle is **click-to-deselect**, removing it from the verdict/
chat context. Verdict + follow-up run against **selected bundles + the
persistent session** (D2), so the human curates by exclusion and follow-ups stay
cheap. Deselection must invalidate any cached session context built on the
removed bundle (D2 staleness rule).

### D7 — Discovery config enrichment via the agent (M, semi-independent)

> The PROMPT (offline `template.jsonc` / `config.jsonc` improvement task).

Run the provided PROMPT as an **interactive/offline discovery task** (foundry
`cast`, RPCs + Etherscan keys from `packages/config/.env`), not an agent-api
runtime feature: comprehensively review and improve each project's
`template.jsonc` and `config.jsonc` — define the permissions (prefer `interact`
with custom descriptions; `act` only for permission inheritance/forwarding) and
field descriptions that matter, keeping template config **about the code, not
the state/interdependence** (per-address specifics go in `config.jsonc`
overrides). Do **not** hardcode assumed permissions into receiving
contract/multisig names or descriptions. Reference `packages/discovery/
README.md` and sibling projects. Context may be gitignored (`.flat` sources,
`discovered.json`). **Never commit submodule state** (CLAUDE.md) — improved
configs land as untracked submodule files unless separately upstreamed.

> Verbatim PROMPT (for the executing agent):
>
> "note that some important files (for context) may be in gitignore, like smart
> contract sources in `l2beat/packages/config/src/projects/PROJECTNAME/.flat`
> and the latest smart contract state + ABIs from the discovery scan in
> `discovered.json`. our config and handlers for fetching state and permissions
> are defined in `template.jsonc` and `config.jsonc` files. you have foundry
> cast available and rpcs and etherscan api keys in `packages/config/.env`.
> comprehensively go through the template.jsoncs and the config.jsonc and
> improve them. you can check other projects or the
> `packages/discovery/README.md` to find out about how the config and disco
> work. make sure to define all permissions and descriptions that you deem
> important. the 'act' permission is only needed to inherit/forward permissions
> (the permissioned address can ACT AS the contract that gives the permission)
> so mostly 'interact' with custom description is used. all smart contracts with
> the same bytecode will have the same template applied so its config should
> always apply to the code, not the interdependence or the state. you can use
> overrides in config.jsonc if there is something that should apply to a
> specific address. permissions resolve by themselves and are shown on the
> frontend. do not hardcode assumed permissions in the receiving
> contract/multisig names or descriptions like 'Contract Owner' or 'Fee
> Withdrawer'."

### D8 — e2e + docs (S)

e2e/coverage: persistent session survives multiple turns without re-send (D2),
bundle partition invokes the LLM only for unknown contracts (D5), bundle
deselection changes verdict context (D6), Control/Funds toggles overlay edges
(D3), MEV Discovery label (D1). Update CLAUDE.md disco paragraph + note
ADR-012 (superseding parts of ADR-009).

## Order & dependencies

D1 is an independent XS quick win. **D2 is foundational** for D5/D6 (persistent
context) — do it early. D5 (bundles) precedes D6 (bundle selection UI) and
repurposes the run indicators. D3 and D4 are independent graph/pane features.
D7 is semi-independent (offline, no UI dependency) and can run in parallel.
Suggested: D1 → D2 → D5 → D6 → D3 → D4 → (D7 parallel) → D8.

## Acceptance

- Incident pane reads **MEV Discovery** (panel id unchanged) (D1).
- A Discovery conversation retains server-side context across turns without
  re-sending transcripts/trace-tree/swaps; state survives an agent-api restart
  (D2).
- Nodes panel has Control and Funds toggles that overlay control- and fund-flow
  on edges (D3); Value panel fields carry grounded LLM descriptions (D4).
- Analysis is autonomous: the model is invoked only for unknown contracts
  lacking a bundle, writes bundles to `contract_bundles` (codehash-keyed), and
  the Analyze pane is gone; run indicators reflect bundle coverage (D5).
- The MEV Discovery pane shows the consumed bundle set with click-to-deselect,
  and deselection changes what the verdict/chat consume (D6).
- Project `template.jsonc` / `config.jsonc` reviewed and enriched per the PROMPT
  (D7), without committing submodule state.

## Risks

- **Bundle cache correctness (D5).** The codehash key is the whole value of the
  cache; wrong granularity (proxy vs. implementation) either over-shares a wrong
  analysis or never hits. Pin the key derivation and test against a
  proxy-heavy incident.
- **Session lifecycle (D2).** Persistent sessions add eviction/rehydration/
  staleness surface ADR-009 deliberately avoided; a session must never serve a
  deselected/updated bundle set (couple tightly with D6). Bound session size and
  cost — persistence must not just move the re-send cost into storage.
- **Autonomy vs. control (D5/D6).** Removing the Analyze pane removes ad-hoc
  "analyze these nodes"; ensure "force a bundle refresh" covers the residual
  need, and that deselection gives enough human control over autonomous
  selection.
- **Submodule hygiene (D7).** Config edits land under the read-only `l2beat/`
  submodule as untracked files; never commit submodule state (CLAUDE.md).
  Decide the upstreaming/persistence story for improved configs before running
  D7 broadly.
- **Clone-edit reviewability (D3).** Nodes-panel graph changes must stay minimal
  and `DIVERGENCE(mev)`-marked so re-porting against a newer submodule pin stays
  reviewable (ADR-008 rule).
