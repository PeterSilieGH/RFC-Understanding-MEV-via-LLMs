# Work package: DiscoUI — MEV & Vulnerability Discovery, typed autonomous bundles, context budgeting, flow edges, config/value enrichment, .flat dedup

Prepared 2026-07-20 from the first TODO; **amended 2026-07-21** from the second
TODO (research modes + Vulnerability Discovery, context budgeting + live meter,
PROMPT-as-value-pane-enrichment, `.flat` dedup). DiscoUI / agent track
(`apps/disco`, `apps/agent-api`, discovery configs under
`l2beat/packages/config/`); independent of the explorer track
(wp-explorer-v2.md). Decisions in **ADR-012** (persistent sessions, typed
autonomous bundles, context budgeting, research modes, value-pane enrichment,
`.flat` dedup); builds on ADR-009 (agent-api) / ADR-008 (trace workspace) /
ADR-005 (route-aware nodes panel).

## Current-state anchors

- **Incident panel** (relabelled Preview; panel id `preview`): "build verdict"
  → `build-preview` skill (agent-api), verdict + stateless `verdict-chat`
  follow-up re-sent client-side each turn (ADR-009).
- **Analyze panel** (`panel-agent/`): manual skills (`analyze-code`,
  `analyze-value`) over the multi-selected `highlighted` nodes; parses function
  signatures, `get_function_code` tool; runs persist to `agent_runs`.
- **agent-api**: Express, embeds pi SDK, **one in-memory session per request**,
  serialized process-wide; config from pi agent dir + `.pi/SYSTEM.md`; NDJSON
  streaming; no baked model/key. Model selection is split analyze/incident and
  lives in Global app settings (settings amendment).
- **Nodes panel** (route-aware, ADR-005): dependency graph in a project, MEV
  trace graph on a trace route; Show/Hide controls; run-indicator ticks (C/V,
  amber "!") keyed by lowercase address (`GET /api/agent/runs`).
- **Value panel**: discovery state fields + ABI. **Code panel**: parsed
  signatures + on-demand source.
- Discovery configs: `template.jsonc` / `config.jsonc` per project under
  `l2beat/packages/config/src/projects/<name>/`; `.flat` sources + `discovered.
  json` are gitignored; foundry `cast`, RPCs + Etherscan keys in
  `packages/config/.env`. `packages/discovery/README.md` documents config/handlers.
- **`.flat` dedup prototype exists:** `@mev/flat-store` (`packages/flat-store`)
  content-addresses `.flat` sources (73% reduction on the live corpus,
  byte-exact round-trip) — D8 productionizes it.

## Tasks

### D1 — Rename Incident → MEV Discovery (XS) — ADR-012 §4

> "Rename the <Incident> pane into <MEV Discovery>"

Relabel the tab to **"MEV Discovery"**. Keep the panel **id `preview`** for
storage stability (same convention as the Preview→Incident relabel, ADR-009).
Text/label only.

### D2 — Persistent agent sessions (L) — ADR-012 §1

> "Make the new <MEV Discovery> LLM session persistent, so interaction does not
> need to continuously resend context."

- agent-api gains a **session store** keyed by project (+ incident + research
  kind for Discovery), so a conversation keeps server-side context across turns
  instead of re-sending transcripts/trace-tree/swaps each call.
- Persist session state to Postgres (app-owned, ADR-002); rehydrate on demand —
  the in-memory pi session is a cache over durable state (restart-safe). Runs
  stay serialized process-wide.
- `verdict-chat` follow-ups attach to the live session (no full re-send).
- **Supersedes** ADR-009's one-session-per-request + re-send-each-turn.
  Sessions must be evictable, size-bounded, and must not serve a stale/deselected
  bundle set (see D5/D6).

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

### D4 — Value-pane enrichment via the config PROMPT (M) — ADR-012 §6

> "Integrate the below PROMPT for an LLM to enrich the <value> pane of a
> discovery project."

Wire the config-improvement PROMPT as an **agent-backed Value-pane enrichment**
(supersedes the earlier "offline-only" framing). The agent — with foundry `cast`,
RPCs, and Etherscan keys from `packages/config/.env` — comprehensively reviews
and improves each project's `template.jsonc` / `config.jsonc`, and the resulting
**permissions + field descriptions surface in the Value pane** (they resolve and
render on the frontend by themselves). Rules from the PROMPT: prefer `interact`
with custom descriptions (`act` only for permission inheritance/forwarding);
template config is **about the code, not the state/interdependence**; per-address
specifics go in `config.jsonc` overrides; **do not hardcode assumed permissions**
into receiving contract/multisig names or descriptions. Grounded (ADR-006).
**Submodule hygiene:** edits land as untracked `l2beat/` files — **never commit
submodule state** (CLAUDE.md); decide the persistence/upstreaming story before
running broadly.

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

