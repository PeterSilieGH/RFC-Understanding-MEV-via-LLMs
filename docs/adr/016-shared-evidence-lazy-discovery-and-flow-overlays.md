# ADR-016: Shared evidence, lazy contract-analysis subagents, vulnerability-first Discovery, and flow overlays

## Status

Accepted — 2026-07-22. Implementation is tracked by
`docs/design/wp-shared-evidence-lazy-discovery.md`.

ADR-015 is reserved for the multi-token valuation work being developed in
parallel.

## Context

The Explorer and DiscoUI now meet at the same incident, but they do not yet
share all of the work needed to explain it:

| Evidence | Current producers | Duplicate or scaling cost |
| --- | --- | --- |
| Execution | `@mev/inspect` fetches `trace_block`; trace-api separately fetches `debug_traceTransaction` with `callTracer` | The same transaction can be replayed twice, and concurrent cold graph/workspace requests can each start the same debug trace because the cache stores only completed values. |
| Runtime identity | l2b discovery fetches bytecode; agent-api later calls `eth_getCode` for every candidate lacking a supplied codehash | Repeated RPC calls, sometimes at different block tags, can identify the same deployment inconsistently. |
| Verified source | l2b has a persistent discovery cache and generated `.flat` files; trace-api has a separate in-memory Etherscan client | A cold address can be looked up twice, while an unverified miss is not durable across processes or restarts. |
| Token metadata | explorer-api resolves symbol/decimals for presentation; graph enrichment would otherwise resolve them again | Per-edge `eth_call` does not scale and can disagree with incident-time state. |
| Contract understanding | ADR-012/014 eagerly prepares every missing `(codehash, kind)` bundle when Discovery is opened | Large incidents pay one model turn per unknown codehash before the parent model has decided which contracts matter. |

The eager bundle pass was introduced to prevent one massive request body and
one massive model context. It fixed the HTTP `Request Entity Too Large`
failure without raising nginx or Express limits, but it moved the bottleneck to
many up-front model turns. Unverified contracts are especially weak: ADR-014
stores a permanent deterministic `Unverified runtime contract` placeholder,
even though agent-api already fetched the runtime bytecode used to compute its
codehash.

Vulnerability Discovery also shares a generic bundle schema and starts from the
repository-wide MEV system prompt with a vulnerability suffix. That steers the
model toward transaction ordering and value extraction instead of root-cause
bugs, reachability, and feasible exploit paths.

Finally, the nodes panel already contains most of the raw ingredients for richer
edges. Trace graphs carry typed calls, native value, token transfers, and
decoded swaps; discovery output carries permissions. Today these facts are
either reduced to an unlabeled dependency edge or a count in a node title.

## Decision

### 1. One snapshot-addressed evidence plane

The platform will expose one normalized evidence plane backed by the shared
Postgres instance. `@mev/db` owns its schema, `packages/evidence` owns stable
types and read/write adapters, and trace-api is its HTTP gateway. Consumers do
not read l2b's SQLite cache or another service's generated files directly.

`@mev/db` also owns an append-only migration ledger. Every migration runs in a
transaction while holding one fixed Postgres advisory lock, and records its
version and checksum only after success. All service boot paths call the same
migrator; they do not race independent `CREATE IF NOT EXISTS` statements or
silently accept a changed migration body.

Every immutable lookup is keyed by chain and snapshot, not by address alone:

- execution: `(chainId, blockHash, transactionHash, traceSchemaVersion)`;
- deployment: `(chainId, address, blockNumber, runtimeCodehash)`;
- source: `(runtimeCodehash, sourceProvider, sourceRevision)` plus the address
  mapping needed for proxy metadata;
- token metadata: `(chainId, tokenAddress, runtimeCodehash)`; and
- decompilation: `(runtimeCodehash, engine, engineRevision, optionsHash)`.

