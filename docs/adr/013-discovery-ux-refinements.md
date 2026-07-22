# ADR-013: Discovery UX refinements — pane split, tabbed research kinds, reasoning stream, gas/tip context, foundry-assisted grounding

## Status

Accepted — 2026-07-22. Builds on **ADR-012** (persistent sessions, typed
autonomous bundles, context budgeting, research modes, value-pane enrichment)
and ADR-009 (agent-api Analyze/Incident panels). Scoped to the DiscoUI / agent
track (`apps/disco`, `apps/agent-api`); no explorer-track changes beyond reading
an endpoint the explorer already serves.

**Amended 2026-07-22 (pre-implementation):** gas/tip context targets the
**bundle-preparation** prompt as its **primary** surface (§7), with the
Discovery verdict base as secondary; the read-only `cast` tool is **in scope**
for implementation, not deferred to a prompt-only hint (§8).

## Context

ADR-012 landed the autonomous Discovery surfaces: one shared preparation pass
emits typed bundles, and per-kind persistent sessions produce verdicts with a
live context meter (`DiscoveryPanes.tsx`, `apps/agent-api/src/server.ts`). Using
it surfaced a batch of UX and grounding gaps, none of which change the ADR-012
model — they refine how it is presented and what the agent can see:

- **Top-bar noise.** The trace-workspace top bar shows the incident's extracted
  value (`TopBar.tsx` `useIncidentIdentity` → `fmtAmount(profit)`). The profit
  figure duplicates what the explorer and Values pane already show and adds a
  per-leg MEV fetch to the bar; it is not wanted there.
- **The Discovery pane and the stock preview artifact share one panel.**
  `PreviewPanel` renders `DiscoveryPanes` (the agent surfaces) **above** the
  stock permissions/contracts preview. Two unrelated concerns compete for one
  scroll region; the agent surfaces push the preview artifact off-screen.
- **The agent never sees incident economics.** The Discovery base prompt
  (`discoveryBase()`) carries bundles + structural trace tree + decoded swaps,
  but not the **gas fees** or **builder tip** (coinbase transfer) that determine
  whether and how a bundle paid — data the explorer already computes per tx
  (`miner_payments`: `gas_price`, `gas_used`, `base_fee_per_gas`,
  `coinbase_transfer`, exposed on `GET /api/mev/tx/:hash`).
- **Follow-up ergonomics.** The persistent-session follow-up uses a textarea +
  an explicit **[Ask]** button; the natural chat gesture (Enter to send,
  Shift+Enter for a newline) is missing.
- **Both research kinds are always stacked.** MEV Discovery and Vulnerability
  Discovery render one below the other with no way to collapse the one you are
  not reading.
- **Bundles are boxed and scrollable.** The bundle list is `max-h-32
  overflow-auto`; with more than a few bundles the selection set — the primary
  lever on context/cost — is hidden behind an inner scrollbar.
- **No reasoning, unbounded output.** Only the final assistant text streams
  (`text_delta`); the model's reasoning is discarded, and the verdict text grows
  the pane without bound instead of living in a fixed, scrollable region.
- **The agent cannot pull chain facts.** Discovery/prepare runs have only
  `get_function_code` (+ `flag_important_nodes`). ADR-012 §6 already assumes
  foundry `cast` + RPC access for value-pane enrichment; the Discovery agent is
  told to ground in supplied material but has no tool to fetch on-chain state it
  is missing, and is not told foundry exists.

## Decision

### 1. Drop the profit figure from the trace-workspace top bar

`useIncidentIdentity` keeps the **incident kind** (sandwich/arbitrage/… derived
from leg `viaType`) and the short tx hash as the identity, and **stops
rendering the extracted-value amount**. The per-leg `getTxMev` fan-out that
existed only to find a profit-bearing entry is removed from the bar. Value stays
where it belongs — the explorer timeline and the Values/Incident surfaces.

### 2. Split the Discovery pane from the preview artifact

`PreviewPanel` is split into two docking panels:

- **`preview`** (id unchanged, label stays **"Discovery"**) now renders **only**
  `DiscoveryPanes`. Keeping the id preserves ADR-009/012 storage stability and
  every persisted layout that references `preview`.
- a **new panel id** (`contracts`, label **"Preview"**, `IconWebApp`) renders
  the stock permissions/contracts preview artifact
  (`PermissionsPreview`/`ContractsPreview` + the "show only selected" option).

Both are independent docking leaves the user can place side by side. The default
layouts add the new panel so the artifact remains reachable without manual
docking.

### 3. Research kinds become hideable tabs inside the Discovery pane

Within `DiscoveryPanes`, MEV Discovery and Vulnerability Discovery render as a
**tab bar** (only the active-research kinds appear). Selecting a tab shows its
`DiscoveryKind`; **clicking the active tab collapses it** (content hidden), so a
user reading one kind can hide the other. Tab/collapse state is local UI state.
The shared preparation banner (preparing/error/warnings/context meter drivers)
stays above the tabs. When only one kind is active the tab bar still renders (one
tab) for a consistent collapse affordance.

### 4. Chat-style follow-up: Enter sends, Shift+Enter newlines

The follow-up **[Ask]** button is removed. The textarea submits the trimmed
question on **Enter**; **Shift+Enter** inserts a newline. Submit is suppressed
while a run is in flight or the input is empty (the prior `disabled` guards move
onto the keydown handler). Placeholder text advertises the gesture.

### 5. Bundle set is fully visible — never inner-scrolled

