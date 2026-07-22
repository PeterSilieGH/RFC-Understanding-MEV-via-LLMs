# Work package: Shared evidence, Panoramix, lazy Discovery subagents, vulnerability-first bundles, and graph flow overlays

Prepared 2026-07-22. Implements ADR-016 and supersedes D3 plus the eager bundle
preparation portions of `wp-mev-discovery.md`. The final Discovery verdict stays
in one parent context; nginx and Express limits remain unchanged.

## Outcome and non-negotiable invariants

When this package is complete:

1. Explorer inspection and DiscoUI incident discovery share persisted execution
   and contract evidence. A pane toggle never causes an RPC/source lookup.
2. Opening Discovery performs no bundle-analysis model turn and no
   decompilation. The parent requests bounded child analyses only for selected
   candidates it needs.
3. Verified source is preferred; otherwise the Analyze child receives a
   provenance-marked Panoramix artifact. Opaque is an explicit retryable last
   resort.
4. Vulnerability analysis starts from a security-specific prompt and typed
   bug/exploit schema, not the MEV system prompt or generic bundle fields.
5. The parent alone produces the final verdict in its persistent context. The
   user can deselect cached bundles and unresolved candidates before Discover.
6. Show/Hide are followed by Control/Funds controls. Their semantic edge
   overlays work through renderer-native DOM/SVG and WebGL implementations
   without changing layouts or performing upstream work.
7. Accepted parent/evidence/child jobs are server-owned. Workspace navigation
   and transport disconnects detach subscribers but do not stop, reset, or
   duplicate work.
8. Parent and child model turns share one total provider capacity. A waiting
   parent hands its permit to its direct child, so limit one is both safe and
   live.
9. The `l2beat/` submodule, generated `trace-*` projects, pi agent directory,
   and secrets are never staged or committed.

## Current-state anchors

- `packages/inspect/src/rpc.ts`, `classify.ts`, and `writeBlock.ts`: block-wide
  `trace_block` fetch and persistence to `classified_traces`, `transfers`, and
  `swaps`.
- `apps/trace-api/src/provider.ts`: completed-value-only in-memory cache around
  `debug_traceTransaction`; concurrent cold callers are not coalesced.
- `apps/trace-api/src/workspace.ts`: graph/workspace preparation reads every
  incident leg and launches bounded l2b discovery.
- `apps/trace-api/src/etherscan.ts`: separate process-local positive/negative
  source cache.
- `apps/agent-api/src/server.ts`: compact refs are resolved with a fresh
  `eth_getCode`; `/bundles/prepare` eagerly analyzes every missing codehash;
  `/discovery` then runs one persistent parent over selected bundles.
- `apps/agent-api/src/discoveryContracts.ts`: explicitly unverified l2b entries
  bypass source loading and become opaque bundles.
- `apps/agent-api/src/store.ts`: bundles are considered current solely by
  `(codehash, kind)` and use one generic column shape.
- `apps/agent-api/src/runner.ts` and `scheduler.ts`: one global scheduler wraps
  a whole parent turn; persistent tool callbacks are created with the first
  request's event/signal closures.
- `apps/disco/.../bundle-preparation-store.ts` and `DiscoveryPanes.tsx`: pane
  activation starts navigation-stable eager preparation.
- `packages/trace-graph/src/graph.ts`: typed call edges, native value, and token
  transfers are already in the graph payload.
- `apps/disco/.../panel-nodes`: dependency/call relationships are encoded as
  node fields and rendered independently in DOM and WebGL paths.
- Local edits currently visible in
  `l2beat/packages/discovery/src/discovery/provider/LowLevelProvider.ts` cannot
  ship: the parent repository records only a dirty submodule gitlink. Required
  log-range behavior must be ported to a monorepo-owned RPC adapter and covered
  by monorepo tests.

## Delivery plan

### E0 — Baseline, fixtures, and request accounting (S)

