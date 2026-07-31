# consolidate.md — working draft notes for
# "Understanding MEV-related Transactions with LLMs"

**Status:** consolidation draft, 2026-07-31.
**Sources merged:** Philip's agenda/notes, team notes from the mandatory meetings, and the
current state of the implementation repo (`RFC-Understanding-MEV-via-LLMs`, snapshot of the
zip provided — working tree dated 2026-07-23, latest ADRs 016/017/018).

**How to use this document.** It is written as continuous narrative so paragraphs can move
straight into the report draft rather than being re-written from bullet points. Each section
carries the argument, the facts extracted from the repo, and the gaps.

**Flag legend**

| Flag | Meaning |
|---|---|
| `TODO` | genuinely missing — needs a teammate, an experiment, or a figure |
| `TODO(cite)` | claim is fine but needs a literature reference before it can be written down |
| `⚠ CORRECTION` | the skeleton says something the repo contradicts — fix before writing |
| `↯ VERIFY` | plausible but not confirmed from the repo alone; someone must check the live stack |

---

## 0. Corrections against the skeleton (read this first)

Five things in the skeleton do not survive contact with the repo. They are cheap to fix now
and expensive to fix after the text is written.

**⚠ CORRECTION 1 — decompilation is *not* parallel to the trace tree.** The skeleton says the
trace tree is built and "in parallel try to decompile smart contract code". The implemented
design is the opposite, deliberately: decompilation is a **lazy, last-resort evidence tier**.
ADR-016 §2 states plainly that decompilation is not triggered while opening a Discovery pane;
it is requested only *after a verified-source miss*, and only for a contract the agent has
actually decided to analyse. The rejected alternative "eagerly decompile every unverified
contract" is recorded in that ADR's *Alternatives considered* with the reason: decompilation is
slow, fallible, and unnecessary for candidates the parent never consults. Writing "in parallel"
would describe a system we explicitly chose not to build, and would also make our latency
numbers look inexplicable.

**⚠ CORRECTION 2 — there is no single LLM "refinement" pass over one big bundle.** The skeleton
describes intermediate data "refined by an LLM to distill & structure the most critical
elements" and then a "final comprehensive data bundle" handed to the LLM. The implementation
splits this in two, and the split is one of the more defensible design decisions we have:
distillation happens **per contract, in ephemeral child sessions**, each producing a
schema-validated, **codehash-addressed reusable bundle**; the final analysis happens in **one
persistent parent context** that consumes those bundles. Child transcripts and child reasoning
never enter the parent context (ADR-016 §3). "One big bundle" was the earlier design and it
failed concretely — it produced HTTP `Request Entity Too Large` and one context responsible for
every contract (ADR-016, Context table + Alternatives).

**⚠ CORRECTION 3 — the instruction-supply story in 3.3 is wrong in the skeleton** (and
`AGNTS.md` is a typo). There are two different `AGENTS.md` files with two different audiences,
and neither is the main channel by which the *analysis* agent gets its task. See §3.3 for the
actual resolution order. Short version: the analysis agent's system prompt comes from
`.pi/SYSTEM.md` or, for Discovery runs, from a **server-selected, versioned profile** in
`apps/agent-api/src/discoveryPrompt.ts`; task instructions come from per-skill task strings in
`apps/agent-api/src/tasks.ts`; the repo-root `AGENTS.md` is guidance for coding agents doing
*development on the repo* and has nothing to do with a run.

**⚠ CORRECTION 4 — the sentence about the endpoint and the harness comparison is broken.** The
skeleton reads: "We use the OpenAI-compatible inference endpoint provided by our university, and
leads the current harness comparison on agentic coding benchmarks \cite{artificialanalysis...}".
The subject of "leads" is missing — presumably *pi*, the harness. Also: the repo's pi settings
(`.pi/settings.json`) name provider `scc_kitoolbox` and model `kit.qwen3.5-397b-A17b`, which is
consistent with the skeleton's Qwen3.5 397B A17B, but the *reason* given for choosing pi needs
a real citation and a date, because leaderboard positions age badly. `TODO(cite)`

**⚠ CORRECTION 5 — the framework is not only an LLM pipeline; there is a deterministic engine
underneath it, and the report currently hides it.** `@mev/inspect` is a native TypeScript port
of Flashbots' `mev-inspect-py` plus five additional detectors (~4.5k LOC). It is what turns a
transaction hash into an *incident* in the first place, and it is also the obvious source of
the "automatically labeled examples" the Research Goals promise. Leaving it out of §3 makes §3.5
impossible to explain. Proposed fix: a new **§3.2 "Deterministic detection layer"** ahead of the
architecture section (numbering suggestion in §3 below).

---

## 1. Abstract

`TODO` — written last, once §3.5 and §4 exist.

When it is written it has to carry, in roughly this order: (i) the opacity problem — public
ledger, unreadable execution; (ii) the observation that a bare LLM query on a transaction hash
fails for a *structural* reason (no execution context), not a capability reason; (iii) our
answer — an agentic harness grounded in a shared, snapshot-addressed evidence plane, with lazy
per-contract distillation and a single-context verdict; (iv) what the framework emits
(classification / evidence / explanation); (v) the headline evaluation result. Point (v) does
not exist yet — the abstract cannot be drafted before §4.

---

## 2. Introduction

Ethereum is a public ledger, and the naive reading of that is that everything on it is legible.
Every transaction, every balance change, every contract deployment is there to be read by
anyone. In practice legibility and availability are very different things. A transaction hash
resolves to a receipt, but a receipt does not explain what happened; it certifies that
*something* happened and how much gas it cost. The interesting question — what value moved,
from whom, to whom, and by what mechanism — lives in the execution, and the execution is not
stored in a form a human reads.

This is sharpest exactly where it matters most. MEV-related transactions are, almost by
construction, the ones whose economics are hidden inside their execution. A single transaction
hash in this class rarely corresponds to a simple token transfer. It typically expands into
dozens of internal calls, delegatecalls into proxy implementations, callbacks from pools back
into searcher contracts, flash-loan hooks, and a fan-out of `Transfer`/`Swap` logs whose net
effect only becomes visible after all of them are netted against each other. And a large part of
the relevant code is not verified on any block explorer: the searcher contracts, the very ones
whose behaviour we most want to explain, are frequently unverified bytecode by design.

The modern instinct, when confronted with data one does not understand, is to hand it to a
language model. That instinct is right about the *kind* of tool and wrong about the *interface*.
Querying a model with a raw transaction hash fails, and it fails in an informative way. Asked to
classify a hash, a current frontier model responds along these lines:

> "I wasn't able to classify it myself, and I want to be upfront about why rather than guess:
> from this environment I can't reach Ethereum RPC nodes or block explorers [...] So I have no
> way to pull the trace, logs, or block context for that hash directly."

`TODO` — reproduce this quote verbatim from the original log and add a footnote with model
name, interface, and date, so it is a citable observation rather than an anecdote. Consider
running the same probe against two or three models so the point is not about one vendor.

The failure is not a reasoning failure. The model is not confused about what arbitrage is; it
is flying blind, because a 32-byte hash carries no execution context whatsoever. A hash is a
pointer into state the model cannot dereference. Everything a competent human analyst would do
next — pull the trace, decode the calls, resolve the contracts, net the transfers, check the
block position, look at what the searcher's contract actually does — is *tool use over
infrastructure*, not inference. This observation is the design premise of the framework: the
scarce resource is not model capability, it is **grounded, structured, verifiable context**.