The incident block number/hash is propagated from Explorer through workspace
preparation and the Discovery candidate catalog. `latest` is not used for
runtime identity when an incident snapshot exists. Proxy and implementation
deployments are separate identities; analysis follows the implementation set
recorded by discovery and retains the proxy's control/state context.

#### Execution traces

`@mev/inspect` remains the preferred producer. Its existing
`classified_traces`, `transfers`, and `swaps` rows, together with the receipt
logs it already fetches, are extended or adapted into a normalized execution
artifact. The artifact preserves the graph fields currently lost from unknown
calls: parent/trace address, exact call kind, selector, input and output sizes,
subtrace count, native value, gas, error/revert information, receipt log index,
and provenance/completeness flags. Receipt logs are the canonical source for
committed log-based transfers; decoded transfer and swap rows enrich those
facts instead of creating parallel movements.

trace-api publishes a versioned `TraceGraph v2` from persisted inspector trace
and receipt evidence first. Missing optional call-scoped-log detail is not a
reason to replay the transaction: receipts already supply normal fund-flow
logs. `debug_traceTransaction` is allowed only when the normalized execution
artifact is missing or corrupt, or when a user explicitly requests a raw-detail
view. A fallback result is normalized and persisted so a restart does not
replay it. It must never silently combine incompatible trace snapshots, and
clients reject graph schema versions they do not understand.

The in-memory trace cache also gains an in-flight promise map keyed by chain,
transaction hash, and tracer configuration. The promise is installed before
the RPC starts, removed in `finally`, and only successful values enter the LRU.
Thus a cold graph request and workspace preparation share one replay; a failed
request remains retryable.

#### Runtime code, sources, and token metadata

trace-api becomes the contract-evidence gateway used by agent-api and the code
panel. It persists runtime bytecode/codehash mappings, normalized verified
source/ABI artifacts, and explicit negative source results with `retryAfter`,
attempt count, provider, and error class. Agent-api receives an artifact
reference and codehash in the candidate catalog and no longer independently
calls `eth_getCode`.

l2b continues to own discovery semantics and remains the source producer. It
uses its own configured explorer/source support and persistent discovery cache;
trace-api does not pretend to be an Etherscan-compatible facade, because the
pinned l2b command does not expose a supported arbitrary explorer-base setting.
A monorepo-owned workspace runner invokes discovery at the incident snapshot by
deriving the block timestamp and passing l2b's `--timestamp` option. The runner
records the requested block number/hash and resolved timestamp so a snapshot
mismatch is visible rather than silently analyzed at `latest`.

l2b's configurable JSON-RPC URL may point to a narrow monorepo-owned RPC
adapter. That adapter owns bounded `eth_getLogs` pagination and snapshot-aware
code/storage caching, including the behavior previously prototyped as local
uncommitted edits to `LowLevelProvider.ts`. No functional change lives in or is
committed from the read-only submodule.

After l2b atomically finishes a run, trace-api performs a controlled import of
stable `discovered.json` and `.flat` output. It validates project-root paths,
snapshot metadata, addresses, runtime codehashes, and content hashes before
copying normalized source, ABI, proxy, permission, and implementation evidence
into the shared store. Other services never tail generated files or read l2b's
live SQLite cache, and trace-api does not issue a parallel Etherscan lookup for
the same discovery candidate. Explicit unverified results are imported as
retryable negative evidence.

Token symbol/decimals resolution writes through the same durable metadata store
in bulk. Flow rendering uses that store and falls back to a shortened address;
it never performs one `eth_call` per visible edge.

### 2. Panoramix is a sandboxed, lazy evidence tier