### D5 — Autonomous typed bundles; remove Analyze pane; context-budget nudging (XL) — ADR-012 §2–3

> "make analyze fully autonomous/automated. The LLM shall create and write its
> bundles to db. the LLM shall only be requested to create bundles for unknown
> contracts in the selection, for which there exist no bundles yet. remove the
> <analyze> pane. test the size of context that will reach <MEV Discovery> and
> nudge analyze runs to create bundles jointly fit into the aggregation context."

- New app-owned table **`contract_bundles`** keyed by **(codehash, kind)**,
  `kind ∈ {mev, vuln}` (+ representative addresses sharing the codehash):
  structured LLM analysis (role, key entry points, control/fund-flow summary,
  kind-specific notes, **token-size estimate**, provenance run id). Mirrors
  discovery's "same bytecode → same template" model.
- **Autonomous selection**: given an incident/selection, auto-assemble the
  candidate contract set (trace legs + graph), **partition by which (codehash,
  kind) bundles are missing for the active research modes**, invoke the LLM
  **only for the gaps**, and **write results back as bundles**. Bundled
  contracts contribute stored context for free (no model call).
- **Joint creation** (with D7): when both research kinds are active, one analyze
  run over an unknown contract emits **both** the `mev` and `vuln` bundle in a
  single model call — not two runs.
