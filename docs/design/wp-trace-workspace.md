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

#### T1 findings (2026-07-14, spike run — go, pending two verifications)

Knobs confirmed in `packages/discovery` (`config/StructureConfig.ts`,
`engine/shouldSkip.ts`): **`maxDepth: 0` + all trace addresses as
`initialAddresses`** is the bounded run. Initial addresses are analyzed at
depth 0; relatives are rejected in `shouldSkip()` *before any RPC work*
(`depth 1 > MAX (0)`), so nothing recursive happens. `maxAddresses` (default
100) is the backstop. Proxy resolution still runs per initial address (it
happens inside `AddressAnalyzer.analyze`, not via relatives).

Spike incident: sandwich at block 25531759, front-run
`0x74795f51…` / victim `0xe60e7c16…` / back-run `0x963b48ae…`; 10 unique
`to_address`es across all three legs' `classified_traces`. Hand-written
config: `l2beat/packages/config/src/projects/trace-74795f51/config.jsonc`
(untracked submodule file, same class as UI-created projects — never
commit). Run via the container shim:
`docker exec …disco-api-1 /tmp/bin/l2b discover trace-74795f51 --stats`
(`--stats` = provider call counts).

Measured (cold-ish; discovery cache already held 40–63% of
bytecode/source/deployment entries from earlier project runs):

- **Wall time 10.6 s** for 10 contracts, exit clean, `discovered.json`
  (40 kB) + `diffHistory.md` written.
- **Low-level RPC ≈ 54 requests** (CALL 16, GET_STORAGE 20, GET_BYTECODE 11,
  GET_TRANSACTION 6, GET_BLOCK 6, block-at-timestamp 1) — multicall batching
  collapsed 145 high-level CALLs into 16 (avg batch 9). GET_SOURCE ×6 is
  Etherscan, not the RPC node. Negligible load; no socket pressure.
- Naming works: PoolManager, UniversalRouter, UniswapV2Router02, 2×
  UniswapV2Pair, UniswapV3Pool, XENCrypto, WETH, USDT resolved; the one
  unnamed address (`0x1f2F10…`) is the unverified MEV bot contract.
- disco-api serves it: project listed in `GET /api/projects` (confirms T2's
  HomePage filter is needed), `GET /api/projects/trace-74795f51` returns a
  proper `ApiProjectResponse` with named initialContracts + fields.
- Benign error: UniswapV3Pool `observations` field → "Too many values" (array
  handler limit); does not block output.

Both open checks resolved (2026-07-15):

1. **Code works.** The 400 was a checksum typo in the hand-built URL —
   `ChainSpecificAddress` validates EIP-55 casing. With the address taken
   verbatim from the project response, `GET …/code/eth:0x7a250d…488D`
   returns the verified `UniswapV2Router02.sol` source (no `--save-sources`
   needed; fetched on demand / from cache). **Consequence for T3/T5:** when
   translating our lowercase trace addresses into panel selections, always
   map to the checksummed address the project API emitted (lowercase
   comparison), never construct `eth:0x…` by prefixing.
2. **Preview works** — the earlier "empty" reading probed the wrong JSON
   shape. Actual payload: `contractsPerChain` lists all 10 contracts with
   names; `permissionsPerChain` is `[]` because permission modeling is
   template/field-driven and DeFi routers/pools match no l2beat template.
   The incident dossier is therefore a named contract list plus
   upgradability for proxies; role/actor detail appears only when templates
   match. Caveat, not blocker — noted for ADR-008's Preview framing.

Verdict: **GO** — synthetic project, bounded run, naming, Code and Preview
all verified end-to-end; T2 can start.

### T2 — Synthetic project lifecycle (M)

