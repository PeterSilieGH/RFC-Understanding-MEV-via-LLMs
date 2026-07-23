# ADR-018: Unified edge overlays, analyze marks, tool-forward prompts, reliable node color, and interactive Discovery

## Status

Proposed — 2026-07-23. A companion work package will track implementation
(`docs/design/wp-discovery-polish.md`, to be written). Builds on ADR-016
(shared evidence, lazy children, flow overlays) and ADR-017 (always-on kinds,
flagged TXs, flow verification); both are on feature branches not yet merged, so
this branch is stacked on `feat/adr-017-discovery-ux`.

## Context

ADR-016/017 delivered the fund/control flow overlays, the lazy child-analysis
Discovery flow, and the node graph, but day-to-day use surfaced seven concrete
rough edges. Each decision below is preceded by what the code does today.

## Decisions

### 1. Control, Funds, and Default edges are one exclusive, same-layout overlay

**Today.** The base dependency/call edges ("default") are drawn by the node
renderers; Control and Funds are two *independent* toggles
(`Controls.tsx` → two `FlowToggleButton`s) whose `FlowOverlayView` draws its own
SVG lanes. `flowColor()` returns control `#38bdf8` (blue), funds `#fe8019`
(orange), attempted `#fb4a35` (red). So default and flow edges use different
render paths, funds is orange, and control+funds can be shown at once (or
neither), producing overlapping or inconsistent edge pictures.

**Decision.** The node pane exposes **one exclusive edge mode** — `Default |
Control | Funds` (a segmented control, default = Default) — and all three modes
share the **same edge layout/rendering** (the flow-overlay lane geometry), so
switching modes only re-colors/re-labels the same lanes rather than swapping
render engines. Exactly one mode is visible at a time.

- **Default** — the structural dependency/call graph, **brown** (`#a8763e`-class,
  the coffee accent). Neutral "who called/─referenced whom".
- **Control** — execution ordering and status, **blue** (`#38bdf8`, unchanged).
  Labels emphasize **order of execution and status**: sequence/index, call kind,
  decoded selector/name, and success/revert (`attempted`/reverted stay dashed +
  red-tinted).
- **Funds** — value movement, **green** (`#3fb950`-class). Labels emphasize the
  **tokens involved and value transferred**: asset symbol, amount, and
  `from → to` in true asset direction; native vs ERC-20/721/1155 distinguished.