Unverified runtime bytecode is decompiled with
[Panoramix](https://github.com/palkeo/panoramix), pinned to reviewed upstream
revision `23edd11058abafcba9340afc768d2aa9274c0b62` (the revision containing
`PUSH0` support). The pin, source archive hash, transitive dependencies, and MIT
license notice are recorded in the image build.

Panoramix runs behind a small `apps/decompiler-api` sidecar over a Unix socket
owned by trace-api. The only call path is
`agent-api -> trace-api -> decompiler-api`; agent-api neither mounts nor opens
the socket. The sidecar invokes the Python package with raw runtime bytecode,
never an address. Its container receives no RPC URL,
Etherscan key, pi agent directory, model credentials, or outbound network. It
runs with a read-only root filesystem, dropped capabilities, bounded
CPU/memory/PIDs, concurrency one initially, a tmpfs scratch directory, and an
explicit `XDG_CACHE_HOME` inside that tmpfs, plus a hard process-group timeout
and input/output size limits.

Decompilation is not triggered while opening a Discovery pane. The lazy
contract-analysis path requests it only after a verified-source miss. Results
are stored as `complete`, `partial`, `timeout`, `unsupported`, or `error`. The
pinned-library adapter captures Panoramix's structured function/decompilation
and problem data before rendering text; stdout scraping is not the evidence
contract. Artifacts contain cleaned pseudocode, a recovered function/selector
index, failed-function metadata, warnings, duration, output hash, and retry
policy. In-flight work is coalesced by the decompilation key.

Evidence preference is:

1. verified source matching the runtime deployment;
2. a cached Panoramix artifact;
3. a newly requested Panoramix artifact; then
4. an explicit opaque-bytecode fallback.

Panoramix output is approximate, potentially partial, and untrusted data. ANSI
and control characters are stripped, output is size-bounded and delimited, and
Analyze is instructed never to follow instructions embedded in source or
decompiled text. Claims cite selectors, pseudocode locations, trace facts, or
read-only `cast` evidence and do not treat decompilation as proof of source
equivalence or runtime reachability.

The existing Solidity signature parser is not applied blindly to Panoramix's
Python-like `def` output. A decompiler adapter supplies a compact function index
and bounded `get_function_code` bodies. There is no second LLM pass that
rewrites pseudocode as Solidity; that would erase provenance and add a
hallucination layer.

Opaque bundles become retryable fallbacks, not successful permanent cache
entries. Existing machine-generated rows with role `Unverified runtime
contract` and no provenance are marked stale during migration. A changed
Panoramix revision or retry window can therefore replace them.

### 3. Discovery requests contract analysis lazily as one-level child runs

Opening or switching to Discovery performs only a compact catalog/cache lookup.
The parent receives:

- incident facts and a compact structural trace;
- selected cached bundles;
- selected unresolved contract candidates with address, snapshot codehash,
  proxy/implementation relationship, trace relevance, and evidence status; and
- the current child-call and context budgets.

The persistent parent session gains a server-defined
`request_contract_analysis` tool. Its sole model-controlled argument is a
candidate identifier from the user-selected incident catalog. It cannot accept
free-form focus text, arbitrary code, arbitrary addresses, or a different
research kind; prompt/profile selection is server-owned and versioned.

One invocation follows this path:

1. validate candidate allowlist, kind, depth, quota, and cancellation;
2. return a current cached bundle immediately when available;
3. resolve verified/decompiled evidence server-side, coalescing identical work;
4. run one ephemeral Analyze child session with the selected Analyze
   model/effort;
5. strictly validate and persist the typed bundle and provenance; and
6. return only the compact bundle/status to the parent tool call.

The child transcript and reasoning do not enter the parent context. Reusable
codehash-addressed children may use bounded function lookup, but receive no
`cast`, RPC, snapshot-state, or `request_contract_analysis` tool, so recursion
depth is exactly one and state cannot leak into a reusable bundle. Read-only
snapshot observations, including any explicitly allowed `cast` operation, are
performed by a parent/session-scoped evidence tool and stored under the
incident block hash, never under the codehash bundle key. Contract-scoped
failure is a typed, non-fatal tool result and warning; the parent can continue
and must disclose unresolved evidence.

Parent and child turns share one total provider-capacity coordinator governed
by `AGENT_MAX_CONCURRENCY`; a child-specific cap may restrict the mix but never
adds capacity beyond that total. When a parent invokes its direct child, it
atomically hands its provider permit to that child and waits without holding a
permit. The child returns the permit to the waiting parent before the parent
resumes. This preserves the global limit and also completes when the limit is
one, instead of deadlocking behind its own parent. Per-turn child count,
parallelism, wall time, source/function bytes, and output tokens are capped.
Identical `(codehash, kind, artifact, schemaVersion, promptVersion)` requests
share one in-flight child and one durable result.

Before launching a child, the tool also reserves the maximum compact result
against the parent model's remaining context budget. It returns a typed
`budget_exhausted` result without launching work when the reserve would be
violated. The parent must then finish with the available evidence or tell the
user which candidates to reconsider/deselect; it may not silently compact child
findings away.

The parent still computes the final verdict in its one persistent context.
There is no verdict-of-verdicts hierarchy. The user can deselect a cached bundle
or unresolved candidate before **Discover**; deselection removes both its
context and the parent's authority to request its analysis. **Reassess** restores
that selection surface as specified by ADR-014. The context meter continues to
show authoritative provider usage after every completed parent interaction.

Durable sessions record the candidate-catalog fingerprint, consulted bundle
revisions, and compact tool results required to rehydrate a follow-up after a
restart. Persistent pi sessions use mutable per-turn emit/signal/tool state;
cached tool closures must not retain the HTTP response from the first turn.
Once accepted, parent turns, evidence resolution, and child runs are
server-owned jobs. Route changes and HTTP/SSE/NDJSON disconnects only detach a
subscriber; they do not abort, reset, or restart the job. Events and terminal
state are durably replayable on reattachment. Only an explicit user cancel or
server shutdown policy requests cancellation, with permit cleanup in `finally`.

This supersedes ADR-012's eager all-candidate preparation and joint
MEV/vulnerability generation. It retains codehash-addressed reusable bundles,
bounded concurrency, selectable context, and the one-context final verdict.
ADR-014's navigation-stable job registry becomes a catalog/child-job registry
rather than an eager preparation registry.

### 4. Vulnerability Discovery is bug- and exploit-first

Discovery system prompts are explicit profiles selected server-side, not
suffixes appended to the MEV-oriented `.pi/SYSTEM.md`:

- MEV Discovery remains an ordering/value-extraction research profile.
- Vulnerability Discovery is a smart-contract security profile. It looks for
  root-cause bugs and feasible exploit paths, models unprivileged and
  compromised-privilege actors, distinguishes code defects from governance or
  configuration risk, and grades findings as confirmed, likely, or speculative.

The vulnerability profile discusses MEV only when incident evidence makes it
material. It prioritizes assets at risk, attacker-controlled inputs, trust
boundaries, state transitions, invariants, reachable entry points, exploit
prerequisites, impact, mitigations, evidence, and unknowns. It preserves the
repository's research-ethics rule: explain and validate vulnerabilities without
producing a deployable harmful exploit or extraction bot.

Bundles become versioned, discriminated payloads rather than forcing both kinds
through `role/entryPoints/flowSummary/notes`. A vulnerability bundle contains,
at minimum:

- contract role, source quality, and artifact provenance;
- assets at risk and trust boundaries;
- attack-surface entries with access, effects, and evidence;
- candidate invariants;
- bug hypotheses with class, locus, prerequisites, exploit path, impact,
  evidence, confidence, and counter-evidence; and
- unknowns and deployment-specific checks still required.

Reusable code facts remain codehash-addressed. Incident/block-specific state,
gas, and exploitability observations stay in the parent evidence/session and
are not baked into a reusable bundle. Existing generic vulnerability bundles
are stale when their schema/prompt version does not match and are regenerated
only when requested.

### 5. Control and Funds are semantic edge overlays

The nodes control group becomes **Show | Hide | Control | Funds**. Control uses
the existing `IconTrace`; Funds uses `IconSwap`. Both buttons have visible text,
`aria-pressed`, default off, and route-aware loading/error/disabled help. They
do not modify graph layout, selection, undo history, or persisted node data.

A separate `FlowEdge`/`FlowEndpoint`/`FlowFact` model carries semantic overlays:

```ts
interface FlowEdge {
  id: string
  layer: 'control' | 'funds'
  from: FlowEndpoint
  to: FlowEndpoint
  label: string
  facts: FlowFact[]
  status: 'observed' | 'committed' | 'attempted' | 'configured'
}

interface FlowEndpoint {
  address: string
  nodeId?: string // absent for an EOA or contract outside the visible graph
}
```

It is not encoded as synthetic node fields: fields change node height and would
corrupt stored layouts. A shared selector/aggregation layer feeds two native
rendering implementations: SVG paths and labels for the DOM graph, and WebGL
lines/arrowheads plus its renderer-owned label/detail layer for the WebGL graph.
They share semantics and accessibility text, not one SVG surface stretched over
both coordinate systems. Each follows dragged boxes, filters hidden endpoints,
offsets reciprocal/parallel edges, and represents an out-of-graph endpoint with
a stable boundary stub rather than reversing or discarding the transfer.

Both renderers use explicit level-of-detail thresholds. The detailed tier shows
individual facts and labels for small visible graphs; the aggregate tier shows
one edge summary and reveals facts on focus/hover; the large tier draws only
selected/incident-relevant aggregate edges up to a configured cap. The legend
reports aggregation/truncation. Text, dash/arrow shape, and the route-aware
legend supplement color.

On a trace/incident route:

- **Control** decorates the existing parent-to-child call edge with call kind,
  decoded selector/name, count, gas, and failure state. It consumes
  `TraceGraph.edges`; it does not rebuild the trace.
- **Funds** projects canonical movements. A log-based movement id is
  `(chainId, blockHash, txHash, logIndex, eventItemIndex, assetId)`; the item
  index distinguishes ERC-1155 batch entries and `assetId` includes token
  standard, contract, and token id where applicable. Decoded classifier rows
  attach to that id and never create a second transfer. A
  native movement id is
  `(chainId, blockHash, txHash, traceAddress, native, from, to, value)`. Only
  positive-value `CALL` frames, transaction-root value, CREATE/CREATE2
  endowment, and explicit SELFDESTRUCT beneficiary value can create native
  movements; `CALLCODE`, `DELEGATECALL`, and `STATICCALL` cannot. Receipt/log
  and trace provenance are retained when a fact is mapped to graph nodes.

  Labels preserve the actual asset `from -> to` direction even when it differs
  from call direction or an endpoint is outside the graph. A trace-native
  movement is committed only when its frame and every ancestor committed;
  otherwise it is `attempted`. Receipt logs are committed by definition for a
  successful receipt. Swaps join movement ids or trace/log provenance to supply
  protocol/grouping semantics and are never counted as additional movements.

On an ordinary discovery-project route:

- **Control** is a configured-authority overlay derived from
  `receivedPermissions`/`directlyReceivedPermissions` in `discovered.json`.
  trace-api exposes a traversal-safe, disk-only project-control endpoint. Edge
  direction is controller to controlled target and retains permission, delay,
  condition, and `via` provenance.
- **Funds** is disabled with “requires a transaction or incident scope.” Static
  balances and address-valued configuration are not fund flows.

The first activation may lazily fetch one cacheable internal flow payload from
trace-api; this keeps the base graph small. That endpoint may read only shared
Postgres evidence or validated discovery output on disk. Toggling either layer
must not start `debug_traceTransaction`, `eth_call`, `eth_getCode`, Etherscan,
source, token, or decompiler work. Repeated toggles reuse the browser/service
cache. Browser consumers share exported React Query key/options objects so the
trace panel, list, and Discovery context builder do not bypass each other's
cache.

This extends ADR-005/007. It supersedes the DOM-only and vague “project state as
fund flow” wording in D3 of `wp-mev-discovery.md`.

### 6. Versioning, observability, and failure semantics are part of the cache

Every evidence-derived bundle records source kind, artifact id/hash, analyzer
model, schema version, prompt version, run id, and timestamps. Cache validity is
explicit; the mere existence of a `(codehash, kind)` row is no longer enough.

Metrics/logs distinguish external work from reuse: RPC method/consumer and
in-flight/cache outcome, source provider/cache/negative hit, codehash and token
metadata hits, decompiler status/duration, child queue/cache/dedup outcome, and
parent context usage. Logs never contain API keys, full source, runtime
bytecode, model prompts, or private pi configuration.

No part of this decision raises nginx or Express body limits. Payloads stay
bounded through references, normalized evidence, tool results, and existing
bundle deselection.

## Alternatives considered

- **Raise request limits or submit one source mega-prompt.** Rejected: it hides
  the scaling failure and makes one context responsible for every contract.
- **Keep eager bundle preparation and only add more concurrency.** Rejected:
  provider turns remain proportional to all unknown contracts, whether or not
  the parent needs them.
- **Make `debug_traceTransaction` the only trace source.** Rejected: the
  Explorer already paid for block-wide `trace_block`, and its decoded tables are
  required for detection.
- **Use only `classified_traces` without a completeness contract.** Rejected:
  current rows omit graph details for unknown calls and do not contain
  call-scoped logs.
- **Eagerly decompile every unverified contract.** Rejected: decompilation is
  slow, fallible, and unnecessary for candidates the parent never consults.
- **Ask another LLM to rewrite Panoramix output as Solidity.** Rejected: it
  weakens provenance and can invent semantics.
- **Read or patch l2b's SQLite cache from monorepo services.** Rejected: it
  couples the platform to a temporary read-only submodule and risks concurrent
  cache corruption.
- **Patch `LowLevelProvider.ts` or emulate an Etherscan endpoint for l2b.**
  Rejected: uncommitted submodule code cannot ship, and the pinned command has
  no supported arbitrary explorer-base contract. RPC mediation and bounded log
  pagination live in the monorepo adapter; l2b remains the source producer and
  its completed output is imported.
- **Represent overlays as more node fields.** Rejected: fields participate in
  node sizing/layout persistence and do not work as an independent semantic
  layer.
- **Place one SVG overlay over both graph renderers.** Rejected: DOM and WebGL
  use different coordinate, culling, and level-of-detail paths. They share the
  semantic edge model but render it natively.
- **Give children a separate provider pool or keep the parent's permit.**
  Rejected: the former exceeds the configured total and the latter deadlocks at
  limit one. Direct-child permit handoff satisfies both bounds.
- **Aggregate child verdicts into a second verdict tree.** Rejected: the final
  answer must remain in one user-visible parent context.

## Consequences

- Flagging a block and opening its incident should reuse the inspector's trace,
  transfer, swap, runtime, source, and token evidence instead of replaying or
  refetching it per pane.
- First-use latency moves from pane opening to the few contract analyses the
  parent requests. Progress is more meaningful, but the first requested
  unverified contract can still incur a bounded decompilation and model turn.
- Durable evidence and explicit negative results add schema, retention, and
  invalidation work. Snapshot keys consume more storage than address-only
  caches but avoid incorrect reuse across upgrades/reorgs.
- Panoramix increases the analyzable surface but cannot make unverified code
  equivalent to verified source. Partial and failed results remain visible.
- Permit handoff in the shared parent/child capacity coordinator avoids nested
  deadlock without exceeding the configured total, but adds observable queue
  and recovery state.
- Vulnerability output becomes more actionable for audit work, at the cost of a
  schema migration and invalidating old MEV-biased vulnerability bundles.
- Flow overlays work in both renderers and add no RPC work when toggled, but
  dense reciprocal edges require aggregation, lane layout, and accessible
  details.
- The l2beat submodule remains untouched and must never be staged. The cache
  facade/import bridge is monorepo-owned and can be removed when discovery is
  fully ported.
