# ADR-017: Always-on Discovery kinds, lazy-only Discover gating, flagged-transaction hand-off, and flow-overlay completion

## Status

Proposed — 2026-07-23. Implementation is tracked by
`docs/design/wp-discovery-ux-flag-flow.md`.

Builds on and refines ADR-016 (shared evidence, lazy Discovery children, flow
overlays), which is still on its feature branch (`feat/discovery-dedup-architecture`,
PR #3) and not yet merged. This ADR depends on that work and its branch is
stacked on it.

## Context

The lazy-Discovery integration from ADR-016 is functional end-to-end (catalog →
catalog-only open → `request_contract_analysis` child → versioned bundle →
verdict), but day-to-day use surfaced four gaps between the shipped behaviour and
what an operator expects.

1. **Research kind is a hidden, opt-in top-bar toggle.** `TopBar.tsx` renders
   two persisted buttons (*MEV Research* / *Vulnerability Research*) backed by
   `research-store` (`research-modes-v2`, both default **off**). The Discovery
   pane only shows a tab for a kind that is toggled on (`activeResearchKinds`).
   With the default-off store a fresh workspace shows *no* Discovery tabs and
   fetches *no* catalog, so Discovery looks empty until the operator discovers
   the toggle. The kind selection is incidental configuration, not a mode the
   top bar should own.

2. **Discover is gated on cached bundles existing.** `DiscoveryPanes` disables
   **Discover** when `selectedCount === 0` and shows *"No {kind} bundles or
   candidates available"*. Because ADR-016 made opening Discovery a
   catalog-only lookup, a cold incident legitimately has **zero cached bundles**
   and only *unresolved candidates* — which are analysed lazily during the run.
   Gating on cached bundles contradicts the lazy design: the run must be allowed
   whenever there is at least one candidate to analyse, even with no cached
   bundle.

3. **Cached vs. lazy selection is not made explicit.** ADR-016 already selects
   both cached bundles and unresolved candidates by default and only the latter
   drive `request_contract_analysis`. The desired contract — *always load every
   cached bundle into context; only spend a model turn on candidates that have no
   current bundle* — is implicit and easy to regress. It should be a stated
   invariant with a test.

4. **A flagged incident cannot be handed back to the Explorer.** A trace
   workspace is a synthetic, disposable `trace-<hash8>` project (ADR-008).
   There is no way from DiscoUI to mark *"this incident is worth revisiting"*
   and find it again later from the MEV Block Explorer. The two apps are
   separate origins (disco-web nginx vs. explorer-web), so a shared, durable
   store is required rather than per-origin `localStorage`.

Separately, this ADR records the **completion status of ADR-016's fund/control
node-pane enrichments (E9/E10)** and closes the remaining gap:

- The UI controls exist (`Controls.tsx` → two `FlowToggleButton`s), the semantic
  model exists (`@mev/trace-graph` `buildTraceFlowEdges`,
  `buildConfiguredControlEdges`), and both renderers consume them
  (`FlowOverlayView`, `geometry.ts`).
- **Correction to an earlier draft of this ADR:** the flow edges *are* built
  server-side. `apps/trace-api/src/traceEvidence.ts` `executionToGraph()`
  populates `graph.flowEdges` from persisted execution + flow evidence (control
  edges via `buildTraceFlowEdges`, fund movements via `flowMovementsToEdges`) and
  returns them in the graph payload. A runtime check on a real incident confirms
  it: `GET /api/traces/:hash/graph` returns **75 flow edges (59 control /
  observed, 16 funds / committed)**. The client's
  `graph.flowEdges ?? buildTraceFlowEdges(...)` therefore consumes
  server-authoritative, evidence-backed edges and only falls back to client
  derivation for an older payload. There is no separate `/flow` endpoint, but the
  ADR-016 §5/E9 intent (evidence-backed flow, no upstream work on toggle) is met
  by the graph payload.
- The genuine gap is **verification**: the overlays have never been
  runtime-verified in the UI, and no Playwright coverage exercises the toggles,
  legend, LOD tiers, or the no-upstream-work guarantee.

## Decision

### 1. Research kinds are always on; the top-bar toggle is removed

Both **MEV Discovery** and **Vulnerability Discovery** are always available as
tabs inside the Discovery pane. The *MEV Research* / *Vulnerability Research*
buttons and their divider are removed from `TopBar.tsx`.

`activeResearchKinds` becomes the constant `['mev', 'vuln']`. `research-store`
and its `research-modes-v2` persistence are removed (no migration needed — it was
UI-only state). The Discovery pane always renders both kind tabs; the existing
collapse-on-reclick tab behaviour (ADR-013 §3) is retained, and the first tab is
selected by default.

The catalog/cache lookup (`ensureBundlePreparation`) now always runs for both
kinds when a workspace opens, so cached bundles and candidates are visible
immediately without any toggle.

### 2. Discover is gated on *analysable evidence*, not on cached bundles

**Discover** is enabled whenever the selection contains at least one cached
bundle **or** at least one unresolved candidate for the active kind. The
empty-state copy changes from *"No bundles available"* to language that reflects
lazy analysis (e.g. *"N contracts will be analysed on demand"* when only
candidates are present, and a genuine empty state only when the catalog returned
nothing at all).

A run with zero cached bundles and ≥1 selected candidate is valid: the parent
opens with catalog context and uses `request_contract_analysis` to analyse the
selected candidates during the run. The client sends `candidateIds` (+
`catalogFingerprint`) with an empty `codehashes`, which the ADR-016 server path
already accepts.

### 3. Cached bundles always load; only uncached candidates go lazy

Stated invariant, enforced by the client and covered by a test:

- Every **current cached bundle** for the active kind is included in the
  Discovery context by default (selected), contributing to the context meter.
- Every **unresolved candidate** (no current bundle) is selectable and, when
  selected, is analysed lazily via one bounded `request_contract_analysis`
  child — never eagerly on open.
- Deselecting either removes it from context and, for a candidate, removes the
  parent's authority to analyse it (ADR-016 §3). Cached bundles remain
  deselectable for context-budget control.

This is the ADR-016 behaviour promoted to an explicit, tested contract; it does
not change the wire protocol.

### 4. Flagged transactions: a DiscoUI → Explorer hand-off

A **Flag** button is added to the DiscoUI top bar **between Discover and Kill**.
On a trace route it flags the current incident; it is disabled (with an
explanatory title) on an ordinary discovery-project route where there is no
incident.

Flagging persists a durable record so the incident can be reopened later from the
Explorer:

- A single **app-owned** table `flagged_transactions`, owned by `@mev/db`'s
  migration ledger and written/read through **explorer-api** (the owner of
  app-owned cache tables such as `block_builders`/`block_bids`). Columns:
  canonical incident tx hash (smallest leg hash, matching the `trace-<hash8>`
  canonical name), synthetic project name, block number, a short MEV-type label,
  optional note, and `created_at`. The tx hash is the primary key (idempotent
  re-flagging).
- **explorer-api** exposes `GET /api/flagged`, `POST /api/flagged`
  (`{txHash, project?, blockNumber?, label?}` — it resolves canonical
  identity/label from existing incident data when omitted), and
  `DELETE /api/flagged/:txHash`.
- **DiscoUI** reaches explorer-api through the existing nginx `/api/mev` →
  explorer-api proxy (a sibling `/api/flagged` route is added to that proxy);
  the Flag button POSTs and reflects flagged/unflagged state.
- **explorer-web** gains a **Flagged TXs** view in the bottom bar alongside the
  Block/Address views. It lists flagged incidents (label · short hash · block),
  each row links to `/ui/trace/:txHash` (reusing the existing one-trace-link
  navigation), and each row has a **remove** control that calls
  `DELETE /api/flagged/:txHash` and updates the list.

Persistence is server-side and shared across both origins; it is **not**
`localStorage`. Removing a flag deletes only the flag row; it never deletes the
synthetic project or any evidence.

### 5. Verify the fund/control flow overlays; the separate endpoint is deferred

ADR-016's flow overlays are retained. Given the finding above — flow edges are
already built server-side from persisted evidence and delivered in the graph
payload — the separate `GET /api/traces/:hash/flow` endpoint proposed in an
earlier draft is **deferred**: it would add no fidelity over the
graph-carried, server-authoritative `graph.flowEdges`, and toggling already
performs no upstream work (it re-renders the already-fetched graph). The
graph payload is documented as the supported source; `buildTraceFlowEdges`
remains a pure client-side fallback for an older payload lacking `flowEdges`.

The remaining work is therefore **verification**, previously skipped:

- The project-route **Control** overlay (configured permissions from
  `discovered.json`) and disabled-**Funds** state are unchanged.
- Rebuild `disco-web` and add Playwright coverage to `e2e/disco.spec.ts` for
  Control/Funds beside Show/Hide, toggle on/off, the legend, hidden-node
  handling, project-route Funds disabled, and identical behaviour with the WebGL
  renderer — asserting **zero** upstream RPC/source/token/decompiler calls while
  toggling (ADR-016 §5/E10 acceptance). Toggling must not refetch the graph.

If a future incident snapshot shows the graph-carried edges are insufficient, the
dedicated endpoint can be revisited; until then it is intentionally not built.

## Consequences

- Discovery is usable immediately on opening an incident: both kinds visible,
  catalog loaded, Discover enabled whenever there is anything to analyse.
- One less persisted UI mode (`research-store` removed); the top bar is simpler.
- A new app-owned table and three explorer-api routes; DiscoUI depends on the
  explorer-api proxy for flag writes. Flags survive restarts and are shared
  across the two front-ends.
- The flow overlays gain a faithful server-backed source and, for the first time,
  runtime/Playwright verification; the ADR-016 E9 "server endpoint" intent is
  realised (or explicitly, deliberately, waived with the fallback documented).
- Because this branch is stacked on the unmerged ADR-016 branch, it must land
  after (or be rebased onto) that work.

## Alternatives considered

- **Keep the research toggle but default both on.** Rejected: the buttons still
  occupy the top bar and can be turned off, reintroducing the empty-Discovery
  confusion. Both kinds are cheap to show as tabs.
- **Gate Discover on candidates only when a model is configured.** Rejected:
  over-complex; the server already rejects a run with no analysable evidence, and
  the button simply mirrors "is there anything to analyse".
- **Store flagged txs in `localStorage`.** Rejected: disco-web and explorer-web
  are different origins, so it would not be shared; and it would not survive a
  profile change. A shared app-owned table is the correct home.
- **Flag by writing a marker file into the synthetic project.** Rejected: the
  project is disposable and may be garbage-collected; the Explorer would have to
  scan the projects dir. A queryable table is simpler and durable.
- **Leave the flow overlays graph-derived and unverified.** Rejected for this
  ADR's scope: ADR-016 explicitly specified a server evidence source and
  no-upstream-work verification; at minimum the runtime/Playwright gap must close.