That leads to the research question:

> **Can agentic LLMs, augmented with on-chain data, improve detection and analysis of
> MEV-related transactions on Ethereum, and make MEV research more efficient and approachable?**

Two words in that question carry weight and should be defended explicitly in the text.
*Agentic* means the model is not handed a fixed prompt but is given a bounded tool surface and
decides, within that surface, what evidence to pull — which is exactly what the failure above
shows is missing. *Approachable* is the second, softer claim: a deterministic MEV detector tells
you *that* a transaction is a sandwich; it does not tell you *how* it worked in terms a
researcher can check, and it cannot answer a follow-up question. Making that difference concrete
is part of what §4 has to show.

The framework answers the question by producing, for a given transaction or multi-transaction
incident, three structured outputs:

1. **Classification** — the MEV category, a confidence grade, and the protocols involved.
2. **Evidence** — the trace fragments, event logs, token flows, and state reads on which the
   decision rests, each tied back to a concrete on-chain artifact.
3. **Explanation** — a human-readable account of who gained value and by what mechanism.

The third output is the one no existing tool in this space produces, and the first two exist
precisely so that the third can be audited rather than trusted.

**Research goals.** Two, deliberately separated:

- **Evaluation** — comparison against a small set of manually reviewed examples. This measures
  whether the *explanation* is correct and useful, which is not something an automatic label can
  tell us.
- **Benchmark** — comparison against automatically labelled examples. This measures
  classification agreement at a scale a human cannot review. The repo already contains the
  labeller (§3.2), which makes this tractable — with one large caveat about label quality
  developed in §3.5.

**Contributions.** `TODO` — write the contributions paragraph last, but the shape is already
determined by the implementation: (a) a snapshot-addressed evidence plane that lets several
consumers share one replay of a transaction instead of each re-fetching it; (b) a lazy,
codehash-addressed contract-distillation scheme that makes repeated analysis of common protocols
free after first encounter; (c) an unverified-code path (sandboxed Panoramix decompilation) that
extends agentic analysis to exactly the contracts that matter most in MEV; (d) an integrated
human-in-the-loop surface where the agent's claims are checkable against the same graph the
agent reasoned over.

**Related work.** `TODO` — currently absent from the skeleton and it cannot stay absent. At
minimum: Daian et al. on MEV/priority-gas auctions; Qin/Zhou/Gervais on quantifying extractable
value; Flashbots' `mev-inspect-py` as the reference detector we port; Zhou et al. / `zeromev`
and EigenPhi as production labelling systems; and the LLM-agent-for-security literature
(auditing agents, tool-augmented code analysis) for the agentic side. Whoever takes this should
also state clearly that we are aware of no prior work applying an agentic harness with a shared
on-chain evidence plane to MEV explanation — and check that claim properly rather than assert it.

---

## 3. Setup

**Proposed renumbering** (see ⚠ CORRECTION 5). The skeleton's five subsections become seven;
the mapping is: 3.1 → 3.1, *new* 3.2, 3.2 → 3.3, 3.3 → 3.4, 3.4 → 3.5, 3.5 → 3.6, *new* 3.7.

| § | Title | Skeleton |
|---|---|---|
| 3.1 | Pipeline of analysing transaction hashes | 3.1 |
| 3.2 | Deterministic detection layer (`@mev/inspect`) | *new* |
| 3.3 | Framework architecture | 3.2 |
| 3.4 | Agent and harness | 3.3 |
| 3.5 | DiscoUI — the human-in-the-loop surface | 3.4 |
| 3.6 | Benchmark design | 3.5 |
| 3.7 | Measured behaviour so far | *new* |

### 3.1 Pipeline of analysing transaction hashes

The pipeline turns a 32-byte hash into a grounded verdict. It is best described as six stages,
and the two properties worth emphasising in the text are that **no stage re-derives what an
earlier stage already produced**, and that **the model is invoked as late and as narrowly as
possible**.

**Stage 0 — from hash to incident.** A transaction hash alone is the wrong unit of analysis. A
sandwich is three or more transactions; a liquidation race is several competing attempts of
which the losers revert. Before anything else, the block containing the transaction is inspected
by the deterministic engine described in §3.2: block traces are fetched via `trace_block`,
decoded, classified, pattern-matched, and persisted to Postgres, along with the five extra
detectors' output. The result is an *incident*: the set of transactions that belong together,
with their roles (front-run, victim, back-run) already assigned. Inspection is on-demand and
in-process — the first request for a block triggers it and results persist, so it is paid once
(ADR-010).

**Stage 1 — workspace preparation.** `trace-api` resolves the hash to all legs of its incident
and runs **one bounded discovery pass** into a synthetic, disposable project named
`trace-<first 8 hex of the canonical hash>`. Bounded means: `maxDepth: 0`, `initialAddresses` =
the addresses appearing in the incident's traces, so there is no recursive reference-following;
the run is serialised process-wide because the underlying discovery cache is SQLite. Discovery
is invoked **at the incident's snapshot** — the runner derives the block timestamp and passes
l2b's `--timestamp` option, and records requested block number/hash alongside the resolved
timestamp so a snapshot mismatch is visible rather than silently analysed at `latest`
(ADR-016 §1). Its output is an ordinary `discovered.json` with contract names, fields, proxy
relationships and permission metadata — which is why the stock UI panels work against it
unmodified (§3.5). Because addresses repeat massively across incidents (routers, pools, WETH),
the per-address discovery cache makes repeat cost near zero after the first few incidents.

**Stage 2 — the evidence plane.** Everything downstream reads from one normalised evidence
plane in the shared Postgres, owned schema-wise by `@mev/db`, typed by `packages/evidence`, and
exposed over HTTP by `trace-api`. The defining property is that **every immutable lookup is
keyed by chain and snapshot, never by address alone** (ADR-016 §1):

| Artifact | Key |
|---|---|
| execution | `(chainId, blockHash, transactionHash, traceSchemaVersion)` |
| deployment | `(chainId, address, blockNumber, runtimeCodehash)` |
| source | `(runtimeCodehash, sourceProvider, sourceRevision)` + address mapping for proxy metadata |
| token metadata | `(chainId, tokenAddress, runtimeCodehash)` |
| decompilation | `(runtimeCodehash, engine, engineRevision, optionsHash)` |

This is what prevents the class of error where the same address is analysed at two different
block tags and quietly yields two different answers — an upgradeable proxy makes that a real
hazard, not a hypothetical one. Negative results are first-class: an unverified-source miss is
stored *as evidence*, with `retryAfter`, attempt count, provider and error class, so it is
durable across restarts instead of being re-attempted by every consumer.

**Stage 3 — the graph.** `trace-api` publishes a versioned `TraceGraph v2` built **from the
persisted inspector trace and receipt evidence first**. `debug_traceTransaction` is allowed only
when the normalised execution artifact is missing or corrupt, or when a user explicitly asks for
a raw-detail view; a fallback result is itself normalised and persisted so a restart does not
replay it. The graph carries typed calls, native value, token transfers and decoded swaps, plus
semantic **flow edges** (control and funds) computed server-side rather than in the browser —
on a real incident the graph payload was measured returning 75 flow edges, 59 control/observed
and 16 funds/committed (ADR-017 §5). An in-flight promise map keyed by chain, transaction hash
and tracer configuration means a cold graph request and a workspace preparation share one
replay instead of racing into two.