Color is never the only channel (shape/dash/label carry status too, per ADR-016
§5). The route-aware legend reflects the active mode. On an ordinary
discovery-project route, Funds stays disabled ("requires a transaction or
incident scope", ADR-017) and Default/Control remain. Toggling modes performs no
upstream work (the graph payload already carries `flowEdges`, ADR-017 §5).

### 2. Reintroduce per-kind analyze marks (M for MEV, V for Vulnerability)

**Today.** `useAgentMarksStore` tracks `code`/`value` coverage and renders two
ticks (`hasCodeMark`/`hasValueMark`) from the ADR-009 Analyze skills.
`addBundleMarks` overloads them: an **mev** bundle marks `code`, a **vuln**
bundle marks `value`. So "this contract has an MEV bundle" and "…was analyzed by
the analyze-code skill" collapse into one indistinct tick, and the intent —
*show which contracts have been analyzed for each Discovery kind* — is lost.

**Decision.** Node marks become **kind-explicit**: a contract shows an **M** tick
when a current **mev** bundle covers it and a **V** tick when a current **vuln**
bundle covers it (derived from the marks store's `bundles`, keyed by kind +
address, using the ADR-016 bundle versioning so stale bundles do not mark). The
legacy ADR-009 analyze-code/value coverage remains available but is separated
from the Discovery M/V marks rather than conflated. The verdict-flagged-but-
unanalyzed amber "!" (ADR-009) is retained. Marks update optimistically as
bundles arrive (catalog/child completion) and hydrate from persisted runs.

### 3. Tool-forward MEV and Vulnerability Discovery prompts

**Today.** `DISCOVERY_PROMPTS[kind]` are two terse sentences plus a `CAST_HINT`
that mentions only `cast`. They do not mention `request_contract_analysis` (the
parent's main tool for unresolved candidates, which triggers verified-source or
**Panoramix** evidence server-side) and do not tell the model to reach for tools
when the supplied evidence is insufficient for a decisive verdict. Vulnerability
Discovery is still a **suffix appended to the MEV `.pi/SYSTEM.md`**, which biases
it toward MEV framing (the ADR-016 §4/E8 separate-profile goal is unfinished).

**Decision.** Rewrite both Discovery profiles as explicit, tool-forward system
prompts (server-selected, versioned — bumping `BUNDLE_PROMPT_VERSION`/the
discovery prompt version):

- Enumerate the parent's actual tool surface and **when to use each**:
  `request_contract_analysis(candidateId)` for any selected unresolved candidate
  whose behavior is load-bearing for the verdict (noting it yields verified
  source or Panoramix-decompiled evidence for unverified code);
  read-only `cast` for on-chain facts the bundles/evidence lack; and, for
  reusable children, `get_function_code` for grounded bodies.
- **Make the decisive-verdict bar explicit:** if the current evidence does not
  support a confident verdict, the model must **request more** (analyze another
  candidate, cast a slot/balance/call) before concluding, and only return
  "insufficient evidence" after exhausting the cheap, available tools — while
  never fabricating unavailable facts.
- Vulnerability Discovery uses a **security-first profile that does not inherit
  the MEV system prompt** (closing ADR-016 §4/E8): root-cause bugs, reachable
  failure modes, trust boundaries, prerequisites, graded confidence.
- Preserve the research-ethics rule (no deployable extraction/exploit).

### 4. One source of truth for node color; nodes always match the legend

**Today.** Trace node color comes from `colorForCall()` (call type → `COLOR_*`
index) with `hueShift: 0`, while `TraceLegend` keeps a **separate** `LEGEND`
index table "kept in sync with `colorForCall`" by hand. The constants happen to
agree now (`call=7`, `staticcall=0`, `delegatecall=8`, `create=5`, `swap=2`,
`reverted=1`), but the duplication is fragile, and on other paths (the
discovery-project route's per-contract colors + non-zero `hueShift`, or any
uncolored fallthrough) nodes can drift from the swatches the legend advertises.

**Decision.** Introduce a **single exported color table** (category → palette
index) consumed by *both* the node builder and the legend, deleting the
"keep in sync" duplication. On the trace route every node resolves to exactly one
legend category (no uncolored fallthrough) and renders with `hueShift: 0` so its
fill equals the legend swatch; the DOM and WebGL renderers read the same table.
The legend is route-aware (call-type categories on the trace route; the
project-route palette is documented or given its own legend). A test asserts
every category the builder can emit has a legend entry and vice-versa.

### 5. Make Discovery runs interactive instead of multi-minute

**Today — where the minutes go.**
- **Workspace discovery** (first open of `/ui/trace/:hash`): one bounded
  `l2b discover` over an RPC node with no log index (compose caps
  `RPC_GETLOGS_MAX_BLOCKS`), typically ~1 min. Gates the whole workspace.
- **The Discovery run itself**: the parent streams tokens quickly, but each
  `request_contract_analysis` child is a **full model turn** run **serially**
  through the one `RunScheduler` (`AGENT_MAX_CONCURRENCY`, often 1) with
  permit-handoff, and each child first **resolves evidence** (trace-api
  `eth_getCode` + Etherscan source, and for unverified code a Panoramix
  decompile up to a 30 s timeout). A handful of unresolved candidates therefore
  serializes into minutes before the verdict.
- Cold source/decompilation is fetched **on demand inside the run**, not
  pre-warmed.

**Decision (suggested changes, to be sequenced in the WP).**
- **Pre-warm evidence out of band.** When the catalog is opened (already a
  no-model lookup, ADR-016/017), begin resolving verified source / codehash
  identity / (bounded) Panoramix for the selected candidates in the background
  through trace-api, so a later `request_contract_analysis` hits warm evidence
  and only pays the model turn.
- **Parallelize children up to the provider cap.** Allow more than one in-flight
  child when `AGENT_MAX_CONCURRENCY` (or an explicit `AGENT_CHILD_MAX_CONCURRENCY`
  ≤ total) permits, instead of strictly serial handoff, so N cheap analyses
  overlap.
- **Stream and commit incrementally.** Surface each child's bundle to the UI the
  moment it lands (the `subagent` events exist) and let the parent produce a
  **preliminary verdict** it refines as evidence arrives, rather than blocking
  the first token on all tool calls.
- **Bound the eager surface.** Default to analyzing only the highest
  trace-relevance unresolved candidates unless the user selects more; cap
  per-run child count and per-child wall time with visible progress.
- **Separate workspace-discovery latency from run latency** in the UI (a
  distinct "preparing workspace" vs "analyzing" state) and cache discovery
  output so re-opening an incident is instant.
- Non-goal: changing the RPC node or the one-verdict-in-one-context model.

### 6. The initial Discovery context carries the trace tree *and* a signature index

**Today.** `discoveryBase()` includes the structural **trace tree**, decoded
swaps, incident economics, the selected bundles (role/entry points/flow), and the
unresolved-candidate list. It does **not** include a function-signature index for
the incident's contracts — signatures are only seen by reusable children (via
`get_function_code`) or implicitly through a bundle's entry points. So the parent
reasons about ordering/value from the trace tree but has no direct view of the
callable surface of the contracts unless it spends a child turn.

