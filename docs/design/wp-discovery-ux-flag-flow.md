# Work package: Always-on Discovery kinds, lazy-only Discover, flagged-transaction hand-off, and flow-overlay completion

Prepared 2026-07-23. Implements ADR-017. Stacked on the ADR-016 branch
(`feat/discovery-dedup-architecture`, PR #3); rebase onto `main` once ADR-016
lands. No nginx/Express body-limit changes; no new eager model work.

## Outcome and invariants

When complete:

1. Opening an incident shows both **MEV Discovery** and **Vulnerability
   Discovery** tabs with the catalog already loaded; the top-bar research toggle
   is gone.
2. **Discover** runs whenever there is ≥1 cached bundle **or** ≥1 unresolved
   candidate for the active kind — a cold incident with only candidates is a
   valid run.
3. Every current cached bundle is loaded into context by default; only selected
   *uncached* candidates cost a lazy `request_contract_analysis` child. Opening
   Discovery still performs zero model turns.
4. A **Flag** button sits between Discover and Kill in the DiscoUI top bar and
   durably records the incident; a **Flagged TXs** view in the Explorer bottom
   bar lists, reopens, and removes flags. Persistence is a shared app-owned
   table, not `localStorage`.
5. The trace-route fund/control overlays are backed by a versioned trace-api flow
   endpoint (or a documented graph-derived fallback) and are runtime-verified via
   Playwright with zero upstream calls on toggle.
6. `l2beat/`, pi dirs, generated `trace-*` projects, and secrets are never
   staged.

## Current-state anchors

- `apps/disco/.../multi-view/TopBar.tsx`: research toggle buttons (lines ~74–99)
  and the Discover/Kill group (lines ~101–123).
- `apps/disco/.../panel-agent/research-store.ts`: `mev`/`vuln` persisted booleans,
  `activeResearchKinds`, default both **off**.
- `apps/disco/.../panel-agent/DiscoveryPanes.tsx`: `activeResearchKinds(research)`
  gates the tabs; `selectedCount === 0` disables **Discover**; empty copy says
  "No {kind} bundles or candidates available".
- `apps/disco/.../panel-agent/bundle-preparation-store.ts`: catalog/cache lookup
  consuming `catalog`/`candidate`/`bundle` events (ADR-016).
- `apps/disco/.../panel-terminal/useDiscoveryCommand.ts`: `discover`/`killCommand`
  used by the top bar.
- `apps/explorer-web/public/app.js`: `state.view` (`block`|`address`) view
  switching, `renderResultTable`, one-trace-link-per-incident navigation.
- `apps/explorer-api/src/*`: app-owned cache tables and routes; `@mev/db` owns the
  schema + migration ledger.
- `apps/trace-api/src/server.ts`: `graph`/`graph/v2` routes; **no** flow route.
- `packages/trace-graph/src/flow.ts`: `buildTraceFlowEdges`,
  `buildConfiguredControlEdges`.
- `apps/disco/.../panel-trace/TracePanel.tsx`: `graph.flowEdges ??
  buildTraceFlowEdges(...)` (client-side derivation).
- `apps/disco/.../panel-nodes/controls/Controls.tsx`: mounted Control/Funds
  `FlowToggleButton`s.

## Delivery plan

### A — Always-on kinds; remove the top-bar toggle (S)

- Remove the research-toggle buttons + divider from `TopBar.tsx` and the
  `useResearchStore` usage there.
- Replace `activeResearchKinds` with a constant `['mev','vuln']`; delete
  `research-store.ts` and its `research-modes-v2` persistence and every import.
- `DiscoveryPanes` always renders both kind tabs (retain collapse-on-reclick,
  default first tab). `ensureBundlePreparation` runs for both kinds on open.

Acceptance:
- Fresh workspace shows both tabs and a populated catalog with no interaction.
- No references to `research-store`/`activeResearchKinds` remain; tsc/biome clean.

### B — Gate Discover on analysable evidence (S)

- Enable **Discover** when `selected.length + selectedCandidates.length > 0`
  (already computed as `selectedCount`); ensure candidates are selected by
  default so a cold incident is immediately runnable.
- Update empty-state copy: candidates-only → "N contract(s) will be analysed on
  demand"; genuine empty catalog → an explicit "nothing to analyse" state.
- Confirm the client sends `candidateIds` + `catalogFingerprint` with empty
  `codehashes`; no server change (ADR-016 path already accepts it).

Acceptance:
- With zero cached bundles and ≥1 candidate, Discover is enabled and a run
  reaches a verdict (covered in the Playwright flow, E).
- With an empty catalog, Discover stays disabled with the explicit empty state.

### C — Explicit cached-load / lazy-only invariant (S)

- Ensure all current cached bundles are selected by default and counted in the
  context meter; only uncached candidates route through
  `request_contract_analysis`.
- Add a component/store unit test asserting: cached bundles default-selected and
  in context; candidates default-selected but not analysed until Discover;
  deselecting a candidate removes it from `candidateIds`.

Acceptance:
- Test proves cached vs. lazy split and that opening Discovery issues no
  `/discovery` (model) call.

### D — Flagged transactions (M)

- **Schema (`@mev/db`):** add `flagged_transactions` via the migration ledger —
  `tx_hash` PK, `project`, `block_number`, `label`, `note` (nullable),
  `created_at`. App-owned; ensured at explorer-api boot.
- **explorer-api:** `GET /api/flagged` (list, newest first), `POST /api/flagged`
  (`{txHash, project?, blockNumber?, label?, note?}`; resolve canonical
  identity/label from existing incident data when omitted; idempotent upsert),
  `DELETE /api/flagged/:txHash`. Validate `txHash`.
- **disco nginx + client:** add `/api/flagged` to the disco-web nginx proxy
  (→ explorer-api). Add the **Flag** button to `TopBar.tsx` between Discover and
  Kill: on a trace route it toggles the flag for the current incident (resolved
  via `traceWorkspaceQueryOptions`), reflecting flagged/unflagged state; disabled
  with a title on an ordinary project route.
- **explorer-web:** add a **Flagged TXs** bottom-bar view beside Block/Address.
  Render label · short hash · block; each row links to `/ui/trace/:txHash`; each
  row has a remove control calling `DELETE /api/flagged/:txHash` and refreshing.

Acceptance:
- Flagging in DiscoUI writes a row; it appears in the Explorer **Flagged TXs**
  view; the link reopens the workspace; remove deletes only the flag row.
- Re-flagging the same incident is idempotent (one row). Flags survive an
  explorer-api restart.
- Deleting a flag never touches the synthetic project or evidence.

### E — Verify the fund/control overlays; separate endpoint deferred (M)

- **Finding:** flow edges are already built server-side from persisted evidence.
  `trace-api` `traceEvidence.ts` `executionToGraph()` sets `graph.flowEdges`
  (control via `buildTraceFlowEdges`, funds via `flowMovementsToEdges`); a real
  incident returns 75 edges (59 control, 16 funds) from
  `GET /api/traces/:hash/graph`. The client already consumes these
  (`graph.flowEdges ?? buildTraceFlowEdges(...)`), so the separate
  `GET /api/traces/:hash/flow` endpoint is **deferred** — it adds no fidelity and
  toggling already performs no upstream work. The graph payload is the documented
  source; `buildTraceFlowEdges` stays the pure client fallback.
- No trace-api or client change is required for the overlay source. The work is
  verification.
- **Playwright (`e2e/disco.spec.ts`):** after rebuilding `disco-web`, verify
  Control/Funds beside Show/Hide, labels/legend, toggle off, hidden nodes,
  project-route Funds disabled, and identical behaviour with the WebGL renderer —
  asserting **zero** RPC/source/token/decompiler calls while toggling (counter
  hooks from ADR-016 E0), and at most one internal flow request per versioned key.
- If the server endpoint adds no fidelity for supported snapshots, it may be
  deferred; then document graph-derivation as the supported source and keep the
  no-upstream-work Playwright assertion.

Acceptance:
- Overlays render from the endpoint (or documented fallback); repeated toggles
  add no upstream work; project Funds is disabled with the scope message.

## Sequencing

1. A, B, C are independent client-only slices and can land together.
2. D spans `@mev/db` → explorer-api → nginx/disco → explorer-web; land schema +
   API before the two front-ends.
3. E depends on ADR-016 E2 evidence being present; the Playwright work needs a
   rebuilt `disco-web`.

## Required verification before merge

Per `AGENTS.md`, static checks support but do not replace runtime observation.

- **Static:** `tsc --noEmit` + `biome check` for changed apps/packages;
  vitest for `@mev/db`, explorer-api, and the new disco unit test.
- **Container:** `docker compose config --quiet`; rebuild `explorer-api`,
  `explorer-web`, `disco-web`, and `disco` (nginx) images.
- **Runtime/API:** curl `POST/GET/DELETE /api/flagged`; confirm the flag round
  trips DiscoUI → explorer-web; curl `GET /api/traces/:hash/flow`.
- **Browser (Playwright, rebuilt stack):** both Discovery tabs present with no
  toggle; Discover enabled on a candidates-only incident and reaching a verdict;
  cached-load/lazy split; Flag → Flagged TXs → reopen → remove; Control/Funds
  overlays with zero upstream work on toggle in DOM and WebGL modes.

## Completion and version-control gate

After every required check passes: inspect `git status`/`git diff --check`;
confirm `l2beat`, pi dirs, generated projects, and secrets are unstaged; commit on
`feat/discovery-ux-flag-flow`; push; open an MR targeting `main` (or the ADR-016
branch if it has not yet merged), including flag round-trip evidence and the
Playwright no-upstream-work results. Do not push/MR while any required check
fails.

## Out of scope

- Changing the lazy-analysis wire protocol or bundle schema (ADR-016).
- Raising request body limits.
- `localStorage`-only flag persistence.
- Auto-flagging or bulk-flag import.
- Reworking the Explorer timeline or detectors.
