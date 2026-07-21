# ADR-011: Explorer v2 — exhaustive coverage model, value timeline, unified RPC provider

## Status

Accepted — 2026-07-20

## Context

The MEV Block Explorer today inspects blocks **on demand** (the viewed block,
plus a manual left-drag backfill and an optional head-follower), and its
timeline (ADR wp-explorer-redesign, E7) is a *coverage* widget: a bounded
window whose track fills green as blocks get analyzed, driven by a manual
**analysis slider** and a **backfill button**. Three problems motivate a
revision:

- **Coverage is treated as optional.** The green/white track and the backfill
  slider frame inspection as something the user triggers per session. The
  research goal is the opposite: a **complete, immutable corpus** of inspected
  blocks from a fixed genesis of interest (Ethereum block **11,000,000**,
  ~Oct 2020 — the first block from which the ported detectors and the DEX/token
  registries are meaningful) up to the head. Once that corpus exists, a
  per-session "backfill from here" control is noise.
- **The timeline shows coverage, not signal.** Whether a block is analyzed is
  an operational fact; what a researcher wants on a time axis is **how much
  value was extracted, by MEV type, over time**. The data already exists in
  `arbitrages` / `sandwiches` / `liquidations` (+ the `mev_*` detector tables).
- **Classified state does not survive a reload for the *viewer*.** The facts
  are persisted in Postgres (ADR-010), but the explorer front-end rebuilds its
  view from whatever block is loaded; a user who classified many blocks in a
  session sees an empty list after reload. Persistence exists in the DB; the
  UI must hydrate from it.

Separately, the inspection subsystem grew **one `ethers.JsonRpcProvider` per
module** (`inspector`, `inspectorLoop`, `mempoolWatcher`, `builder`, `tokens`,
`server`), each opening its own connections against a single upstream node that
enforces a **server-side connection cap** (see memory `rpc-node-connection-cap`;
`tokens.ts` carries an explicit dedupe workaround). This is what the TODO calls
"connection sharding". It is not sharding across endpoints — it is uncoordinated
fan-out against one endpoint, and it is the recurring cause of "Too many
connections" degradation.

## Decision

### 1. Exhaustive coverage is the default, from a fixed floor

- The canonical corpus is **[11,000,000 … head]**. explorer-api runs a
  **continuous, resumable inspection worker** that walks this range and keeps
  it filled, replacing the user-triggered backfill as the primary driver. It
  reuses the existing serial `inspectBlockIfNeeded` dedupe + `INSPECT_TIMEOUT_MS`
  bound + skip-on-error/cooldown from `backfill.ts` (ADR-010) — the mechanism
  is unchanged; what changes is that its **range is fixed and its lifecycle is
  the service's, not a request's**. Coverage remains derived from the Postgres
  `blocks` table, so it survives restarts (unchanged from E6).
- The manual **analysis slider and backfill button are removed** from the UI.
  `POST /api/backfill` may remain as an internal/ops control (seed a gap,
  re-inspect a range) but is no longer part of the primary user flow.
- The head-follower (`INSPECTOR_FOLLOW_HEAD`) keeps the top of the range warm
  as before; the worker fills the tail. The two must not race — a single
  process-wide serial queue owns all inspection (see decision 3).

### 2. The timeline is a value-over-time line graph

- The bounded coverage track becomes a **multi-series line/area graph** over
  the block-time axis (from 11,000,000), with **three color-coded series —
  arbitrage, sandwich, liquidation — each plotting the value extracted** in a
  time/block bucket. Backed by a new bucketed aggregate endpoint over the
  existing MEV-fact tables (extend `/api/mev-activity` from counts to
  value-per-type, or add `/api/mev-value?from&to&bucket`).
- The **100-block interval selector is retained but rendered only as a slider**
  over this graph (its number-y affordances go away); it still scopes the
  ticker/table to a 100-block window and auto-focuses the interval's
  highest-value block.
- Because coverage is now assumed exhaustive, the green/white "analyzed"
  overlay is demoted to a subtle "not-yet-inspected" indicator (gaps only),
  not a primary channel.

### 3. One shared RPC provider

- All modules take a **single shared `JsonRpcProvider`** from a new
  `@mev/rpc` (or an exported singleton in `@mev/config`/explorer-api), created
  once. Per-module `new ethers.JsonRpcProvider(config.RPC_URL)` instances are
  removed. This is the concrete answer to TODO item 10 ("remove the connection
  sharding if possible"): the split is not load-bearing — it is accidental —
  so it is consolidated.
- Inspection stays **strictly serial process-wide** (ADR-010 rationale
  unchanged: never stampede the capped node). The shared provider makes the
  concurrency bound real rather than per-module. The `tokens.ts` connection
  dedupe can then be simplified to ordinary request coalescing on the shared
  provider.
- If investigation shows a specific module genuinely needs an isolated
  connection budget (e.g. the mempool watcher's long-poll must not be starved
  by inspection), that exception is documented here as an amendment rather than
  left implicit.

### 4. Viewer hydrates from Postgres

- On load (and on interval change) the explorer front-end **hydrates the
  transaction/MEV list from persisted facts** for the focused block(s) via the
  existing read endpoints, so a reload restores everything already classified
  rather than showing an empty view. No new storage — this is a front-end
  hydration + a read-path guarantee that every classified fact the UI shows has
  a durable source.

## Consequences

- **Scale.** [11,000,000 … head] is ~15M blocks. At the serial, node-friendly
  rate (ADR-010: ≈1 block / (trace_block RTT + 250 ms)) full coverage is a
  long-running, possibly multi-week fill — an **ops reality, not a session
  action**. The worker must be observable (progress, cursor, failure list) and
  idempotent; the WP treats "exhaustive" as a direction the system trends
  toward, not a precondition for the UI to work. The UI must degrade gracefully
  over partially-filled ranges (gaps shown, not errors).
- Removing the backfill slider drops a user affordance that was also the E7
  acceptance surface; wp-explorer-redesign's E7 acceptance is **superseded**
  here.
- A single shared provider centralizes the failure domain: if it degrades,
  everything degrades together — but that is already effectively true against
  one capped node, and it makes the concurrency bound enforceable and the
  degradation observable in one place.
- Value-over-time requires a defensible **value metric per MEV type**
  (extracted value / victim loss / profit). This ADR fixes the *shape* (three
  series, value on Y); the WP must pin the exact metric per type (arbitrage
  profit, sandwich profit, liquidation seized-collateral premium) and its
  currency handling (ties into the ETH/xhi display work, WP item 4).
- ADR-010's inspection mechanism is reused unchanged; this ADR only changes
  **what drives it (a fixed-range worker) and how coverage is presented (value,
  not green fill)**.