- Choose at least three stable fixtures:
  - an inspected multi-leg incident with decoded swaps/transfers;
  - a verified proxy plus implementation; and
  - an unverified runtime contract, initially
    `eth:0x678B6D7E6d79afbb1bEB45afC384bea2084fF6D0` if it remains available at the
    pinned incident block.
- Add test-visible counters around upstream RPC methods, source-provider calls,
  decompiler launches, and model child launches. Counters/logs must identify
  cache hit/miss/in-flight sharing without logging secrets or payload bodies.
- Record current cold/warm counts and latency for concurrently loading graph,
  workspace, and Discovery. Include the exact block/hash and stack image SHAs in
  the work-package verification note.
- Verify the pinned l2b command's configurable RPC URL and `--timestamp`
  behavior. Do not assume or invent an Etherscan/explorer-base override: l2b is
  the source producer through its existing explorer/cache support. Any required
  RPC mediation uses a monorepo-owned adapter and no submodule edit.

Acceptance:

- A repeatable automated fixture proves the present duplicate call count before
  optimization and can fail if a later change reintroduces it.
- No throwaway script is added; fixtures live in package tests or `e2e/`.

### E1 — Shared evidence schema and package (L)

- Add an append-only `@mev/db` migration ledger with immutable version/checksum
  records. Run each migration transactionally under one fixed Postgres advisory
  lock so simultaneous service boot cannot apply or observe a partial schema.
- Add migrations for normalized execution artifacts, deployment/codehash
  mappings, verified/negative source artifacts, token metadata, and
  decompilation artifacts.
- Include chain id, block number/hash, producer/schema version, completeness,
  timestamps, error class, retry metadata, and content hashes. Store Wei and raw
  token amounts as `NUMERIC`/decimal strings or `bigint` in TypeScript, never
  `number`.
- Add `packages/evidence` with strict ESM TypeScript types, validation, and
  transactional read/write adapters. Do not make consumers query another
  service's private table shape.
- Define retention: inspector-backed normalized calls are durable; raw debug
  payloads are not retained after normalization; retryable negative/decompiler
  failures expire; content-addressed source/decompiler bodies are shared.
- Make reorg handling explicit: a different block hash invalidates the mapping
  for the affected snapshot without overwriting the old artifact silently.

Acceptance:

- Migration tests cover fresh and existing databases, checksum mismatch,
  rollback on failure, idempotence, and two concurrent migrators contending on
  the advisory lock.
- Content-addressed artifacts round-trip byte-exactly; conflicting hashes fail
  rather than overwrite.
- A snapshot upgrade maps one address to two codehashes without cross-serving
  the wrong source/bundle.

### E2 — Execution reuse and trace replay coalescing (L)

- Extend inspector persistence/adaptation with exact call kind, selector for
  unknown calls, parent path, sizes, subtrace count, native value, gas,
  error/revert, and completeness/provenance fields needed by `TraceGraph v2`.
  Persist/index the receipt logs already fetched by inspection so committed
  log-based transfers do not require callTracer log capture.
- Add a DB-to-`TraceGraph v2` adapter and a versioned response envelope.
  `GET /api/traces/:hash/graph` uses inspected trace plus receipt evidence first
  and reports source, schema version, and completeness. Clients reject unknown
  major versions rather than guessing.
- Keep debug callTracer only for a missing/corrupt normalized execution artifact
  or an explicit raw-detail request. Missing optional call-scoped-log detail is
  not a fallback trigger. Normalize/persist bounded fallback results; do not
  expose or store unlimited raw traces by default.
- Add `Map<traceKey, Promise<...>>` in-flight coalescing before the RPC call;
  clear it in `finally`, cache only successes, and preserve the 60-second
  timeout.
- Export one `traceGraphQueryOptions()` from DiscoUI and use it in TracePanel,
  TraceListPanel, workspace resolution, and Discovery trace context instead of
  direct duplicate fetches.