The bundle list drops `max-h-32 overflow-auto`; **all bundles for a kind render
without an inner scrollbar**. The pane's own scroll region (and, with §2, the
Discovery panel owning the whole leaf) absorbs overflow. The selection set — the
context/cost lever — is always seen at a glance.

### 6. Stream reasoning; render verdict in a fixed, scrollable window

- The pi harness emits `thinking_start` / `thinking_delta` / `thinking_end`
  around model reasoning. `runner.ts` subscribes to `thinking_delta` and emits a
  new **`reasoning`** run event alongside `delta`; agent-api forwards it over
  NDJSON and the client accumulates it separately from the verdict text.
  Discovery runs request a non-zero **thinking level** where the model supports
  it (clamped to model capability by the harness).
- The Discovery pane renders the **reasoning** (dim, collapsible) and the
  **verdict/turns** inside a **fixed-height, scrollable** output region, so a
  long verdict scrolls in place instead of growing the pane. Reasoning is
  **display-only** — it is not persisted into durable session turns (which stay
  verdict-only, ADR-012 §1) and not fed back as context.

### 7. Gas fees and builder tip enter the Discovery baseline prompt

- A client helper `buildGasContext(txHash)` reads the explorer's existing
  `GET /api/mev/tx/:hash` and formats the incident economics: **gas fee** (from
  `gasUsed`, `gasPriceWei`, `baseFeePerGasWei`) and **builder tip / coinbase
  transfer** (`coinbaseTransferWei`), per leg. It is fetched next to the existing
  `buildAutonomousContracts` / `buildTraceTreeContext` / `buildSwapContext`.
- **Primary target — the bundle-preparation ("baseline") prompt.** The prepare
  pass (`/api/agent/bundles/prepare` → `buildBundlePrompt`) is the "MEV Discovery
  Baseline" the user names; `buildGasContext` is sent on the `streamPrepareBundles`
  request and appended to each contract's bundle prompt as an **"Incident
  economics (gas & builder tip)"** section, so the model judges MEV-relevance
  (`notes`) against how the incident actually paid — priority fee vs.
  coinbase-transfer, net of gas.
- **Secondary — the Discovery verdict base.** `discoveryBase()` also appends the
  same section (sent on `streamDiscovery`) so a verdict/reassessment reasons
  about economics even when its bundles were cached from an earlier pass.
- **Caching caveat.** Bundles are keyed by `(codehash, kind)` and reused across
  incidents (ADR-012 §2). Economics is incident-level, so it informs bundle
  `notes` only on the **first** encounter of a codehash; later incidents reuse
  the cached bundle and rely on the secondary verdict-base section for their own
  economics. The stored bundle stays structural (role/entry points/flow/notes) —
  economics guides its content, it is not a separate persisted field. This is an
  accepted tradeoff of targeting the reusable prep prompt.
- Both sections are grounded evidence like the trace tree and swaps (ADR-006),
  count toward the context budget (token estimate), and are omitted cleanly when
  unavailable (e.g. a plain project route with no incident).

### 8. Foundry-assisted grounding for the Discovery agent

- The Discovery prompts (`DISCOVERY_PROMPTS` / system suffix) gain guidance to
  **use foundry `cast`** (and the configured RPC/Etherscan keys) to retrieve
  additional on-chain facts — storage slots, balances, `call` results, token
  metadata — when the supplied bundles/evidence are insufficient, rather than
  guessing or bailing. This mirrors ADR-012 §6's foundry-backed value-pane
  enrichment.
- To make the hint actionable, discovery/prepare runs are given a **bounded,
  read-only `cast` tool** (allowlisted read subcommands — `cast call`, `cast
  storage`, `cast balance`, `cast code`, `cast 4byte`, etc. — no state-changing
  `send`/broadcast), wired through the same runner tool surface as
  `get_function_code`. Grounding rules still hold: any fact the verdict asserts
  from `cast` must cite the query, and provenance is recorded. Absent an RPC/keys
  the tool degrades to unavailable and the agent falls back to supplied material.

## Consequences

- **Layout migration.** Splitting `preview` moves the stock artifact to a new
  leaf; persisted layouts keep working (they still resolve `preview` = Discovery)
  but existing users must add the new **Preview** panel unless the default
  layouts seed it. Storage keys are unchanged, so no bump is required — the new
  id simply becomes dockable.
- **Prompt/context growth.** Gas/tip context and (transient) reasoning add to
  what the model processes; the token estimate and live meter (ADR-012 §4) must
  account for the new base-prompt section so the budget stays honest.
- **Reasoning is ephemeral.** Streaming reasoning improves transparency but is
  display-only; it is not part of the durable transcript or the rehydration
  prompt, so restart-rehydrated sessions show verdicts without their prior
  reasoning. This keeps session state small and avoids feeding stale reasoning
  back as grounding.
- **`cast` widens the trust/latency surface.** A read-only, allowlisted `cast`
  tool lets the agent fill gaps but adds tool-call latency and a dependency on
  RPC availability/keys (`packages/config/.env`); it must be strictly read-only
  (no `send`/broadcast) and rate-bounded per run. This is the one item that adds
  agent capability rather than only reshaping the UI — the rest are presentation.
- **Grounding still holds.** Gas/tip facts derive from the explorer's decoded
  `miner_payments`; `cast` results are cited on use; reasoning is not treated as
  evidence. ADR-006 grounding and ADR-012's bundle/session model are unchanged.
- **No explorer-track changes.** §7 consumes an endpoint the explorer already
  serves; the explorer redesign (wp-explorer-v2) is untouched.