**Decision.** The parent's initial MEV/vuln context **retains the structural
trace tree** (confirmed present) **and additionally includes a compact,
bounded function-signature index** for the incident's participating contracts
(decoded selectors/signatures already available from discovery ABIs and
`swaps.trace_address`), clearly labeled and size-capped so the request stays
within limits (no nginx/Express change). This grounds the parent's first turn in
the callable surface, reducing avoidable child turns. Verified via a prompt
snapshot test asserting both the trace tree and the signature index appear.

### 7. Switching MEV/Vuln tabs must not end the hidden tab's run

**Today.** `DiscoveryPanes` renders only the active kind's pane
(`{activeKind && !collapsed && <DiscoveryKind key={activeKind} …>}`), so
switching tabs **unmounts** the previous `DiscoveryKind`. Its in-flight run lives
in component state (`abortRef`, `live`, `reasoning`, `running`); on unmount that
state is lost and the streamed verdict is orphaned, even though the catalog
preparation is already navigation-stable at module scope
(`bundle-preparation-store`).

**Decision.** The in-flight Discovery run becomes **navigation-stable**, matching
ADR-016's "navigation/transport disconnect detaches a subscriber, it does not
abort the job" principle. Either (a) keep both kind panes **mounted** and toggle
visibility (so their streams and transcripts survive tab switches), or (b) hoist
the run/stream state into a module-level store keyed by
`(project, incident, kind)` that a remounting pane **reattaches** to. Switching
away must not call `abort()`; the server job continues and the pane re-attaches
to its live stream (or its just-saved session) on return. Collapsing/expanding a
tab likewise preserves the run.

## Consequences

- One coherent, legible edge picture (exclusive mode, shared layout, meaningful
  colors) instead of two overlapping toggles; clearer at-a-glance analyze
  coverage (M/V); prompts that actually drive the available tools toward a
  decisive verdict; node colors that match their legend; noticeably more
  interactive Discovery; a better-grounded first parent turn; and no lost runs
  when flipping tabs.
- Costs: a segmented edge control + shared renderer refactor; a marks-model
  change; versioned prompt migration (invalidates prompt-versioned bundles);
  a color-table refactor with a coverage test; background evidence pre-warm +
  optional child parallelism + incremental verdict (the largest slice); a
  bounded signature-index addition; and making the run navigation-stable.
- This ADR is stacked on ADR-016/017; it lands after them or is rebased onto
  `main` once they merge.

## Alternatives considered

- **Keep Control/Funds as independent toggles and just recolor.** Rejected: the
  user wants one legible picture; overlapping semantic layers confuse more than
  they show, and Default should share the same lanes.
- **Keep marks generic (analyzed / not).** Rejected: MEV vs Vulnerability
  coverage are independently useful and already tracked per kind.
- **Only append more text to the MEV system prompt for vuln.** Rejected: it
  perpetuates the MEV bias (ADR-016 §4); a separate profile is the fix.
- **Cut child analyses to speed runs.** Rejected: the analyses are the value;
  pre-warming, parallelism, and incremental verdicts cut latency without cutting
  evidence.
- **Abort the hidden tab's run and restart on return.** Rejected: it wastes a
  model turn and can lose a verdict; server-owned jobs with reattachment are the
  ADR-016 contract.