Acceptance:

- A concurrently mounted graph and workspace invokes the mocked debug provider
  exactly once on a cold uninspected tx.
- A rejected shared promise reaches both callers, leaves no poisoned cache, and
  a later call retries once.
- For an inspected fixture, graph/workspace/Discovery perform zero
  `debug_traceTransaction` calls and reconstruct the same node hierarchy,
  call-kind labels, value, errors, and receipt-backed transfers expected from
  the fixture.
- A request for ordinary Funds data with call-scoped logs absent still performs
  zero debug calls; only the explicit raw-detail route may opt into one.
- Warm behavior remains zero external trace calls after a trace-api restart.
- Large-trace tests stream/normalize within configured memory and response
  bounds; neither nginx nor Express limits change.

### E3 — Runtime, source, and token deduplication (L)

- Make trace-api the contract-evidence gateway. Add internal snapshot-aware
  endpoints for candidate catalog, code/source artifacts, and bulk token
  metadata. Public code/meta endpoints read the same store.
- Retain runtime bytes from the first snapshot `eth_getCode`, calculate the
  codehash once, persist it, and pass artifact references through workspace and
  agent APIs. Remove agent-api's direct latest-block `getCode` identity path.
- Add a monorepo-owned discovery runner. Derive the incident block timestamp,
  invoke the pinned l2b command with `--timestamp`, and record the requested
  block number/hash and resolved timestamp. Refuse to mark imported evidence
  snapshot-complete when those do not agree.
- Point l2b's supported RPC configuration at a narrow monorepo-owned adapter.
  Port bounded `eth_getLogs` pagination and snapshot-aware code/storage caching
  into that adapter, including focused tests equivalent to the local
  `LowLevelProvider.ts` prototype. Pass other allowlisted RPC methods through
  without claiming they are cached. Never modify or stage `l2beat/`.
- Keep l2b as the source producer through its existing explorer/cache behavior;
  do not add an unsupported Etherscan facade. After an atomic successful run,
  controlled-import validated `discovered.json` and `.flat` artifacts into
  normalized source/ABI/proxy/implementation evidence. Validate project-root
  paths, snapshot, address, runtime codehash, and content hash before copying;
  do not read its live SQLite cache or generated files concurrently from
  another process.
- Persist unverified/source failures with bounded negative TTL, provider and
  retry reason. Concurrent identical source lookups share one promise.
- Move explorer token symbol/decimals writes behind the bulk durable metadata
  adapter. Graph labels reuse it and show a shortened address when absent.

Acceptance:

- Two deployments with the same snapshot runtime code produce one reusable
  code artifact and one downstream analysis identity.
- The instrumented cold workspace plus agent catalog performs one upstream
  `eth_getCode` through the RPC adapter and one l2b-owned source-provider lookup
  per unique snapshot deployment; warm/restart behavior performs zero. trace-api
  makes no parallel Etherscan request for the same candidate.
- An unverified address produces one negative source lookup inside its retry
  window and no repeated Etherscan call across service restart.
- Agent-api receives neither full source in the browser request nor an RPC URL
  for identity resolution.
- A discovery fixture proves l2b was invoked with the incident timestamp and an
  upgrade fixture does not import `latest` implementation/source into an older
  incident.
- Bulk flow labels cause no per-edge `eth_call` and match Explorer token labels.

### E4 — Sandboxed Panoramix sidecar and trace-api adapter (L)

- Add `apps/decompiler-api`: a minimal Unix-socket worker plus the Python
  Panoramix runner. trace-api exclusively owns the mounted socket and evidence
  API; the call path is `agent-api -> trace-api -> decompiler-api`, never a
  direct agent-api/decompiler connection. Pin upstream revision
  `23edd11058abafcba9340afc768d2aa9274c0b62` and archive/dependency hashes.