**Stage 4 — the candidate catalog (no model involved).** Opening Discovery performs only a
compact catalog and cache lookup. For each contract participating in the incident the catalog
records an opaque candidate id, the address, the snapshot codehash, the proxy/implementation
relationship, a trace-relevance hint, and the **evidence status** — `verified`, `decompiled`,
`opaque`, `unverified`, `error`, `unresolved`. Nothing here costs a model turn, which is the
point: ADR-016 §3 replaced an earlier eager scheme that spent one model turn per unknown
contract before the model had decided which contracts mattered.

**Stage 5 — lazy distillation into typed bundles.** This is the stage the skeleton called
"refinement", and it is per-contract rather than global. The parent session is given a
server-defined tool, `request_contract_analysis(candidateId)`, whose *only* model-controlled
argument is an id from the user-selected catalog — it cannot pass an address, a kind, free-form
focus text, or arbitrary code. One invocation runs a fixed server-owned path: validate the
candidate against the allowlist, quota and cancellation state; return a current cached bundle
immediately if one exists; otherwise resolve evidence server-side (coalescing identical work);
run **one ephemeral child session**; strictly validate and persist the typed bundle with
provenance; and return only the compact bundle or a typed status to the parent.

The evidence the child receives follows a strict preference ladder (ADR-016 §2):

1. verified source matching the runtime deployment;
2. a cached Panoramix artifact;
3. a newly requested Panoramix decompilation;
4. an explicit opaque-bytecode fallback.

Decompilation runs in `apps/decompiler-api`, a sidecar reachable **only** as
`agent-api → trace-api → decompiler-api` over a Unix socket owned by trace-api. It receives raw
runtime bytecode, never an address. Its container gets no RPC URL, no Etherscan key, no pi agent
directory, no model credentials and **no outbound network**, and runs read-only-rootfs with
dropped capabilities, bounded CPU/memory/PIDs, a tmpfs scratch dir, a hard process-group timeout
and input/output size limits. Panoramix is pinned to reviewed revision
`23edd11058abafcba9340afc768d2aa9274c0b62`, with commit, tree, source-archive, dependency-lock
and MIT-licence hashes verified at image build. Results are classified `complete`, `partial`,
`timeout`, `unsupported` or `error` — partial and failed results stay visible rather than being
silently upgraded. Decompiled text is treated as **untrusted data**: ANSI and control characters
are stripped, output is size-bounded and delimited, and the agent is instructed never to follow
instructions embedded in source or decompiled text. There is deliberately **no second LLM pass
rewriting pseudocode as Solidity**, because that would erase provenance and add a hallucination
layer (ADR-016 §2, Alternatives).

The child's product is a **typed, versioned bundle** keyed by `(codehash, kind)`, validated
against a Zod schema (`apps/agent-api/src/bundles.ts`). MEV bundles carry role, entry points,
mechanism, ordering constraints, value flows, risks, evidence and unknowns; vulnerability
bundles carry role, source quality, artifact provenance, assets at risk, trust boundaries, an
attack-surface list, invariants, graded bug hypotheses (`confirmed` / `likely` / `speculative`,
each with prerequisites, exploit path, impact, evidence and counter-evidence) and unknowns. Two
consequences are worth stating in the report: keying by codehash rather than address means the
hundredth Uniswap V2 pair costs nothing, and **incident-specific facts are deliberately excluded
from bundles** — read-only snapshot observations are held in the parent's session under the
incident block hash, never baked into a reusable codehash-addressed artifact. Recursion depth is
exactly one: reusable children get bounded function lookup but no `cast`, no RPC, no snapshot
state and no `request_contract_analysis` of their own.

**Stage 6 — the verdict.** The parent computes the final answer in **one persistent context**.
There is no verdict-of-verdicts hierarchy — an explicit rejected alternative, on the grounds
that the final answer must remain in one user-visible context. Before launching any child, the
tool reserves the maximum compact result against the parent's remaining context budget and
returns a typed `budget_exhausted` status rather than silently compacting child findings away.
The user can deselect any cached bundle or unresolved candidate before starting; deselection
removes both its context contribution *and* the parent's authority to analyse it. A follow-up
chat runs against the same session.

`TODO(figure) — FIGURE 1.` The skeleton's placeholder. Specification, so whoever draws it draws
the right thing: a left-to-right flow with **hash → incident (Stage 0, deterministic) → bounded
discovery + evidence plane (Stages 1–2) → TraceGraph v2 (Stage 3) → catalog (Stage 4, *no model*)
→ N lazy child analyses producing codehash-keyed bundles (Stage 5) → single-context verdict
(Stage 6)**. Two things must be visually obvious or the figure is not doing its job: the
**cache boundary** (which artifacts are reused across incidents — bundles and source/decompilation
are keyed by codehash, execution and flow evidence by snapshot) and the **model boundary**
(exactly which two stages invoke an LLM). Show the evidence ladder as a small inset. Owner: `TODO`.

### 3.2 Deterministic detection layer (`@mev/inspect`)

*New section — see ⚠ CORRECTION 5. It is short, but §3.6 is unwritable without it.*

Underneath the agentic layer sits a conventional MEV detector, and the report should own that
rather than hide it. `@mev/inspect` (~4.5k LOC TypeScript) is a native port of Flashbots'
`mev-inspect-py`, with the Python runtime retired as a dependency (ADR-010). Its organising
principle, inherited from the reference implementation, is **decode, then pattern-match**: raw
block traces are decoded into structured facts (classified traces, transfers, swaps,
liquidations, NFT trades, miner payments) via a pluggable classifier-spec registry, and the
pattern-matchers for arbitrage, sandwiches and liquidations run over those facts rather than
over raw calldata.

Protocol coverage as ported: Uniswap V2/V3, Sushiswap, Balancer V1, Curve, Aave V1/V2, Compound
V2, Cream, 0x (v3/v4), Bancor V1, WETH, ERC-20, OpenSea (Wyvern). The classifier specs inherited
from upstream are 2021-era, so the port adds Uniswap V4 (singleton `PoolManager` + hooks + flash
accounting, best-effort extraction via net transfer deltas), Aave V3, Compound V3 (Comet),
Balancer V2 and the 0x v4 settler. CryptoPunks classification and its three tables were dropped
as dead weight.