Given a tx hash: resolve the incident (per-tx MEV facts → `counterpartTxHash`
/ `victimTxHashes`), collect the unique contract addresses across all legs'
traces, create/refresh the `trace-<hash8>` project (config from T1), run
discovery, and report status. Placement: a small orchestration endpoint in
`trace-api` (it already talks to the trace + MEV surfaces) that drives
disco-api's existing project/terminal endpoints; the frontend polls status.
Exclude `trace-*` from the home page project list (`DIVERGENCE(mev)` filter
in `HomePage.tsx`).

#### T2 findings (2026-07-15, implemented and verified)

Implemented as designed, with three notable deltas:

- **Canonical project naming**: `trace-<hash8>` uses the *lexicographically
  smallest* leg hash, not the deep-linked one, so front-run, victim and
  back-run links resolve to one shared project. To make a victim's page
  resolvable at all, explorer-api's `sandwiched_victim` entry now also
  carries `frontrunTxHash` / `backrunTxHash` / `victimTxHashes`.
- **disco-api's terminal endpoint requires `devMode=true|false`** as an
  explicit query param (`discoverQuerySchema`, `main.ts:67`).
- **Full-history `eth_getLogs` scans had to be bounded**
  (`scripts/bound-getlogs.cjs`, preloaded via NODE_OPTIONS like the socket
  limiter). Proxy detection reconstructs upgrade history by scanning logs
  from deployment to head (`pastUpgrades.ts`, `Eip2535Proxy`); the node has
  no log index — a single idle 100k-block chunk measured 11.4s, so USDC's
  ~19M-block history alone would need ~35 min and times out entirely under
  discovery's parallelism. The preload clamps every `eth_getLogs` to the
  last `RPC_GETLOGS_MAX_BLOCKS` (default 1M) blocks. Consequence:
  `$pastUpgrades`/`$upgradeCount` only cover that window; implementation +
  admin resolution are storage reads and stay accurate (verified: USDC →
  "USD Coin Token", `ZeppelinOS proxy`). With the bound, the 18-address
  sandwich workspace (block 25531725, 3 legs) discovers in **~50 s**;
  repeats serve from disk.
- Verified end-to-end: `GET /api/traces/:txHash/workspace` →
  discovering→ready; victim hash resolves the same project without a second
  run; `trace-*` hidden from the home page while still served by the API.

**Known weakness (orphaned runs)**: disco-api's `executeTerminalCommand`
spawns `l2b discover` via a shell and `proc.kill()` on SSE close kills only
the shell — an aborted/timed-out run leaves the discovery child running and
holding RPC sockets (observed 2026-07-15: two orphans saturated the node's
connection cap; symptom per [rpc-node-connection-cap] memory). Remedy:
`docker compose restart disco-api`. T7's Kill button inherits this; consider
a kill-by-project helper when building T7.

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

#### T3 findings (2026-07-15, implemented and verified)

The nested-route option won: `/ui/trace/:txHash` resolves the workspace
(react-query poll; full-screen graph + status ribbon while discovering,
retry on error) and redirects to **`/ui/trace/:txHash/:project`** — the
`:project` param is what lets every stock project-scoped panel run
byte-identical via `useParams()`. Second docking store
(`docking/v2:trace`, default `list | trace | values`) resolved through a
`DockingStoreProvider` context (default = discovery store), so MultiView /
TopBar / BottomBar are reused with three marked one-line swaps rather than
duplicated. The docked `trace` panel picks the deep-linked hash off the
route (`TraceRoutePanel`).

Deltas vs the plan: the panel *switcher* keeps the full catalog (all
panels are project-scoped and work against synthetic projects — terminal
shows the discovery output, config edits the generated config; restricting
would add divergence for no gain); only the default layout is
trace-specific. The stock TopBar's Discover/Kill already drive
`l2b discover <project>` — correct for synthetic projects as-is, so the
trace TopBar variant (T7) is cosmetic (incident identity), not functional.
Verified in-browser: fresh incident → ribbon ("discovering 22 contracts")
→ auto-redirect → workspace with List/graph/Values live; e2e 25/25.

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