- Add its Dockerfile and Compose service with no network, no secret env/mounts,
  read-only rootfs, dropped capabilities, non-root user, health check,
  concurrency one, CPU/memory/PID limits, and bounded shared socket permissions.
  Mount a private tmpfs scratch/cache path and set `XDG_CACHE_HOME` to that
  tmpfs; do not let Panoramix write under the image user's home directory.
- Validate hex/runtime size before spawning. Send bytecode via stdin/IPC,
  terminate the process group on timeout/cancellation, cap stdout/stderr, strip
  ANSI/control characters, and classify complete/partial/timeout/unsupported/
  error.
- Adapt the pinned Panoramix library's structured decompilation/function and
  problem results into a versioned JSON envelope before text rendering; do not
  make CLI stdout scraping the artifact contract. Build the generalized
  `get_function_code` index from that structure and preserve failed functions,
  selectors, locations, and warnings.
- Cache by `(codehash, engine, revision, optionsHash)` and coalesce in-flight
  requests. Negative results carry retry policy; a changed revision is a new
  key.
- Do not implement the old prototype's Gemini/Solidity rewrite.

Acceptance:

- Container inspection proves no RPC/Etherscan/pi/model secret and no outbound
  network; only trace-api can open the socket, `XDG_CACHE_HOME` resolves to the
  tmpfs, and decompilation from raw bytecode still succeeds.
- A known unverified fixture becomes `decompiled` (complete or partial) and its
  Analyze prompt can retrieve at least one recovered function body.
- Two addresses sharing a codehash launch Panoramix once.
- Timeout, oversized input/output, malformed bytecode, unsupported opcode, and
  cancellation produce bounded typed results and leave the worker healthy.
- A formatting change to Panoramix's human-readable output does not break the
  structured function/problem adapter fixture.
- Compare recovered selectors, storage/control hints, and external calls
  against a verified-source corpus, including post-Shanghai `PUSH0`. Report
  recall/limitations; do not assert semantic equivalence.
- Dependency/license review and the upstream MIT notice are recorded.

### E5 — Versioned bundle schemas and migration (L)

- Replace existence-only cache validity with `(codehash, kind, artifact,
  schemaVersion, promptVersion, analyzerVersion)` validity. Preserve address
  aliases separately.
- Store discriminated `mev` and `vuln` payloads as validated JSONB plus common
  provenance/source-quality columns. Add a real `bundle-analysis` run kind and
  parent/child correlation instead of recording autonomous work as a manual
  `analyze-code` run.
- Define the vulnerability schema from ADR-016 §4. Keep deployment-specific
  state/economics out of codehash-addressed payloads.
- Mark old generic vulnerability bundles stale. Mark exactly the deterministic
  opaque rows (`role='Unverified runtime contract'` and no provenance) as
  retryable fallback; do not delete unrelated user/model output by a broad
  predicate.
- Strictly reject missing/extra/inconsistent fields and oversized bundles.

Acceptance:

- Schema tests cover both kinds, version invalidation, decompiled provenance,
  proxy/implementation identities, and strict malformed-output rejection.
- Existing opaque rows no longer suppress Panoramix after migration.
- An incident's gas/tip/state cannot appear in a reusable code bundle.

### E6 — Lazy child-analysis orchestration (XL)

- Replace `/api/agent/bundles/prepare`'s model work with a catalog/cache-only
  operation. It may resolve cached evidence references but must not hydrate full
  source, decompile, or invoke a model.
- Extend the parent Discovery request with selected candidate ids and a stable
  catalog fingerprint. Server-side candidate allowlists bind ids to incident,
  snapshot, kind, and artifact; never trust model-supplied address/code.
- Add `request_contract_analysis(candidateId)` to parent sessions. The schema
  has no free-form focus, address, code, prompt, or kind argument. Implement the
  cache fast path, evidence resolution through trace-api, in-flight child dedup,
  strict bundle validation, persistence, compact tool result, and typed
  non-fatal failure.
