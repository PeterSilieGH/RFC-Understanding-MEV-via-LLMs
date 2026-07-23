# Work package: Discovery polish — unified edge overlays, per-kind marks, tool-forward prompts, reliable node color, and interactive runs

Prepared 2026-07-23. Implements ADR-018
(`docs/adr/018-discovery-overlays-marks-prompts-and-interactivity.md`). Branch
`feat/adr-018-discovery-polish`, rebased onto `main` (ADR-016 PR #3 and ADR-017
PR #4 have merged). No nginx/Express body-limit changes.

## Implementation status (2026-07-23)

- **Items 7, 4, 2, 1, 6, 3 — implemented and statically verified** (disco
  `tsc --noEmit` clean; agent-api `tsc` + `vitest` green, 37 tests incl. the new
  `discoveryPrompt` snapshot; agent-api Biome clean; `apps/disco` is Biome-excluded
  and kept in its l2beat single-quote/no-semicolon style). Runtime/Playwright
  verification (below) is still pending a stack bring-up.
- **Item 5 (interactive latency) — measured; two levers done, parallelism
  dropped, pre-warm next.**
  - *Done:* **bounded eager surface** (`EAGER_CANDIDATE_CAP` in `DiscoveryPanes`)
    — a cold run default-analyses only the top few unresolved candidates; the rest
    stay visible/selectable. Cached bundles are unaffected.
  - *Done (found during measurement):* **evidence-resolution 502 fix**
    (`decompiler.ts` `boundWarnings`) — an over-long Panoramix warning was failing
    the artifact write and aborting **100% of child analyses** for unverified
    contracts. Verified live: 3 failed children → 3 bundles.
  - *Dropped as measured-unjustified:* **child parallelism**. Live measurement on
    `0xa312a815…` (Qwen): serial children = 33s+13s+11s ≈ 68s, parent verdict
    ≈ 63s, total ≈ 144s. Parallelism would save only ~25% of total while breaking
    `scheduler.ts`'s deadlock-safe/provider-bounded permit invariant against an
    unknown-concurrency provider. Not worth the risk (ADR-018 §5 measured outcome).
  - *Next (still worth doing):* **evidence pre-warm** — resolve verified
    source / codehash identity / bounded Panoramix for selected candidates in the
    background when the catalog opens (a *separate* opt-in path, not the no-RPC
    prepare route), moving the ~33s cold decompile off the run's critical path.
    And a UI **"preparing workspace" vs "analyzing"** split. Both benefit from a
    live before/after but neither needs the risky permit change.

## Outcome and invariants

When complete:

1. The node pane exposes **one exclusive edge mode** — `Default | Control |
   Funds` — sharing a single lane layout; Default = brown, Control = blue
   (order + status), Funds = green (tokens + value). Exactly one mode renders at a
   time; toggling performs **zero** upstream work.
2. A contract shows an **M** tick when a current *mev* bundle covers it and a
   **V** tick when a current *vuln* bundle covers it, derived per-kind from the
   marks store (versioned), separate from the ADR-009 analyze-code/value ticks.
   The verdict-flagged amber "!" is retained.
3. Both Discovery profiles are explicit, tool-forward system prompts that
   enumerate `request_contract_analysis` / `cast` / `get_function_code` and a
   decisive-verdict bar; Vulnerability Discovery uses a security-first profile
   that no longer inherits the MEV `SYSTEM.md`. The discovery prompt version is
   bumped.
4. Trace-route node color comes from **one exported category→palette table** used
   by both the node builder and the legend; every emitted node maps to exactly one
   legend category (no uncolored fallthrough) and renders `hueShift: 0`.
5. The parent's initial Discovery context retains the structural trace tree **and**
   carries a compact, bounded **function-signature index**.
6. Switching (or collapsing) MEV/Vuln tabs **never aborts** the hidden tab's
   in-flight run; the pane re-attaches to the live stream or its saved session on
   return.
7. Discovery runs feel interactive: evidence is pre-warmed off the catalog,
   children can overlap under the concurrency cap, the verdict streams/refines
   incrementally, and the UI distinguishes "preparing workspace" from "analyzing".
8. `l2beat/`, pi dirs, generated `trace-*` projects, and secrets are never staged.

## Current-state anchors

- `apps/disco/.../panel-agent/DiscoveryPanes.tsx` — `activeKind`/`collapsed`
  (lines ~61–65); renders `{activeKind && !collapsed && <DiscoveryKind
  key={activeKind} …>}` (~134–142) so the hidden kind **unmounts**; `DiscoveryKind`
  (~161) holds `abortRef`/`live`/`reasoning`/`running` in component state.
- `apps/disco/.../panel-agent/store.ts` — `ProjectMarks { code, value, important,
  bundles }` (line ~11, `EMPTY` ~35); `addBundleMarks` maps `bundle.kind === 'mev'
  ? 'code' : 'value'` (~94–111) — the conflation to fix.
- `apps/disco/.../panel-nodes/controls/Controls.tsx` — two independent
  `FlowToggleButton layer="control"|"funds"` (~28–29).
- `apps/disco/.../panel-nodes/flow-overlay/FlowOverlayView.tsx` — draws SVG lanes
  for `['control','funds','attempted']` (~34); `flowColor()` (~131): control
  `#38bdf8`, attempted `#fb4a35`, funds `#fe8019` (orange — to become green);
  `strokeDasharray` for `attempted` (~59).
- `apps/disco/.../panel-nodes/flow-overlay/*` and the node renderers — the shared
  lane geometry Default/Control/Funds must all reuse.
- `apps/disco/.../panel-trace/TracePanel.tsx` — `colorForCall()` (COLOR_RED=1,
  ORANGE=2, GREEN=5, BLUE=7, PURPLE=8); node built with `hueShift: 0`.
- `apps/disco/.../panel-trace/TraceLegend.tsx` — separate `LEGEND` array "keep in
  sync with colorForCall" — the duplication to delete.
- `apps/agent-api/src/server.ts` — `DISCOVERY_PROMPTS` (~256–258) + `CAST_HINT`
  (~254, cast only); `discoveryBase()` (~261) assembles prompt + bundles +
  candidates + `traceTree` (~288) + swaps + gas, but **no** signature index;
  `systemPromptSuffix: DISCOVERY_PROMPTS[kind]` (~464). The analyze paths already
  include "Function signatures declared…" (~885) via
  `parseFunctionSignatures`/`formatSignatureList` (`./signatures.js`, imported
  ~20) — reuse for item 6.
- `apps/agent-api/src/*`: `BUNDLE_PROMPT_VERSION` (per-kind, `packages/*`), the
  `RunScheduler` (`AGENT_MAX_CONCURRENCY`), and `request_contract_analysis`
  orchestration (`contractAnalysis.ts`, ADR-016).
- `apps/trace-api/src/traceEvidence.ts` — `executionToGraph()` builds
  `graph.flowEdges` (control via `buildTraceFlowEdges`, funds via
  `flowMovementsToEdges`); evidence resolution (`eth_getCode` + Etherscan +
  Panoramix) for candidates.
- `packages/trace-graph/src/flow.ts` — `buildTraceFlowEdges`,
  `buildConfiguredControlEdges`, edge `layer`/`status` model.

## Delivery plan

Ordered smallest/most-isolated first so early slices land independently.

### Item 7 — Navigation-stable Discovery run (S)

- Stop unmounting the hidden kind. Either (a) render **both** `DiscoveryKind`
  panes and toggle visibility via CSS (`hidden`/`display:none`) keyed by
  `activeKind`/`collapsed`, keeping streams and transcripts alive; **or** (b) hoist
  run/stream state (`live`, `reasoning`, `running`, the abort handle, the
  transcript) into a module-level store keyed by `(project, incident, kind)` that a
  remounting pane reattaches to.
- Switching tabs or collapsing must **not** call `abort()`. Only an explicit Kill
  (or a new run) aborts. Preserve ADR-013 §3 collapse-on-reclick semantics.
- Prefer (a) if two mounted panes don't regress the graph/WebGL cost; fall back to
  (b) otherwise. Reuse the ADR-016 detach-≠-abort contract already applied to
  `bundle-preparation-store`.

Acceptance:
- Start a run in MEV, switch to Vuln and back: the MEV stream is still live (or the
  verdict is intact), no `abort` fired, the server job kept running (Playwright +
  network-count assertion).

### Item 4 — One node-color source of truth (S)

- Add an exported table (e.g. `panel-trace/nodeColors.ts`): `category →
  paletteIndex` for every category the builder can emit (`call`, `staticcall`,
  `delegatecall`, `create`, `swap`, `reverted`, plus any fallthrough default).
- `colorForCall()` resolves via the table with **no uncolored fallthrough** (an
  unknown call type maps to an explicit "other" category, not undefined).
- `TraceLegend` renders from the same table (delete the hand-synced `LEGEND`
  array). Legend stays route-aware (call-type categories on the trace route; the
  project route keeps/gets its own legend).
- Keep `hueShift: 0` on the trace route so node fill equals the legend swatch; DOM
  and WebGL renderers read the same table.
- **Test:** assert every builder category has a legend entry and vice-versa (no
  orphan on either side).

Acceptance:
- Trace-route nodes visibly match legend swatches; the coverage test passes;
  tsc/biome clean.

### Item 2 — Per-kind M/V analyze marks (S–M)

- Extend the marks store to expose per-kind coverage derived from `bundles`
  (already `ContractBundle[]` with `kind` + `codehash`): `hasMevMark(address)` /
  `hasVulnMark(address)` keyed by kind + address, honoring bundle versioning so a
  stale bundle does not mark.
- Stop overloading `code`/`value` in `addBundleMarks` (leave the ADR-009
  analyze-code/value ticks to the analyze skills). Bundles feed M/V only.
- Render an **M** and/or **V** tick on covered nodes (alongside the existing C/V
  analyze ticks and the amber "!"). Marks update optimistically on catalog/child
  completion and hydrate from persisted runs.

Acceptance:
- A contract with a current mev bundle shows **M**; with a vuln bundle shows **V**;
  a contract analyzed by analyze-code still shows its own tick, distinctly.
  Verified in Playwright after a run produces bundles.

### Item 1 — Unified exclusive edge overlay `Default | Control | Funds` (M)

- Replace the two `FlowToggleButton`s in `Controls.tsx` with **one segmented
  control** (`Default | Control | Funds`, default = Default), a single exclusive
  selection.
- Make all three modes render through the **same lane geometry** as the current
  flow overlay (Default gets modeled as neutral structural lanes rather than the
  node renderers' own edges), so switching only re-colors/re-labels.
- Colors via a small `edgeMode → color` table: Default **brown** (`#a8763e`-class),
  Control **blue** (`#38bdf8`), Funds **green** (`#3fb950`-class); `attempted`
  stays dashed + red-tinted. Color is never the only channel (dash/shape/label
  carry status).
- Labels: **Control** emphasizes order + status (sequence/index, call kind,
  decoded name, success/revert); **Funds** emphasizes tokens + value (symbol,
  amount, `from → to` in asset direction; native vs ERC-20/721/1155).
- Legend is route-aware and reflects the active mode. On an ordinary
  discovery-project route Funds stays disabled ("requires a transaction or incident
  scope", ADR-017); Default/Control remain.
- No upstream work on switch — reuse the graph-carried `graph.flowEdges`
  (ADR-017 §5).

Acceptance:
- Exactly one mode visible; correct colors/labels per mode; Funds disabled on a
  project route; toggling issues zero RPC/source/token/decompiler calls
  (Playwright network-count assertion, DOM + WebGL).

### Item 6 — Bounded function-signature index in the parent context (M)

- In `discoveryBase()`, after the trace tree, append a compact, size-capped
  **function-signature index** for the incident's participating contracts, built
  from discovery ABIs / decoded selectors (reuse `parseFunctionSignatures` +
  `formatSignatureList` from `signatures.js`, already used by the analyze paths).
- Cap total size (contracts × signatures, truncation marker) so the request stays
  within existing limits — **no** nginx/Express change. Label it clearly
  ("Callable surface of the incident's contracts").
- **Test:** a prompt-snapshot/unit test on `discoveryBase()` asserting both the
  trace tree **and** the signature index appear in the assembled context.

Acceptance:
- Assembled discovery context contains both sections; size stays bounded; snapshot
  test passes.

### Item 3 — Tool-forward prompts + separate vuln profile (M)

- Rewrite `DISCOVERY_PROMPTS.mev` and `.vuln` as explicit, tool-forward system
  prompts that:
  - enumerate the parent's real tools and **when to use each** —
    `request_contract_analysis(candidateId)` for any selected unresolved candidate
    load-bearing for the verdict (noting it yields verified source or
    Panoramix-decompiled evidence); read-only `cast` for missing on-chain facts;
    `get_function_code` for grounded bodies in reusable children;
  - state the **decisive-verdict bar**: if current evidence is insufficient,
    request more (analyze another candidate, cast a slot/balance/call) before
    concluding, and only return "insufficient evidence" after exhausting cheap,
    available tools — never fabricating facts;
  - preserve the research-ethics rule (no deployable extraction/exploit).
- Give **Vulnerability Discovery a security-first profile that does not inherit the
  MEV `SYSTEM.md`** (closing ADR-016 §4/E8): root-cause bugs, reachable failure
  modes, trust boundaries, prerequisites, graded confidence. Wire the profile
  selection at the `systemPrompt`/`systemPromptSuffix` seam so vuln uses its own
  base rather than appending to MEV's.
- Fold the cast-only `CAST_HINT` into the enumerated tool list (remove or repurpose
  it). Bump the discovery prompt version (`BUNDLE_PROMPT_VERSION` per kind and/or
  the discovery prompt-version constant) so prompt-versioned bundles re-run.

Acceptance:
- Both prompts name the three tools + the verdict bar; vuln no longer contains MEV
  framing; version bumped. A live run with an unresolved candidate shows the parent
  actually calling `request_contract_analysis`/`cast` rather than concluding
  "insufficient evidence" prematurely (observed in the agent-api NDJSON stream).

### Item 5 — Interactive Discovery latency (L)

Largest slice; land after the others. Sequenced sub-steps:

- **Pre-warm evidence off the catalog.** When the catalog opens (no-model lookup,
  ADR-016/017), kick off background evidence resolution in trace-api (verified
  source / codehash identity / bounded Panoramix) for the selected candidates, so a
  later `request_contract_analysis` hits warm evidence and pays only the model turn.
  Bound and de-dupe with the existing resolver; respect the RPC connection cap.
- **Parallelize children under the cap.** Introduce `AGENT_CHILD_MAX_CONCURRENCY`
  (≤ `AGENT_MAX_CONCURRENCY`, default keeps current behavior) and let the scheduler
  run that many child analyses concurrently instead of strictly serial handoff.
- **Stream + commit incrementally.** Surface each child's bundle to the UI as it
  lands (`subagent` events already exist) and let the parent emit a **preliminary
  verdict** it refines as evidence arrives, rather than blocking the first token on
  all tool calls.
- **Bound the eager surface.** Default to analyzing only the highest
  trace-relevance unresolved candidates unless the user selects more; cap per-run
  child count and per-child wall time with visible progress.
- **Split workspace vs run latency in the UI.** Distinct "preparing workspace"
  (the one-time `l2b discover`) vs "analyzing" states; ensure discovery output is
  cached so re-opening an incident is instant.
- Non-goal: changing the RPC node or the one-verdict-in-one-context model.

Acceptance:
- A cold incident with several unresolved candidates reaches a first
  streamed/preliminary verdict in seconds and completes materially faster than the
  serial baseline (before/after wall-clock on the same incident); no RPC
  connection-cap regressions; pre-warm issues no model turns.

## Sequencing

1. Items 7, 4, 2 are isolated client slices — land first (each independently
   testable).
2. Items 1 and 6 are self-contained (client / agent-api respectively).
3. Item 3 is agent-api + prompt-version bump.
4. Item 5 is the large cross-cutting latency slice (agent-api scheduler +
   trace-api pre-warm + disco UI states) — land last.

## Required verification before merge

Per `AGENTS.md`, static checks support but do not replace runtime observation.

- **Static:** `tsc --noEmit` + `biome check` for changed apps/packages; vitest for
  the new color-coverage, marks, and `discoveryBase` snapshot tests.
- **Container:** `docker compose config --quiet`; rebuild `disco-web`, `disco`
  (nginx), `agent-api`, and `trace-api` for the slices that touch them.
- **Runtime/API:** drive the agent-api NDJSON stream (:3100) for the tool-forward
  prompt behavior and incremental verdict; confirm graph `flowEdges` unchanged.
- **Browser (Playwright, rebuilt stack):** exclusive edge mode with correct
  colors/labels and zero upstream work on toggle (DOM + WebGL); M/V marks after a
  run; tab-switch preserves an in-flight run; node color matches legend.

## Completion and version-control gate

After every required check passes: inspect `git status` / `git diff --check`;
confirm `l2beat`, pi dirs, generated `trace-*` projects, and secrets are unstaged;
commit on `feat/adr-018-discovery-polish`; push; open an MR targeting `main`,
including the overlay/marks/tab-switch Playwright evidence and the latency
before/after. Do not push/MR while any required check fails.

## Out of scope

- Changing the lazy-analysis wire protocol or bundle schema (ADR-016).
- Raising request body limits.
- Changing the RPC node or the one-verdict-in-one-context model.
- Reworking the Explorer timeline, detectors, or the flagged-TX flow (ADR-017).