- **Context-budget nudging:** measure (don't assume) the token cost of the base
  prompt + candidate bundles against the **current model's context window**
  before aggregation; steer analyze runs to emit tighter bundles and/or trim the
  selection (lowest-relevance first) so the set that reaches Discovery **jointly
  fits**. Store the per-bundle token estimate for the D6 meter.
- **Remove the Analyze pane** (`panel-agent/`). Retain the signature parser /
  `get_function_code` tool / grounding, now serving the autonomous flow. The
  residual "analyze these specific nodes" need becomes "force a bundle refresh".
- **Repurpose nodes-panel run indicators** to reflect **bundle coverage per
  active kind** (has bundle / important-but-unbundled).
- Watch the **codehash granularity** trap: proxies/minimal-proxies may need the
  implementation codehash, not the proxy's.

### D6 — Discovery bundle selection + live context meter (M) — ADR-012 §4

> "The <MEV Discovery> pane shall have a selection of bundles it will consume,
> which may be deselected by clicking on them. Give a live preview of how much
> the base prompt + current analyze bundles consume of total context of the
> current model."

The Discovery pane lists the **bundles it will consume** for the current
incident; each bundle is **click-to-deselect**, removing it from the verdict/
chat context. A **live context meter** shows the fraction of the current model's
total context used by **base prompt + selected bundles**, updating as bundles are
toggled (uses the D5 token estimates + the active model from Global settings).
Verdict + follow-up run against **selected bundles + the persistent session**
(D2), so the human curates by exclusion and follow-ups stay cheap. Deselection
must invalidate any cached session context built on the removed bundle (D2
staleness rule).

### D7 — Research modes + Vulnerability Discovery pane (L) — ADR-012 §5

> "Create a <Vulnerability Discovery> panel equivalent to <MEV Discovery> but
> with a different System Prompt and consuming vulnerability bundles. On startup
> show [MEV Research] and [Vulnerability Research], default only MEV selected. On
> select the analyze phase shall create bundles for the respective kind; if both
> are selected one analyze run shall create both bundles (not two runs)."

- **Startup research-mode selector**: two buttons **[MEV Research]** and
  **[Vulnerability Research]**; **MEV selected by default**. Persist the choice
  (global settings store). The active modes gate which Discovery panes render and
  which bundle *kinds* D5 produces/consumes.
- **Vulnerability Discovery** pane: same machinery as MEV Discovery (persistent
  session, selectable bundles, live meter, verdict + chat) parameterized by
  `kind = vuln`, with a **distinct system prompt** (a vuln-analysis
  `.pi/SYSTEM.md` variant) and consuming **`vuln` bundles**.
- **One run, both kinds** when both modes active: the analyze/bundle-creation
  step emits a structured multi-output (mev + vuln) per unknown contract in a
  single model call (couples with D5). Each pane consumes only its own kind.

### D8 — Content-addressed `.flat` dedup: productionize `@mev/flat-store` (M) — ADR-012 §7

> "Look at how templates work in DiscoUI. Can this be used to deduplicate
> information in .flat files."

Answer (recorded): **yes** — discovery already content-addresses config via
template **shape hashes**; the same key deduplicates the source bodies. The
`@mev/flat-store` prototype proves it (73% reduction, byte-exact round-trip).
D8 productionizes: have the discovery pipeline's `saveFlatSources`
(`packages/discovery/.../saveDiscoveryResult.ts`) write into a **shared
content-addressed store + per-project manifest** (`path → hash`) instead of a
full `.flat/` copy, referencing blobs by the `sourceHashes` already in
`discovered.json`. Decide **where the store lives** relative to the read-only
submodule (our monorepo, not committed submodule state) and keep **rehydration
byte-exact** (the prototype's round-trip is the guardrail). The same
content-addressing extends to ABIs and, via templates, to config.

### D9 — e2e + docs (S)

e2e/coverage: persistent session survives multiple turns without re-send (D2);
bundle partition invokes the LLM only for unknown (codehash, kind) pairs and
joint-creates both kinds when both modes are on (D5/D7); bundle deselection +
live meter reflect context use (D6); research-mode selector gates panes/bundles
(D7); Control/Funds toggles overlay edges (D3); Value-pane carries enriched
permissions/descriptions (D4); MEV/Vuln Discovery labels (D1/D7); flat-store
round-trip (D8, unit-level already in `@mev/flat-store`). Update CLAUDE.md disco
paragraph + note ADR-012 (superseding parts of ADR-009).

## Order & dependencies

D1 is an independent XS quick win. **D2 is foundational** for D5/D6/D7
(persistent context) — do it early. **D5 (typed bundles + budget) is the spine**;
D6 (selection + meter) and D7 (research modes + Vuln pane) both build on it, and
D5's joint-creation is only exercised once D7's mode selector exists — land D5's
schema/partition first, then D7's modes, then D5's joint-output + D6's meter. D3
(flow edges), D4 (value-pane PROMPT), and D8 (`.flat` dedup) are independent and
can run in parallel. Suggested: D1 → D2 → D5(schema/partition) → D7(modes) →
D5(joint+budget) → D6 → D3 ∥ D4 ∥ D8 → D9.

## Acceptance

- Incident pane reads **MEV Discovery**; a **Vulnerability Discovery** pane
  exists with its own system prompt/bundles; startup selector defaults to MEV
  only (D1/D7).
- A Discovery conversation retains server-side context across turns without
  re-sending; state survives an agent-api restart (D2).
- Nodes panel has Control and Funds toggles overlaying flow on edges (D3); Value
  panel fields carry grounded LLM permission/field descriptions from the config
  PROMPT (D4).
- Analysis is autonomous: the model is invoked only for unknown contracts
  lacking the needed (codehash, kind) bundle, writes bundles to
  `contract_bundles`, joint-creates both kinds in one run when both modes are on,
  and the Analyze pane is gone; run indicators reflect bundle coverage; bundles
  are sized to jointly fit the aggregation context (D5).
- Each Discovery pane shows its consumed bundle set with click-to-deselect **and
  a live context meter** (base prompt + selected bundles vs. the current model's
  window) that updates on toggle (D6).
- `@mev/flat-store` is productionized into the discovery save path with a shared
  content-addressed store + manifests and byte-exact rehydration (D8).

## Risks

- **Bundle cache correctness (D5).** The (codehash, kind) key is the whole value
  of the cache; wrong granularity (proxy vs. implementation) over-shares or never
  hits. Pin the key derivation and test against a proxy-heavy incident.
- **Context budgeting is estimate-driven (D5/D6).** Token estimates per bundle
  must track the real tokenizer/model closely or the meter and the "jointly
  fits" guarantee drift. Measure against the active model; treat overflow as a
  hard trim, not a warning.
- **Two kinds, one run (D5/D7).** Structured multi-output must not let one kind's
  failure corrupt the other; a MEV-only user must never pay for vuln analysis
  (mode gating on both production and consumption).
- **Session lifecycle (D2).** Persistent sessions add eviction/rehydration/
  staleness surface; a session must never serve a deselected/updated bundle set
  (couple with D6). Persistence must not merely move re-send cost into storage.
- **Value-pane PROMPT edits touch the submodule (D4).** Config edits land under
  read-only `l2beat/` as untracked files; never commit submodule state
  (CLAUDE.md). Decide upstreaming/persistence before running D4 broadly.
- **`.flat` store vs. submodule (D8).** The shared store must live in our
  monorepo (not committed submodule state) while discovery writes under
  `l2beat/`; keep rehydration byte-exact (prototype round-trip is the guardrail).
- **Clone-edit reviewability (D3/D6/D7).** Nodes-panel and pane changes must stay
  minimal and `DIVERGENCE(mev)`-marked so re-porting against a newer submodule
  pin stays reviewable (ADR-008 rule).