- Replace independent parent/child pools with one total provider-capacity
  coordinator governed by `AGENT_MAX_CONCURRENCY`, plus an optional child-mix
  cap that cannot increase the total. A parent invoking its direct child
  atomically hands its permit to the child, waits without a permit, and
  reacquires the returned permit before resuming. Enforce depth one, per-parent
  call quota, per-child timeout, bytes/tokens/tools limits, and explicit user
  cancellation.
- Reusable children receive only versioned code artifacts and bounded function
  lookup. They receive no `cast`, RPC, snapshot state, or parent-analysis tool.
  Add a separate parent/session-scoped snapshot-observation tool for allowed
  read-only `cast` evidence; key its results by incident block hash and never
  copy observations into a codehash-addressed bundle.
- Refactor persistent session cache entries into holders whose per-turn
  `emit/signal/toolLog/quota` is installed and cleared around each serialized
  turn. No tool callback may retain a closed response.
- Persist consulted bundle revisions and compact child tool results with the
  session. Rehydration after restart reconstructs the same parent evidence;
  dynamic bundle creation does not invalidate the parent mid-turn.
- Represent accepted parent turns, evidence resolution, and children as durable
  server-owned jobs. HTTP/NDJSON disconnect and workspace navigation detach a
  subscriber without aborting the job. Store a replay cursor and terminal state
  so reattachment neither restarts nor loses progress. Only an explicit cancel
  or shutdown policy aborts work; all permit transfer/return paths clean up in
  `finally`.
- Stream structured `subagent` queued/started/cache-hit/bundle/done/error events
  and authoritative parent context usage. Child reasoning is not copied into
  parent history.

Acceptance:

- Opening/switching a Discovery kind produces zero decompiler and zero model
  child launches.
- A parent at main scheduler limit 1 can request a child and complete: a
  regression test must fail if permit handoff deadlocks or briefly exceeds one
  provider turn. Two simultaneous parents at limit 2 also complete while a
  gauge proves parent plus child provider turns never exceed two.
- Concurrent identical requests launch one child; a later request is a durable
  cache hit. Quota, unauthorized candidate, recursion, timeout, and malformed
  output are rejected without killing the parent verdict.
- A deselected candidate cannot be requested by the tool.
- Free-form focus/address/kind arguments are schema-invalid, and a child has no
  RPC/cast or recursive tool surface.
- A transport disconnect/navigation preserves the same running job and permits;
  reattachment replays progress without a second child launch. Explicit cancel
  does not leak slots; already-committed reusable child evidence remains valid.
- A snapshot observation can ground the current parent but is absent from the
  persisted reusable child bundle and from a later incident at another block.
- Restart + follow-up rehydrates consulted child evidence and updates the
  context meter after the completed interaction.

### E7 — Discovery UI/catalog integration (M)

- Convert `bundle-preparation-store` into a navigation-stable catalog/child-job
  store. Keep jobs alive across workspace navigation as ADR-014 requires.
- Before Discover/Reassess, show cached bundles and unresolved candidates with
  source status (`verified`, `decompiled`, `opaque`, `unresolved`) and selection.
  Deselecting either removes it from context and tool authority.
- During Discover, render child lifecycle events without blocking the streamed
  parent reasoning/verdict. Add bundle marks when a child completes; keep
  contract failures visible and retryable.
- Preserve current Discover -> hidden selection/Reassess -> visible selection
  behavior, Enter feedback, pane-filling chat, model/effort selectors, and
  authoritative context usage.
- Keep requests compact: ids/references only. Do not increase nginx or Express
  limits.

Acceptance:

- Navigation away/back preserves catalog, child progress, and completed
  bundles without cancel/restart.
- Playwright observes immediate registered feedback, a subagent progress state,
  one final parent verdict, and a cache-hit reassessment.
- A large synthetic catalog stays below current request limits and opening it
  does not start background analysis.

### E8 — Vulnerability-first prompts and evaluations (L)