On top of the ported pipeline the platform adds five detectors covering gaps flagged in the MEV
literature, all running in the same pipeline over the same in-memory facts: **JIT liquidity**
(a Uniswap V3 position minted and removed within one block around a swap), **non-atomic
arbitrage** (a round trip split across two transactions from the same sender), **liquidation
sandwich** (the liquidator's own swap pushing a position underwater first), **liquidation race**
(competing attempts on the same borrower, losers revert), and **NFT flip** (same NFT bought and
resold at a profit within one block). `TODO(cite)` — each of the five needs its literature
anchor; the write-up in the reference implementation's README has them.

Two facts about this layer matter for the benchmark and must be stated honestly there rather
than buried: **first**, the port fixed real bugs in the reference implementation, documented in
`docs/design/mev-inspect-audit.md` — a division-by-zero that aborted arbitrage extraction for a
whole transaction (B1), an asymmetric start/end pool check that over-counted arbitrages (B2), a
stale three-address router exclusion list that produced sandwich false positives on modern order
flow routed through the Universal Router, 1inch, 0x Settler or CoW (B3), an ordering
inconsistency between `transaction_index` and `transaction_position` (B4), a non-portable
receipts fetch (B5), and a failure mode where a *failed* inspection was treated as success (B6).
**Second**, a known residual divergence: ethers' `decodeFunctionData` is more lenient than
Python's `eth_abi`, so a selector collision that upstream rejects as `unknown` is decoded here —
observed on block 25538163, where a Uniswap **V4** interaction whose selector collides with the
V3 swap selector yielded one extra swap and a few extra arbitrage candidates. Parity on
classified traces, transfers and miner payments is exact.

The honest summary: this layer is a good automatic labeller and a poor gold standard. §3.6
depends on that distinction.

### 3.3 Framework architecture

*(skeleton §3.2 — was TODO; filled from the repo)*

The platform is a pnpm-workspace/Turborepo monorepo, TypeScript throughout, Biome for
lint/format, Express for APIs, Vite + React for frontends, with **one shared Postgres instance**
and **one unified root `.env`** as binding global requirements. Everything builds and runs under
`docker compose`; nine services come up together. Roughly 62k lines of TypeScript across apps
and packages, of which the DiscoUI clone is by far the largest single share (~36k) — a number
worth quoting because it explains why cloning rather than rebuilding was the right call (§3.5).

**Services.**

| Service | Port | Responsibility |
|---|---|---|
| `postgres` | 5432 | the one shared database; external volume so `compose down -v` cannot erase inspected blocks |
| `explorer-api` | 3000 | MEV explorer API; runs `@mev/inspect` in-process; owns app-owned tables incl. `flagged_transactions` |
| `explorer-web` | 8080 | explorer frontend: block/address/flagged views, value-over-time timeline |
| `trace-api` | 2022 | evidence gateway: execution artifacts, `TraceGraph v2`, contract sources/meta, catalog, workspace prep |
| `decompiler-api` | (unix socket) | sandboxed Panoramix worker; bytecode in, pseudocode out; no network |
| `agent-api` | 3100 | pi harness sessions, skills, bundles, Discovery runs, verdict + chat; NDJSON streaming |
| `disco-api` | 2021 | `l2b ui` built from the pinned l2beat submodule; discovery semantics and source production |
| `disco-web` | 8082 | the DiscoUI clone; nginx also routes `/api/traces`, `/api/contracts`, `/api/mev`, `/api/flagged`, `/api/agent` |
| `pgadmin` | 5050 | operational convenience |

The stack uses **host networking** so that a host-local RPC endpoint (typically an SSH tunnel to
the node) stays reachable without being exposed on a Docker bridge. Compose deliberately does
**not** start an Ethereum node: an external archive node with `trace_block` *and*
`debug_traceTransaction` is a hard prerequisite — reth or Erigon; plain geth is insufficient.

**Two invariants carried through the whole system.** *Decode, then pattern-match* (§3.2), and
*on-demand, in-process inspection* — there is no separate indexer service; the first request for
a block triggers `inspectBlock()`, deduplicated per block number, and results persist. Bulk
coverage is exhaustive from a fixed floor (`INSPECT_FLOOR_BLOCK`, default 11,000,000) walked
ascending to the head by a continuous fill worker that shares **one process-wide serial queue**
with the head-follower, so background inspection never doubles up on a connection-capped node
while interactive views never queue behind it (ADR-011). Coverage is derived from Postgres, not
client state, so it survives restarts.

**The evidence plane** (§3.1, Stage 2) is the architectural centre of gravity and the newest
part. Before ADR-016 the same transaction could be replayed twice — once by `@mev/inspect` via
`trace_block`, once by `trace-api` via `debug_traceTransaction` — and the same address could be
codehash-resolved at different block tags by different services. The plane collapses that:
`@mev/db` owns the schema plus an **append-only migration ledger** (each migration runs in a
transaction under one fixed advisory lock and records version and checksum only on success; all
service boot paths call the same migrator instead of racing independent
`CREATE IF NOT EXISTS` statements), `packages/evidence` owns the stable Zod-validated types, and
`trace-api` is the sole HTTP gateway. Consumers do not read l2b's SQLite cache or another
service's generated files. l2b remains the *source producer*: after it atomically finishes a
run, trace-api performs a **controlled import** of `discovered.json` and `.flat` output,
validating project-root paths, snapshot metadata, addresses, codehashes and content hashes
before copying normalised source, ABI, proxy, permission and implementation evidence into the
shared store.

**Design-decision practice.** Architecture is recorded as ADRs (`docs/adr/`, currently 18) with
work-package docs in `docs/design/`; each work package is developed in its own git worktree on a
feature branch and merged only after **runtime verification** — the repo's convention is
explicit that static checks and passing unit tests are *not* verification, and that end-to-end
verification means driving the running stack (Playwright over the real GUI: 21 disco specs, 29
explorer specs, 6 trace specs, which `test.skip` when the RPC node or data is absent). This is
worth one sentence in the report as a methodology note, because the latency numbers in §3.7 come
from exactly that practice. *Housekeeping:* two files claim ADR-014 (`014-multitoken-arbitrage-
valuation.md` and `014-navigation-stable-discovery-preparation.md`) and ADR-015 is reserved —
fix the numbering before any ADR is cited by number in the paper. `TODO`

**Milestone history** (useful for a short "how it was built" paragraph): M1 port the explorer to
the platform stack; M2 extract DiscoUI capabilities (contract sources, discovery metadata, call
trees); M3 WebGL call-graph visualisation; M4 wire explorer ↔ trace (every explorer transaction
deep-links to its trace, trace nodes overlaid with the explorer's MEV facts); M4.5 the trace
workspace; M5 agentic AI over traces and contracts. M1–M4 were e2e-verified (25/25 against the
live stack, 2026-07-14); M5 and the Discovery work on top of it are the subject of ADRs 009,
012, 013, 016, 017, 018.

`TODO(figure) — FIGURE 2.` Service/data-flow diagram. The ASCII data-flow block in
`docs/ARCHITECTURE.md` is the right content; it needs redrawing with the evidence plane and
`decompiler-api` added (both post-date it). Owner: `TODO`.

### 3.4 Agent and harness

*(skeleton §3.3 — rewritten; see ⚠ CORRECTION 3 and 4)*

An agent, in the sense used here, is a language model combined with a **harness**: the software
that decides what the model can observe and what it can do. The harness is therefore as much
part of the experimental setup as the model, and describing the model alone would under-specify
the experiment — a point the report should make explicitly, because it is the reason this
section exists at all.

**Harness and model.** The harness is `pi` (`@earendil-works/pi-coding-agent`, v0.79.x),
embedded as an SDK inside `agent-api` rather than driven as a CLI. Inference goes through the
university's OpenAI-compatible endpoint; the repo's pi settings name provider `scc_kitoolbox`
and default model `kit.qwen3.5-397b-A17b`, i.e. the open-weight **Qwen3.5 397B A17B**. The
choice of an open-weight model is not aesthetic: quotas for proprietary models on that endpoint
are capped, so an experiment that must be re-runnable cannot depend on them. `agent-api` bakes
in **no model and no API key** — credentials, the model registry and the default model are read
from the user's pi agent directory (`$PI_CODING_AGENT_DIR`, host `~/.pi/agent`, mounted into the
container), and the UI's top-bar picker can override the model per run. `TODO(cite)` — the
justification for pi specifically (leading harness comparison on agentic coding benchmarks)
needs a proper citation with an access date, and the sentence needs its missing subject.

**How instructions actually reach the agent.** In resolution order, as implemented in
`apps/agent-api/src/runner.ts`:

1. **System prompt.** For a Discovery run, a **server-selected, versioned profile** from
   `discoveryPrompt.ts` — `MEV_DISCOVERY_PROMPT` or `VULN_DISCOVERY_PROMPT`. The vulnerability
   profile is a `systemPromptOverride`: it deliberately does *not* inherit the MEV system prompt,
   because appending vulnerability text to an MEV-framed prompt measurably biased the model
   toward ordering-and-extraction framing instead of root-cause bugs (ADR-016 §4, ADR-018 §3).
   For other runs, `.pi/SYSTEM.md` from the project, falling back to the agent dir — read
   explicitly rather than through trust-gated discovery, so it applies regardless of the
   container's project-trust state.
2. **Project resources.** `DefaultResourceLoader` loads `.pi/AGENTS.md` and `.pi/skills/`
   (currently one skill, `/skill:mev`), with project trust forced on because the container's cwd
   is never in the host trust file. Extensions are disabled (`noExtensions: true`) so no
   surprise project extension can attach a tool.
3. **Task instructions.** Per-skill user-prompt lead-ins from `tasks.ts`
   (`ANALYZE_CODE_TASK`, `ANALYZE_VALUE_TASK`, `BUILD_PREVIEW_TASK`, `VERDICT_CHAT_TASK`).
4. **Evidence.** The `discoveryBase()` context: selected bundles, the unresolved-candidate list
   with opaque ids, the structural trace tree, a bounded per-contract **function-signature
   index** (the callable surface — added in ADR-018 §6 so the parent's first turn is grounded
   without spending a child turn), decoded swaps, and incident economics (gas and builder tip).

The repo-root `AGENTS.md` is **not** in this chain. It is instruction for coding agents working
*on* the repository — build commands, monorepo conventions, verification policy, git worktree
practice. Conflating the two would misdescribe the experiment.

**Tool surface.** Deliberately narrow; there is no general bash or filesystem access.

| Tool | Available to | Purpose / bound |
|---|---|---|
| `get_function_code` | any run with parsed source | pulls one function body from submitted source; signatures are sent up front, bodies on demand, because full sources do not fit |
| `request_contract_analysis` | parent Discovery session only | one authorised candidate id → one ephemeral child → one typed bundle; server owns prompt/profile/evidence selection |
| `flag_important_nodes` | verdict runs | records addresses that look important but are unanalysed; surfaces as an amber marker in the graph |
| `cast` (read-only) | parent/session-scoped runs | bounded foundry `cast` via `execFile` (never a shell), allowlisted read subcommands only (`call`, `storage`, `balance`, `code`, `tx`, `receipt`, `block`, `keccak`, `abi-decode`, …); every state-changing / wallet / broadcast form rejected before spawn; 20 s timeout, 8 KiB output cap |

**Execution discipline.** Runs are bounded process-wide by a scheduler (`AGENT_MAX_CONCURRENCY`,
default 2). Turns sharing a persistent session key are strictly serialised; independent
ephemeral runs may overlap. When a parent invokes its child it **atomically hands over its
provider permit** and waits without holding one, and the child returns it before the parent
resumes — which keeps the global limit honest *and* avoids the deadlock that a naive nesting
would hit at limit 1. Reasoning is requested where the model supports it (clamped by the
harness) and is **display-only**: streamed to the UI but never folded into the report, the
transcript, or the durable session turns. Context compaction is disabled and retries are capped
at two. A provider call that fails mid-turn without throwing is detected via the harness's
error state and surfaced, rather than emitting an empty but plausible-looking "done".

**Grounding rules.** The system prompt requires every conclusion to name the function signatures
and state fields it rests on, forbids asserting protocol facts from memory that the submitted
material does not support, and instructs the model to say what is missing when evidence is
insufficient. ADR-018 §3 adds an explicit **decisive-verdict bar**: if current evidence does not
support a confident verdict the model must request more — analyse another candidate, cast a slot
or balance — and may only answer "insufficient evidence" after the cheap available tools are
exhausted, while never fabricating unavailable facts. Both profiles carry the research-ethics
constraint: detection, analysis, simulation and research reporting only; no deployable
extraction bot or exploit.

`↯ VERIFY` — before this goes in the paper someone should confirm on the live stack which
system prompt actually reaches a run (log the effective prompt once per profile) and record the
exact pi version, endpoint URL and model string used for the reported experiments. The paper
needs a reproducibility paragraph and it needs to be true.

### 3.5 DiscoUI — the human-in-the-loop surface

*(skeleton §3.4 — was TODO; filled from the repo)*

**What it is and why we did not build our own.** DiscoUI is L2BEAT's contract-exploration
frontend — `protocolbeat` (React/Vite) over `l2b` (Express) over their `discovery` package.
`apps/disco` is a clone of protocolbeat at a pinned commit, with vendored `@l2beat/*` shims and
every deliberate edit marked `DIVERGENCE(mev)` so that re-porting against a newer pin stays
reviewable. At ~36k lines it is the largest single component in the repo — which is exactly the
argument for cloning: a dockable multi-panel workspace with a WebGL graph renderer, a Monaco
source editor, a discovery-backed values panel and a permissions view is a year of frontend work
we did not have. The l2beat submodule itself is read-only, pinned and temporary; required parts
are ported in with provenance headers rather than imported, and it is slated for removal
(ADR-004).

**The trick that made the panels cheap.** A trace is represented as a **synthetic discovery
project** (§3.1, Stage 1). Because the incident's output is an ordinary `discovered.json`, the
stock **Values**, **Code** and **Preview** panels work against it unmodified — there are no
MEV-specific forks of those panels. Synthetic projects are hidden from the home list, live
beside real projects in the bind-mounted projects directory, are deletable at any time (they are
only a cache), and are never committed.

**The panels, in the shape a researcher uses them.**

- **List** is the entry point. Instead of the project List's `Initial / Discovered / EOAs`, it
  shows incident-shaped folders: an **Initial** folder holding the root node of every leg, then
  one folder per leg (`Front-run`, `Victim`, `Victim 2`, …, `Back-run`) containing that leg's
  remaining call nodes in trace order. Folders map 1:1 to the transactions returned by the MEV
  endpoint, which means the workspace loads *all* legs of the incident, not just the deep-linked
  one.
- **Nodes** is route-aware: inside a discovery project it is the stock dependency graph; on a
  trace route the *same* graph stack renders the execution trace (ADR-005 — a pivot away from
  hand-rolling a second renderer). Nodes are auto-named from discovery output — template or meta
  name, else verified source name, else shortened address — and node fields get decoded selector
  names instead of raw 4-byte selectors. Node colour resolves through **one exported colour
  table** shared by the node builder and the legend, so a node's fill always equals the legend
  swatch (ADR-018 §4, replacing a hand-synchronised duplicate table).
- **Edge overlays** are one exclusive segmented control — `Default | Control | Funds` — all three
  sharing the same lane geometry so switching modes recolours and relabels rather than swapping
  render engines. **Default** is the structural call/dependency graph (brown); **Control** shows
  execution ordering and status — sequence, call kind, decoded selector, success/revert, with
  attempted or reverted edges dashed and red-tinted (blue); **Funds** shows value movement —
  asset symbol, amount, and true asset direction `from → to`, native vs ERC-20/721/1155
  distinguished (green). Colour is never the only channel; shape, dash and label carry status
  too. Toggling performs **no upstream work** — the graph payload already carries the flow edges
  (ADR-017 §5, ADR-018 §1).
- **Values / Code / Preview** are stock DiscoUI: discovered fields, verified sources in the
  editor, permissions dossier.
- **Discovery** replaces the older manual Analyze panel. It has two always-on tabs, **MEV** and
  **Vulnerability**, each showing the bundles it will consume, each bundle click-to-deselect, and
  a **live context meter** showing how much of the current model's window the base prompt plus
  selected bundles occupy. The human curates by *exclusion* rather than by picking nodes — an
  important framing for the paper, since it is the point where human judgement enters without
  the human having to drive the analysis.
- **Marks.** A contract carries an **M** tick when a current MEV bundle covers it and a **V**
  tick when a current vulnerability bundle does, derived from bundle versioning so a stale bundle
  does not mark. Verdict-flagged-but-unanalysed contracts carry an amber `!` (ADR-018 §2).
- **Flag.** A top-bar button persists the incident to an app-owned `flagged_transactions` table
  via explorer-api, and a **Flagged TXs** view in the explorer lists them, each row linking back
  to `/ui/trace/:txHash` (ADR-017 §4). This closes the loop between the two frontends, which are
  separate origins and therefore could not share client-side state.

**Why this matters to the argument, not just the demo.** The verdict and the evidence are
displayed against the *same* graph the agent reasoned over, at the same snapshot. A claim like
"the searcher's contract received the flash loan here and repaid it there" is one click from the
call node and one more from the contract's source. That is what makes the explanation auditable
rather than merely fluent, and it is the concrete form of the "approachable" half of the research
question.

`TODO(figure) — FIGURES 3–4.` Screenshots, and they should be chosen to make an argument rather
than to show that a UI exists. Suggested: (3) a sandwich workspace — List folders showing
front-run / victim / back-run, Nodes with the Funds overlay active so the value movement is
visible, and M/V marks on the analysed contracts; (4) the Discovery pane mid-run — selected
bundles, the context meter, a `request_contract_analysis` child in progress, and the streamed
verdict. Use a real incident and record its hash in the caption. Owner: `TODO`.

### 3.6 Benchmark design

*(skeleton §3.5 — still open; this is a concrete proposal to argue about, not a description of
something that exists)*

**State of play, stated plainly:** nothing in the repo evaluates the framework. There is no
evaluation corpus, no scoring harness, no results file. `docs/design/wp-shared-evidence-lazy-
discovery.md` (E8) sketches a small evaluation corpus for the *vulnerability* side only —
known-vulnerable, safe-but-privileged, proxy/configuration-risk and decompiled contracts, scored
on bug localisation, exploitability prerequisites, unsupported assertions, topic leakage and safe
reporting — and even that is unbuilt. This is the critical path for §4 and it should be the
next thing the team does. Everything below is a proposal.

**Two tiers, matching the two research goals.**

*Tier 1 — Benchmark (automatic labels, breadth).* The deterministic layer of §3.2 is already an
automatic labeller running over an exhaustively inspected block range from block 11,000,000
upward, with results in Postgres. Sampling from it gives labelled incidents at essentially zero
marginal cost, and the class balance is controllable per detector (arbitrage, sandwich,
liquidation, JIT liquidity, non-atomic arbitrage, liquidation sandwich, liquidation race, NFT
flip). The measurement is agreement between the agent's one-line classification and the
detector's label, reported per class, plus a confusion matrix.

Three caveats have to be in the text or the number is not worth printing:

1. **The labeller is not ground truth.** It has documented false-positive modes — the stale
   router exclusion list (B3) is precisely a sandwich false-positive generator, and the
   single-pool-only nature of the sandwich heuristic means multi-pool sandwiches are invisible
   to it. Disagreement is therefore **not** automatically an agent error, and any disagreement
   that is scored must be adjudicated, not assumed.
2. **Negatives are missing.** A corpus drawn only from detector hits measures nothing about
   false positives on ordinary transactions. The sample must include a matched set of
   transactions the detectors classify as benign, ideally including *hard* negatives — large
   multi-hop swaps, batched router calls, liquidations that are ordinary rather than
   MEV-motivated.
3. **Contamination.** Both systems read the same decoded facts. The agent sees the trace tree,
   decoded swaps and the signature index, all produced by the same pipeline that generated the
   label. Agreement therefore partly measures shared inputs. Mitigation: report a stratified
   breakdown by evidence status, since the *unverified-contract* stratum is where the agent has
   information the labeller does not (decompiled evidence) and where the interesting result
   lives. `TODO` — decide whether to also run an ablation with the swaps/labels withheld.

*Tier 2 — Evaluation (manual review, depth).* A small hand-reviewed set — 20–30 incidents is a
realistic target for a seminar — spanning every detector class plus benign and adversarial
cases, each independently reviewed by at least two people, with disagreements resolved by
discussion. Here the object of measurement is the **explanation**, which is the part no
automatic label can score. Proposed rubric, per incident, each item scored on a small ordinal
scale with a written justification:

| Dimension | Question |
|---|---|
| Classification | correct MEV category? |
| Mechanism | is the described extraction mechanism actually what happened? |
| Beneficiary | is "who gained value" identified correctly? |
| Grounding | is every material claim tied to a named function, state field, trace call or cast result? |
| Fabrication | any claim the evidence does not support? *(this is the safety-critical metric — an ungrounded but fluent explanation is worse than a refusal)* |
| Calibration | does stated confidence track correctness? Does it say what is missing when evidence is thin? |
| Usefulness | would this save a researcher time versus reading the trace unaided? |

**Baselines.** Without baselines the numbers mean nothing. The cheapest and most informative
ladder, all on the same corpus and the same model:

1. **Bare model, hash only** — reproduces the Introduction's failure and makes it quantitative
   rather than anecdotal. Near-zero expected performance; the point is the floor.
2. **Model + raw trace dump**, no evidence plane, no bundles, no tools — a naive
   "put the trace in the context window" baseline. This is the baseline most readers will assume
   is sufficient, so beating it is the load-bearing result.
3. **Model + our evidence, tools disabled** — isolates the contribution of the agentic loop
   (`request_contract_analysis`, `cast`) from the contribution of the structured context.
4. **Full framework.**
5. **Deterministic detector alone** — the classification ceiling on labelled classes, and by
   construction it produces no explanation at all, which is the qualitative point.

An ablation of the decompilation tier (unverified contracts opaque vs. Panoramix-decompiled) is
the single most interesting variant, because unverified searcher contracts are the case the
whole design exists for. `TODO` — decide scope with the supervisor; 1+2+4 plus the decompilation
ablation is probably the minimum that survives review.

**External comparison.** `TODO` — decide whether to compare against a third-party labelling
system (zeromev, EigenPhi, Flashbots' own output). It would strengthen the benchmark
considerably, since it breaks the shared-pipeline contamination of Tier 1, but it costs
integration work and introduces its own label-disagreement problem. Flag as future work if the
seminar timeline does not allow it.

**Reporting.** Whatever is run, report: model string, harness version, endpoint, date, sample
size and selection procedure, and both cost and latency per incident (§3.7). Runs should be
repeated ≥3 times on at least a subset, because the agent is stochastic and single-run numbers
on 20 incidents are noise.

### 3.7 Measured behaviour so far

*New section — the only quantitative data the project currently has. It belongs in the paper
even though it is about latency rather than accuracy, because "make MEV research more efficient"
is half the research question and this is the only evidence bearing on it.*

Measured 2026-07-23 on the live stack with the default Qwen model, driving a real arbitrage
incident (`0xa312a815…`) with three unverified contracts end to end (ADR-018 §5):

| Phase | Time |
|---|---|
| Child analysis 1 (cold Panoramix decompilation) | 33 s |
| Child analysis 2 | 13 s |
| Child analysis 3 | 11 s |
| Child phase total (serial) | ~68 s |
| Parent verdict generation (~18k tokens) | ~63 s |
| **Total** | **~144 s** |

Three findings from that exercise are worth reporting, and the second is the most honest thing in
the project:

1. **A latent evidence bug dominated everything.** An over-long Panoramix warning failed the
   evidence artifact's schema validation with a 502, which aborted **100 % of child analyses for
   unverified contracts**. Bounding the warning turned three failed children into three
   successful bundles. The single largest improvement in the measured run had nothing to do with
   models, prompts or concurrency — it was a validation bug in the plumbing. This is a genuinely
   useful observation for a paper about LLM agents on real infrastructure: the bottleneck was
   engineering, and it was invisible until the system was driven end to end.
2. **Concurrency was measured and then rejected.** Parallelising children would cut only the
   ~68 s child phase toward ~33 s (the slowest child) — about a 25 % total saving — at the cost
   of breaking the scheduler's deadlock-safe, provider-bounded permit invariant against a
   provider whose concurrency limits are unknown. It was judged not worth the risk, and
   `AGENT_CHILD_MAX_CONCURRENCY` is deferred as *measured-unjustified*. Reporting a rejected
   optimisation with the measurement that rejected it is stronger than reporting only what was
   built.
3. **Caching is where the win is.** Bundles are codehash-addressed, so repeat encounters with a
   known protocol cost nothing, and identical `(codehash, kind, artifact, schemaVersion,
   promptVersion)` requests share one in-flight child and one durable result. First-run cost is
   the number the table above shows; steady-state cost on a corpus with heavy address reuse
   should be far lower. `TODO` — measure this. A cold-vs-warm run over ~20 incidents would
   produce the cache-hit-rate and amortised-latency numbers, and it is a couple of hours of
   work, not a research project.

Known remaining latency, not yet optimised: the **workspace discovery** pass on first open of an
incident (~1 min, one bounded `l2b discover` against an RPC node with no log index, which gates
the whole workspace), and cold source/decompilation fetched *inside* the run rather than
pre-warmed. ADR-018 §5 proposes pre-warming evidence out of band when the catalog opens, bounding
the eager candidate surface, and streaming a preliminary verdict that refines as evidence
arrives; the bounded surface and the evidence-bug fix landed, **pre-warm has not**
(`↯ VERIFY` — no pre-warm implementation is present in the source; confirm before claiming it
either way). Making the run navigation-stable across tab switches (ADR-018 §7) also appears
open.

---

## 4. Comparison of framework against benchmark

`TODO` — blocked on §3.6. Nothing can be written here until the corpus exists and the runs have
been made.

What the section will need, so the work can be planned backwards from it:

- **Table 1** — corpus composition: incidents per class, verified vs unverified contract mix,
  block range, selection procedure.
- **Table 2** — Tier 1 classification agreement per class, with the confusion matrix and the
  stratification by evidence status (verified / decompiled / opaque). Report disagreements
  adjudicated into *agent wrong* / *labeller wrong* / *genuinely ambiguous*; the middle bucket is
  a result in its own right, given the audit findings in §3.2.
- **Table 3** — the baseline ladder from §3.6 on the same corpus, so the contribution of
  structured context is separable from the contribution of the agentic loop.
- **Table 4** — Tier 2 rubric scores with inter-rater agreement, plus the fabrication rate called
  out separately.
- **Figure 5** — cost/latency per incident, cold vs warm.
- **Qualitative section** — two or three worked examples, at least one where the framework was
  *wrong*, with a diagnosis of why. A paper with only successful examples in this space will not
  be believed, and the failure analysis is where the design lessons are.

---

## 5. Conclusion

`TODO` — final synthesis after §4. The shape of the argument is already fixed by the
Introduction: the barrier to LLM-assisted MEV analysis is context, not capability; a harness
plus a shared evidence plane converts an impossible query into a tractable one; here is what
that buys, measured; and here is what it does not buy.

### 5.1 Limitations

Grounded in the implementation; none of these are hypothetical.

**Scope.** Ethereum mainnet only. Detection covers a fixed strategy set (arbitrage, sandwich,
liquidation, NFT trades) plus five detectors; novel or unmodelled strategies are invisible to
the labelling layer, and the agent inherits that blind spot wherever it leans on decoded facts.
The sandwich heuristic is single-pool by construction and cannot see multi-pool sandwiches.

**Protocol coverage is a moving target.** The inherited classifier specs are 2021-era; V4-class
protocols are handled best-effort via net transfer deltas. Coverage decays without maintenance,
and a coverage gap silently becomes an `unknown` call rather than an error.

**Label quality.** The automatic labeller has documented bugs and a documented decoder-strictness
divergence from the reference implementation (§3.2). Any benchmark built on it inherits that.

**Decompilation is approximate.** Panoramix output is not verified source. It can be partial or
fail entirely, and the framework must not — and does not — treat it as proof of source
equivalence or runtime reachability. Some contracts stay opaque, and for those the analysis
rests on observed behaviour alone.

**Cost and latency.** First-run analysis of an incident with unverified contracts is on the order
of two minutes, plus roughly a minute of workspace preparation (§3.7). This is fine for research
and unusable for anything real-time.

**Single model, single harness.** All results come from one open-weight model behind one
university endpoint with one harness. Nothing here establishes that the findings generalise
across models, and quota caps on proprietary models are the reason rather than a design choice.

**Non-determinism.** The agent is stochastic. Bundles are cached and versioned, which stabilises
repeat runs, but a fresh run on a cold cache can differ. Single-run numbers are not evidence.

**Prompt injection is a live threat, mitigated but not eliminated.** Contract source and
decompiled pseudocode are attacker-controlled text entering a model's context. The framework
strips control characters, bounds and delimits output, instructs the model never to follow
embedded instructions, and — most substantively — keeps the tool surface narrow and
server-authorised: `request_contract_analysis` accepts only an opaque id from a user-selected
catalog, `cast` is allowlisted read-only via `execFile` with no shell, and reusable children get
no network, no state and no recursion. These are real mitigations, not guarantees. `TODO` — a
short adversarial test (a contract whose source contains an injection attempt) would turn this
paragraph from a claim into a finding, and it is cheap.

**Evaluation is the big one.** As of this draft the framework is unevaluated. Everything in §3.7
is latency, not accuracy.

**Ethics and dual use.** The system explains extraction mechanisms in detail. The repo's stated
constraint — detection, analysis, simulation and research reporting only, no deployable
extraction bot or exploit — is enforced in both system profiles, and the vulnerability profile
restates it since it does not inherit the MEV prompt. Worth a short explicit paragraph rather
than a footnote.

### 5.2 Outlook

**Immediate, and on the critical path.** Build the evaluation corpus and the scoring harness
(§3.6). Everything else is secondary until §4 exists.

**Near-term, already specified and partly unimplemented.** Pre-warm evidence out of band when
the catalog opens, so the cold decompile leaves the critical path; make Discovery runs
navigation-stable so switching tabs cannot orphan a verdict; measure cold-vs-warm cache
behaviour over a real corpus.

**Structural.** Retire the l2beat submodule by finishing the port of the parts we depend on
(ADR-004's stated direction). Productionise the content-addressed `.flat` store — the
`@mev/flat-store` prototype collapsed 1013 flat files / 71.7 MiB to 294 blobs / 19.2 MiB, a 73 %
reduction with a byte-exact round-trip, on the live corpus — and extend the same content
addressing to ABIs and, via templates, to config.

**Research directions.** Multi-chain (the L2s are already in the config surface but untested);
protocol-coverage automation, since hand-written classifier specs are the maintenance bottleneck
and a decompilation-driven classifier is an obvious use of the tier we already built; a
model-comparison study if quota allows, since the harness makes the model swappable by design;
and the vulnerability-research direction, where the machinery is built and the evaluation corpus
(E8) is fully specified but unimplemented.

---

## Appendix A — repo facts sheet

| Item | Value |
|---|---|
| Repo | `RFC-Understanding-MEV-via-LLMs` (MIT) |
| Snapshot described | working tree 2026-07-23; latest ADRs 016–018 |
| Scale | ~62k LOC TypeScript (`apps` + `packages`); disco clone ~36k, `@mev/inspect` ~4.5k, `agent-api` ~4.9k, `packages/evidence` ~1.8k |
| Toolchain | Node 22.22.3, pnpm 10.33.4, pnpm workspaces + Turborepo, TypeScript strict + ESM, Biome, Vite, Express |
| Runtime | 9 compose services, host networking, external Postgres volume |
| Harness | pi `@earendil-works/pi-coding-agent` ^0.79.1, embedded as SDK |
| Model | provider `scc_kitoolbox`, model `kit.qwen3.5-397b-A17b` (Qwen3.5 397B A17B) |
| Decompiler | Panoramix pinned `23edd11058abafcba9340afc768d2aa9274c0b62`, sandboxed sidecar, no network |
| RPC requirement | reth or Erigon with `trace_block` + `debug_traceTransaction`; archive state; geth insufficient |
| Inspection floor | `INSPECT_FLOOR_BLOCK` default 11,000,000 |
| Concurrency | `AGENT_MAX_CONCURRENCY` default 2; decompiler concurrency 1, 30 s timeout, 24 KiB bytecode cap |
| E2E coverage | Playwright: 21 disco / 29 explorer / 6 trace specs |

## Appendix B — ADR index (what to cite for what)

| ADR | Subject | Cite it for |
|---|---|---|
| 001/002 | monorepo tooling; shared Postgres + unified env | architecture ground rules |
| 003 | port mev-monitor | explorer lineage |
| 004 | DiscoUI extraction | why the l2beat clone, provenance policy |
| 005 | WebGL trace visualisation | the pivot to reusing protocolbeat's graph stack |
| 006 | pi agent integration | harness choice |
| 007 | trace ↔ MEV enrichment | explorer facts overlaid on trace nodes |
| 008 | trace workspace panels | the synthetic-project trick, incident-shaped List |
| 009 | analyze panel | first agent UI, grounding rules, transcripts (superseded in part by 012/016) |
| 010 | native inspector | the TypeScript port, decode-then-pattern-match |
| 011 | exhaustive coverage + timeline | floor-to-head fill worker, serial queue |
| 012 | Discovery, persistent sessions, typed bundles | codehash-addressed bundles, context budgeting |
| 013 | Discovery UX refinements | thinking level (§6), read-only `cast` (§8) |
| 014a | multi-token arbitrage valuation | value attribution with pricing provenance |
| 014b | navigation-stable Discovery preparation | *(numbering collision — fix)* |
| 016 | shared evidence, lazy children, flow overlays | **the current core design**: evidence plane, Panoramix tier, one-level children |
| 017 | always-on kinds, flagged TXs, flow completion | Discovery gating, explorer hand-off |
| 018 | overlays, marks, prompts, interactivity | edge modes, M/V marks, tool-forward prompts, the latency measurement |

## Appendix C — consolidated TODO register

| # | Item | Section | Owner |
|---|---|---|---|
| 1 | Build evaluation corpus + scoring harness | 3.6 | `TODO` — **critical path** |
| 2 | Run baselines and ablations; produce §4 tables | 4 | `TODO` |
| 3 | Figure 1 — pipeline (cache + model boundaries visible) | 3.1 | `TODO` |
| 4 | Figure 2 — services / data flow, redrawn with evidence plane | 3.3 | `TODO` |
| 5 | Figures 3–4 — DiscoUI screenshots of a real incident | 3.5 | `TODO` |
| 6 | Reproduce the failed-hash-query quote verbatim + footnote; ideally 2–3 models | 2 | `TODO` |
| 7 | Related-work section | 2 | `TODO` |
| 8 | Contributions paragraph | 2 | `TODO` |
| 9 | Citation for pi harness leaderboard claim + fix the broken sentence | 3.4 | `TODO(cite)` |
| 10 | Literature anchors for the five detectors | 3.2 | `TODO(cite)` |
| 11 | Verify effective system prompt per profile on the live stack; record pi version / endpoint / model string | 3.4 | `↯ VERIFY` |
| 12 | Confirm pre-warm and navigation-stable-run status | 3.7 | `↯ VERIFY` |
| 13 | Measure cold-vs-warm cache behaviour over ~20 incidents | 3.7 | `TODO` |
| 14 | Adversarial prompt-injection test on contract source | 5.1 | `TODO` |
| 15 | Decide on external label comparison (zeromev / EigenPhi) | 3.6 | `TODO` |
| 16 | Fix the ADR-014 numbering collision before citing ADRs by number | 3.3 | `TODO` |
| 17 | Abstract | 1 | `TODO` — last |

## Appendix D — glossary

**Incident** — the set of transactions that belong to one MEV event (e.g. the three legs of a
sandwich), as resolved by the deterministic layer. The unit of analysis, not the transaction.

**Harness** — the software that turns a model into an agent by defining what it can observe and
do. Here: pi, embedded as an SDK in `agent-api`.

**Bundle** — a typed, schema-validated, versioned unit of understanding about a *contract*, keyed
by `(codehash, kind)` and therefore reusable across every incident that touches the same code.
Produced by a child session; consumed by the parent.

**Candidate / catalog** — a contract participating in an incident, with its snapshot codehash,
proxy relationship, trace relevance and evidence status, addressed by an opaque server-issued id.
The catalog is assembled without any model call.

**Evidence plane** — the normalised, snapshot-addressed store (Postgres + `packages/evidence` +
`trace-api`) that every consumer reads from, so a transaction is replayed once rather than per
consumer.

**Synthetic project** — a disposable discovery project `trace-<hash8>` representing one incident,
which is what lets the stock DiscoUI panels work unmodified.

**Verdict** — the parent's final single-context output: classification, explanation, confidence.
