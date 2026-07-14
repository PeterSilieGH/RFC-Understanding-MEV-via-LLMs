# Work package: Trace workspace (M4.5, ADR-008)

Prepared 2026-07-14. Implements [ADR-008](../adr/008-trace-workspace-panels.md):
the standalone trace view (`/ui/trace/:txHash`) becomes a full DiscoUI
workspace — List / Nodes / Values / Code / Preview / Analyze tabs around a
shared selection, with trace-scoped top and bottom bars.

## Preconditions (all met)

- M1–M4 complete, 25/25 e2e passing against the live stack (2026-07-14).
- disco-api runs writable (project creation + `l2b discover` terminal
  endpoints attached — covered by e2e).
- RPC node healthy; discovery load discipline in place (`RPC_MAX_SOCKETS`,
  shared per-address discovery cache).

## Out of scope

- A *functional* Analyze tab — it ships disabled; the agent behind it is M5
  (ADR-006). Its target→run→markdown contract is however fixed here.
- Any upstream (submodule) modification, per standing rules.
- Explorer-side changes: the deep link contract (`/ui/trace/:txHash`) is
  unchanged.

## Tasks (in order)

### T1 — Spike: bounded discovery run (S)

Find the exact `packages/discovery` config knobs to run discovery over a
fixed address set **without recursive reference-following** (candidates:
initialAddresses-only config, `maxDepth`-style limits, ignoreDiscovery
overrides). Deliverable: a hand-written `trace-xxxxxxxx` project config that
discovers a known sandwich's contract set in one bounded run, plus notes on
run time and RPC request count. Everything downstream assumes this works;
if no knob bounds the run acceptably, revisit ADR-008's synthetic-project
decision before proceeding.

### T2 — Synthetic project lifecycle (M)

Given a tx hash: resolve the incident (per-tx MEV facts → `counterpartTxHash`
/ `victimTxHashes`), collect the unique contract addresses across all legs'
traces, create/refresh the `trace-<hash8>` project (config from T1), run
discovery, and report status. Placement: a small orchestration endpoint in
`trace-api` (it already talks to the trace + MEV surfaces) that drives
disco-api's existing project/terminal endpoints; the frontend polls status.
Exclude `trace-*` from the home page project list (`DIVERGENCE(mev)` filter
in `HomePage.tsx`).

### T3 — Workspace shell and routing (M)

`TracePage` mounts the docked multi-view instead of a lone panel: own
docking config (`storageKey: docking/v2:trace`, default `list | nodes |
values`), panel registry limited to the trace-relevant tabs. **Plumbing
decision:** Values/Code/Preview resolve their project via
`useParams().project`; the trace route must supply `project =
trace-<hash8>` (nested route param or a `DIVERGENCE(mev)` project-context
provider) so those panels run byte-identical. Selection stays the shared
`panel-store` (address-keyed); List/Nodes translate call-node → contract
address when selecting.

### T4 — List panel, incident folders (M)

Trace variant of the List: **Initial** folder = each leg's root call;
one folder per leg (`Front-run`, `Victim`/`Victim n`, `Back-run`, or a
single `Trace` folder for non-MEV transactions) holding that leg's call
nodes in trace order. Entries show resolved contract name + decoded
selector; selecting an entry drives the shared selection and focuses the
graph. Loads *all* legs' traces (incident-scoped, from T2's resolution).

### T5 — Nodes auto-naming (S/M)

Node titles from the synthetic project's contract names (template/meta →
verified source name → shortened address); field labels decode selectors
against discovered ABIs instead of raw 4-bytes. MEV overlay (ADR-007)
unchanged.

### T6 — Values / Code / Preview wiring (S)

With T2+T3 in place these are the stock panels pointed at the synthetic
project — the work is verification (fields render, sources load, Preview
dossier highlights the selected contract) and empty-state polish while
discovery is still running.

### T7 — Top and bottom bars (M)

Trace variants: TopBar shows incident identity (tx hash, MEV type), node
search, layout slots, add/reset panel, settings; Discover/Kill drive the T2
run. BottomBar keeps the status ribbon (trace fetch / discovery / RPC
state), hotkeys, F1 help. Implement as thin wrappers so the shared
components stay unmodified.

### T8 — Analyze stub (XS)

Tab registered but disabled, pointing at ADR-006/008. Its enablement is
M5's first UI task.

### T9 — e2e + docs (S)

e2e: deep-linking a known sandwich shows Initial + leg folders; selecting a
List entry updates Values/Code; `trace-*` projects hidden from the home
list; repeat open does not re-run discovery. Amend ADR-008 status to
"implemented"; update `CLAUDE.md`'s trace-panel paragraph.

## Acceptance (mirrors M4.5 in ARCHITECTURE.md)

Opening a sandwich deep link shows all legs in List folders; selecting a
call in List or Nodes shows that contract's discovered fields, verified
sources, and permissions dossier; first open triggers exactly one bounded
discovery run, later opens serve from disk; all panels dock/split/persist
like the project workspace.

## Risks

- **RPC load** — the bounded run is new state-read traffic against a node
  with a history of degradation. Mitigations: T1 measures before anything
  ships; fixed address set; shared cache (routers/pools/WETH repeat across
  incidents); socket cap. The status ribbon must make a stuck run visible
  and killable.
- **Deepened submodule dependency** — the workspace leans harder on
  disco-api (`l2b ui`), cutting against ADR-004's obsolescence goal. Kept
  acceptable by consuming only the documented endpoints already mapped in
  `docs/L2BEAT.md`; porting them later remains possible.
- **Clone drift** — new `DIVERGENCE(mev)` surface (List variant, bars,
  HomePage filter, project plumbing). Keep each one a separate small file or
  clearly-marked edit so re-porting against a newer pin stays reviewable.
- **T1 may falsify the plan** — that is its job; the fallback (lightweight
  naming from verified sources + ABI decode only, no synthetic project)
  degrades Values/Preview but keeps List/Nodes/Code intact.