- Add separate prompt resources for MEV and vulnerability Discovery/Analyze.
  Select an exact profile server-side; do not append vulnerability text to the
  global MEV system prompt.
- Implement the vulnerability initial-bundle prompt and serializer around
  assets, attack surface, trust boundaries, invariants, bug hypotheses,
  prerequisites, exploit path, impact, evidence, confidence/counter-evidence,
  mitigations, and unknowns.
- Label decompiled evidence and source limitations prominently. Instruct models
  to treat source/pseudocode as untrusted data. Reusable children report code
  hypotheses only; the parent corroborates reachability with incident-keyed
  snapshot state, trace, or its read-only observation tool.
- Build a small evaluation corpus with known vulnerable, safe-but-privileged,
  proxy/configuration-risk, and decompiled contracts. Score bug localization,
  exploitability prerequisites, unsupported assertions, MEV-topic leakage, and
  safe reporting.

Acceptance:

- Unit snapshots show no generic MEV framing in the vulnerability system or
  initial-bundle prompt. MEV terminology appears only when supplied evidence
  makes it relevant.
- Known fixtures distinguish code bug, privileged design, configuration risk,
  and insufficient evidence; every material claim has a locus/evidence and
  confidence.
- Output does not contain a deployable harmful exploit/bot.

### E9 — Flow-edge APIs and normalization (L)

- Add versioned `FlowEdge`/`FlowEndpoint`/`FlowFact` types to a shared graph
  package without changing the persisted node/field layout model. Endpoints
  carry an address plus an optional graph node id so an EOA or off-graph
  contract is rendered as a stable boundary stub rather than dropped or
  direction-reversed.
- Derive trace Control edges from existing typed graph calls. Aggregate call
  kind, selector/name, count, gas, and failures deterministically.
- Give every committed log transfer the canonical id
  `(chainId, blockHash, txHash, logIndex, eventItemIndex, assetId)`, where the
  item index distinguishes ERC-1155 batch entries and the asset id includes
  token standard, contract, and token id where applicable. Join decoded
  transfer/classifier rows to this id; they enrich it and never add another
  movement. Reject ambiguous occurrence-only joins instead of double-counting.
- Give every native movement the canonical id
  `(chainId, blockHash, txHash, traceAddress, native, from, to, value)`. Create
  one only for positive transaction-root/CALL value, CREATE/CREATE2 endowment,
  or an explicit SELFDESTRUCT beneficiary transfer. CALLCODE, DELEGATECALL, and
  STATICCALL do not imply a native movement.
- Map native movement trace addresses to their exact call frames. Mark one
  `committed` only when that frame and every ancestor committed; otherwise mark
  it `attempted`. Preserve actual asset address direction independently from
  call direction. Join swaps by canonical movement id or exact trace/log
  provenance as protocol/group annotations only, never additional transfers.
- Add a traversal-safe project-control endpoint that reads discovery output
  from the configured project root only. Normalize controller -> target,
  permission, delay, condition, `via`, and direct/inherited provenance.
- Return bulk token labels from E3. Project Funds returns a typed unsupported
  capability without RPC.
- The base graph may omit flow facts. On first activation, fetch one versioned,
  cacheable internal flow payload through shared query options. The endpoint may
  read only Postgres evidence or validated discovery files and must not invoke
  RPC, source, token, or decompiler providers.

Acceptance:

- Unit tests cover root/CALL/CREATE/SELFDESTRUCT native value; non-movements for
  CALLCODE/DELEGATECALL/STATICCALL; permission direction/via/delay; ERC-20,
  ERC-721, and ERC-1155 log ids; EOA/off-graph endpoints; reciprocal/parallel
  facts; swap/classifier non-double-counting; ancestor-reverted attempted flows;
  unknown tokens; and malformed or ambiguously matched transfer logs.
- Project-name traversal/symlink escape is rejected. The project endpoint reads
  disk only and never invokes source/RPC.
- The first toggle may perform one internal cacheable request. Repeated toggles
  reuse it, and upstream counters remain exactly unchanged throughout.

### E10 — Control/Funds controls and renderer-native overlays (L)

- Add Control (`IconTrace`) and Funds (`IconSwap`) directly beside Show/Hide in
  the same control group. Use visible labels, `aria-pressed`, keyboard focus,
  default-off state, and explanatory disabled/error titles.
- Build one shared semantic selector/aggregation layer and two renderer-native
  views: SVG paths/text in the DOM graph and WebGL lines/arrowheads with its
  renderer-owned label/detail layer in the WebGL graph. Do not place one SVG
  coordinate surface over both renderers. Each recomputes anchors from current
  boxes, offsets reciprocal/parallel lanes, filters hidden endpoints, renders
  boundary stubs, and stays outside undo/layout persistence.
- Implement measured level-of-detail thresholds: full fact labels for small
  visible graphs; aggregate edge labels with focus/hover details for medium
  graphs; and selected/incident-relevant aggregate edges up to a configured cap
  for large graphs. Surface aggregation/truncation in the legend and expose the
  hidden details accessibly.
- Style and label at least: observed call, configured permission, committed
  funds, and attempted/reverted funds. Add a route-aware legend using shape/text
  as well as color. Collapse dense labels (`CALL xN`, `3 transfers / 2 assets`)
  while retaining full accessible tooltip/details.
- Trace routes enable both layers. Ordinary project routes enable Control and
  disable Funds with “requires a transaction or incident scope.”

Acceptance:

- Component tests cover button placement/state, hidden/off-graph endpoints,
  dragged-node anchors, reciprocal lanes, every LOD transition, configured edge
  caps, dense labels, and no layout/history mutations in each renderer.
- Playwright verifies Control/Funds beside Show/Hide, labels and legend, toggle
  off, hidden nodes, project Funds disabled, and identical behavior with the
  experimental WebGL renderer on/off.
- Browser request accounting permits at most one lazy internal flow request per
  versioned query key; repeated toggles add none. RPC/source/token/decompiler
  counters remain exactly unchanged while toggling repeatedly.

### E11 — Rollout, cleanup, and operating documentation (M)

- Add temporary rollout controls to root `.env.example` and config validation:
  - `DISCOVERY_LAZY_ANALYSIS`;
  - `TRACE_GRAPH_EVIDENCE_SOURCE=legacy|prefer-db|db-only`;
  - `PANORAMIX_ENABLED` and bounded timeout/input/output settings; and
  - optional `AGENT_CHILD_MAX_CONCURRENCY`, validated not to exceed the shared
    `AGENT_MAX_CONCURRENCY` total.
- Start with shadow comparison for DB-built vs debug-built graphs, then
  `prefer-db`, then remove the legacy eager preparation/model path after the
  acceptance suite and rollback window pass.
- Expose health/status without secrets: evidence schema/version, cache metrics,
  migration-ledger version, shared parent/child capacity and permit owner,
  decompiler capacity, and last error class.
- Document cache invalidation/retry operations, Panoramix limitations, storage
  retention, capacity tuning, and how to prove no duplicate upstream calls.
- Amend ADR-012/014 and `wp-mev-discovery.md` with concise supersession links;
  do not rewrite their historical decisions.

Acceptance:

- `docker compose config --quiet` passes with defaults and Panoramix receives no
  secret-bearing environment/mount.
- Rollback from `prefer-db` to legacy graph source does not invalidate persisted
  evidence or sessions.
- Eager `/bundles/prepare` model work is unreachable after flag removal; no dead
  code silently keeps generating bundles.

## Sequencing and parallelism

1. E0 must land first so optimization claims are measurable.
2. E1 lands the migration ledger, schema, and evidence interfaces before any
   service writes the new artifacts.
3. E2 and E3 proceed in parallel on those interfaces. E3 must finish the
   snapshot runner, controlled l2b import, and trace-api ownership before E4
   connects the decompiler socket.
4. E5 can proceed after E1. E4 and E5 must finish, and E8 must freeze the
   vulnerability prompt/output contract, before E6 accepts decompiled,
   versioned child output.
5. E7 follows E6's durable job/event contract; it must not invent browser-owned
   lifecycle semantics in parallel.
6. E9 starts only after E2 supplies versioned trace/receipt evidence and E3
   supplies token/source identities. E10 follows E9's flow contract and may
   overlap E7.
7. E11 follows full runtime verification of all implementation slices.

Do not connect a second independent child pool or keep the existing parent
permit while waiting as a shortcut. Shared-capacity handoff, server-owned job
reattachment, and stale persistent-tool closure tests are release blockers.

## Required verification before merge

Follow `AGENTS.md`: static checks support verification but do not replace
runtime observation.

### Static and package checks

- Focused Vitest suites for `@mev/inspect`, `@mev/evidence`,
  `@mev/trace-graph`, agent-api scheduler/bundles/store, trace-api, and DiscoUI
  components.
- `npx tsc --noEmit` or package builds for every changed package/app.
- `npx biome check <changed apps/packages files>`; do not run a repo-wide check
  through the l2beat submodule.
- `docker compose config --quiet` and image build for decompiler-api,
  trace-api, agent-api, explorer-api when changed, and disco-web.

### Runtime/API checks

- Rebuild and restart every changed service; confirm the containers run the new
  image/code.
- Curl the real trace graph/evidence, project-control, catalog, Discovery NDJSON,
  and health endpoints through their deployed routes.
- Observe upstream counters for the same cold concurrent graph/workspace load,
  inspected DB-first load, warm restart, negative source hit, Panoramix cache
  hit/timeout, child cache/dedup, and repeated flow toggles.
- Run the real parent/session-scoped snapshot-observation tool with read-only
  `cast` and observe a successful, incident-block-keyed tool event. Prove the
  reusable Analyze child has no cast/RPC tool, and reject a write/broadcast
  subcommand on every surface.

### Browser checks

Extend `e2e/disco.spec.ts` and use Playwright against the rebuilt compose stack:

- opening Discovery starts no eager model/decompiler work;
- a selected candidate is lazily analyzed and the parent produces one verdict;
- deselection removes analysis authority;
- navigation and transport reconnection reattach to the same server job without
  cancelling or duplicating a child;
- vulnerability output is bug/exploit-first;
- context usage changes after a follow-up;
- Control/Funds render and toggle in DOM and WebGL modes with at most one lazy
  internal flow request and zero upstream work; and
- large incidents remain within existing request limits.

Use Playwright for GUI claims, not curl. Curl remains appropriate for service
API/NDJSON evidence.

## Completion and version-control gate

After every required check passes:

1. inspect `git status` and `git diff --check`;
2. confirm `l2beat`, pi directories, generated projects, secrets, and unrelated
   user changes are not staged;
3. commit the scoped implementation on its dedicated feature branch using the
   repository's current commit-message/trailer rules;
4. push the feature branch; and
5. create a merge request targeting `main`, including measured cold/warm call
   counts, Panoramix limitations, child-scheduler evidence, and Playwright
   results.

Do not commit, push, or open the merge request while any required verification
is failing. This documentation-only package does not itself authorize those
version-control actions before implementation and verification.

## Out of scope

- Raising request body limits.
- Replacing block-wide `trace_block` inspection or MEV detectors.
- A recursive/multi-level agent tree or multiple final verdict contexts.
- Write-capable cast, transaction broadcasting, or deployable exploit/bot
  generation.
- Treating decompiled pseudocode as verified source or automatically rewriting
  it as Solidity.
- Inferring project fund flow from balances or address-valued configuration.
- Modifying or committing the `l2beat/` submodule.
