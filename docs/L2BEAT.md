High-level conclusion
The relevant L2BEAT “Disco UI” pieces are split across two packages:
1. packages/l2b — CLI + Express backend for DiscoUI.
- Starts the UI via l2b ui.
- Serves /api/* endpoints.
- Reads discovery outputs from packages/config/src/projects.
- Can run discovery-related terminal commands.
- Contains examples of trace usage, especially minters.
2. packages/protocolbeat — React/Vite frontend for DiscoUI.
- Implements /ui, /diff, and /address apps.
- Fetches the Express API via fetch('/api/...').
- Renders the smart-contract graph from discovery data.
- Has reusable graph rendering components, including a WebGL node/edge renderer.
3. packages/discovery — core smart-contract discovery and provider layer.
- Defines discovered contract output types.
- Reads/writes discovery configs.
- Fetches contract source, ABI, bytecode, storage, logs.
- Provides getDebugTrace(txHash) over debug_traceTransaction with callTracer.
For your MEV goal: DiscoUI already visualizes discovered smart-contract relationships, but not arbitrary execution traces as a first-class UI object. You can use it as a foundation, but MEV trace visualization will likely require adding a new API route and UI panel/app that transforms debug_traceTransaction call trees into nodes/edges.
Relevant repository map
1. DiscoUI backend: packages/l2b
Entry points
File
packages/l2b/src/commands/UI.ts
packages/l2b/src/implementations/discovery-ui/main.ts
packages/l2b/Dockerfile.disco-ui
.github/workflows/deploy-disco-ui.yml
UI.ts is minimal:
export const UI = command({
  name: 'ui',
  description: 'Launches DiscoUI.',
  args: {
    readonly: flag({ long: 'readonly' }),
  },
  handler: runDiscoveryUi,
})
The Dockerfile starts it with:
CMD ["node", "packages/l2b/dist/cli.js", "ui", "--readonly"]
So locally, the key command is roughly:
pnpm -C l2beat/packages/l2b dev ui
# or after build/install:
l2b ui
Default port is in main.ts:
const port = process.env.PORT ?? 2021
UI URL printed:
Discovery UI live on http://localhost:${port}/ui
2. DiscoUI frontend: packages/protocolbeat
Entry points
File
packages/protocolbeat/src/App.tsx
packages/protocolbeat/src/apps/createRouter.tsx
packages/protocolbeat/src/apps/discovery/DiscoveryApp.tsx
packages/protocolbeat/src/apps/diffovery/DiffoveryApp.tsx
packages/protocolbeat/src/apps/code/CodeApp.tsx
packages/protocolbeat/src/api/api.ts
packages/protocolbeat/src/api/types.ts
Registered modules:
const modules: AppModule[] = [
  DiscoveryAppModule,
  DiffoveryAppModule,
  CodeAppModule,
]
Main routes:
Route
/
/ui
/ui/p/:project
/ui/new
/ui/reports/config-health
/diff
/diff/:address1/:address2
/address
/address/:address
3. Discovery data source: packages/config/src/projects
The .discovery.json at repo root points DiscoUI to the discovery project data:
{
  "discovery": "./packages/config/src/projects",
  "cache": "./packages/config/cache/discovery.sqlite"
}
That means DiscoUI reads project configs and discovered.json files from:
l2beat/packages/config/src/projects
The key reader is:
const paths = getDiscoveryPaths()
const configReader = new ConfigReader(paths.discovery)
So for custom MEV-related experiments, you can either:
1. create/modify a discovery project in packages/config/src/projects, or
2. point .discovery.json to another discovery directory if you want an isolated workspace.
Current DiscoUI API surface
The API is not OpenAPI-documented in the repo. The canonical sources are:
- backend routes in packages/l2b/src/implementations/discovery-ui/main.ts
- attached routers:
- layouts/router.ts
- configs/router.ts
- templates/router.ts
- analyze/router.ts
- diffovery/router.ts
- frontend client in packages/protocolbeat/src/api/api.ts
Public/read endpoints
Health
GET /health
Returns:
OK
List projects
GET /api/projects
Implemented by:
getProjects(configReader)
Returns ApiProjectsResponse:
type ApiProjectsResponse = ApiProjectEntry[]
interface ApiProjectEntry {
  name: string
  addresses: string[]
  contractNames: string[]
}
Use this to discover available DiscoUI projects programmatically.
Example:
curl http://localhost:2021/api/projects
Get project graph data
GET /api/projects/:project
GET /api/projects/:project?maxDepth=2
Returns ApiProjectResponse:
interface ApiProjectResponse {
  entries: ApiProjectChain[]
}
interface ApiProjectChain {
  project: string
  initialContracts: ApiProjectContract[]
  discoveredContracts: ApiProjectContract[]
  eoas: ApiAddressEntry[]
  blockNumbers: Record<string, number>
}
This is the main endpoint used to render the contract graph in /ui/p/:project.
The frontend transforms this into graph nodes in:
packages/protocolbeat/src/apps/discovery/panel-nodes/NodesPanel.tsx
Important graph logic:
fields: toNodeFields(contract.fields)
toNodeFields() recursively extracts fields whose value is an address and turns them into edges.
So the current DiscoUI graph is based on:
discovered contract fields containing address values
not transaction traces.
Get project preview
GET /api/projects/:project/preview
Returns previewed permissions/contracts:
interface ApiPreviewResponse {
  permissionsPerChain: { chain: string; permissions: ApiPreviewPermissions }[]
  contractsPerChain: { chain: string; contracts: ApiPreviewContract[] }[]
}
Useful for high-level project contract/permission summaries, less useful for MEV traces.
Get contract source code
GET /api/projects/:project/code/:address
Returns:
interface ApiCodeResponse {
  entryName: string | undefined
  sources: { name: string; code: string }[]
}
Behavior depends on mode:
- non-readonly: reads code from disk
- readonly: fetches via Etherscan/flat source client
Useful for linking trace call nodes to source code.
Search project code
GET /api/projects/:project/codeSearch?searchTerm=...&address=...
Returns source code matches:
interface ApiCodeSearchResponse {
  matches: {
    name: string | undefined
    address: string
    codeLocation: {
      line: string
      fileName: string
      index: number
      offset: number
    }[]
  }[]
}
This can be used to locate function selectors, events, or MEV-relevant methods in already-discovered contracts.
Diff history
GET /api/projects/:project/diff-history?offset=0&limit=10
Returns parsed entries from diffHistory.md.
Useful for protocol evolution, not directly for transaction traces.
Layouts
GET /api/projects/:project/layouts
GET /api/projects/:project/layouts/:name
In writable mode:
PUT /api/projects/:project/layouts/:name
Content-Type: application/json
{
  "layout": { ... },
  "overwrite": true
}
Layouts are stored under:
packages/config/src/projects/<project>/layouts/<name>.json
The UI also stores transient layouts in browser localStorage under keys like:
layout/<projectId>
This is relevant if you want to programmatically pre-arrange MEV-related contract graphs.
Flat sources / source diff
GET /api/flat-sources/:address
Returns:
{
  name: string
  sources: Record<string, string>
}
Used by /diff.
Writable/config endpoints
These are only attached when l2b ui is not running with --readonly.
Read raw config
GET /api/config-files/:project
Returns:
interface ApiConfigFileResponse {
  config: string
}
Create config
POST /api/config-files
Content-Type: application/json
{
  "project": "my-mev-case",
  "initialAddresses": ["eth:0x..."],
  "overwrite": false,
  "maxDepth": 3,
  "maxAddresses": 100
}
Update config
PUT /api/config-files/:project
Content-Type: application/json
{
  "content": "..."
}
Config health
GET /api/config/health
GET /api/config/sync-status/:project
Template endpoints
Writable mode only for some operations:
GET /api/templates
GET /api/template-files?templateId=...
POST /api/template-files
POST /api/templates/create-shape
These matter if you want MEV contract classes/patterns represented as L2BEAT discovery templates.
Analyzer endpoints
Writable mode only:
GET /api/analyze/analyzers
POST /api/projects/:project/analyze/:address
POST body:
{
  "analyzerId": "some-analyzer",
  "entrypoint": "Contract.sol"
}
This uses AnalyzeClient and source files from discovered contracts. It is more about source analysis than runtime traces.
Terminal / SSE endpoints
Writable mode only.
These return EventSource streams:
GET /api/terminal/discover?project=<project>&devMode=true
GET /api/terminal/match-flat?project=<project>&address=<address>&against=projects
GET /api/terminal/download-all-shapes
GET /api/terminal/find-minters?address=<address>
The frontend wraps these as:
executeDiscover(...)
executeMatchFlat(...)
executeDownloadAllShapes()
executeFindMinters(...)
Implementation is in:
packages/l2b/src/implementations/discovery-ui/executeTerminalCommand.ts
It spawns shell commands and streams stdout/stderr as SSE messages.
For MEV work, /api/terminal/find-minters is notable because it already invokes trace analysis logic.
Execution trace support already present
The core trace abstraction is in packages/discovery.
Trace type
packages/discovery/src/discovery/provider/DebugTransactionTrace.ts
export interface DebugTransactionCall {
  from: string
  to: string
  input: string
  output?: string
  type: string
  value?: string
  calls?: DebugTransactionCall[]
  logs?: DebugTransactionLog[]
}
export const DebugTransactionCallResponse = v.object({
  calls: v.array(DebugTransactionCall).optional(),
})
This is a nested call tree suitable for visualization.
Provider method
packages/discovery/src/discovery/provider/IProvider.ts
getDebugTrace(transactionHash: Hash256): Promise<DebugTransactionCallResponse>
Low-level implementation
packages/discovery/src/discovery/provider/LowLevelProvider.ts
It uses:
debug_traceTransaction
with:
{
  tracer: 'callTracer',
  tracerConfig: { withLog: true }
}
So the trace includes nested calls and logs, provided your RPC supports debug_traceTransaction.
Existing trace-analysis examples
1. Minters command
Files:
packages/l2b/src/commands/Minters.ts
packages/l2b/src/implementations/minters/getMinters.ts
It:
1. gets token mint Transfer logs,
2. extracts transaction hashes,
3. calls provider.getDebugTrace(txHash),
4. walks nested calls,
5. detects senders responsible for mint events.
Relevant function:
export async function fetchAndAnalyze(provider: IProvider, txHash: string) {
  const trace = await provider.getDebugTrace(Hash256(txHash))
  const minters = traverseTrace(trace)
  return minters.map((minter) =>
    ChainSpecificAddress.fromLong(provider.chain, minter),
  )
}
This is a good pattern for MEV trace analysis.
2. EventTraceHandler
File:
packages/discovery/src/discovery/handlers/user/EventTraceHandler.ts
It:
1. finds transactions from events,
2. fetches debug traces,
3. walks calls,
4. extracts calldata matching a function selector,
5. decodes calldata with ABI.
This is very relevant if your MEV analysis wants to decode function calls inside traces.
How DiscoUI graph currently works
The project graph is driven by GET /api/projects/:project.
Backend builds this in:
packages/l2b/src/implementations/discovery-ui/getProject.ts
Frontend renders this in:
packages/protocolbeat/src/apps/discovery/panel-nodes/NodesPanel.tsx
The transformation is:
ApiProjectContract.fields -> address-valued fields -> graph edges
Important function:
function getNodeFields(
  path: string,
  value: FieldValue,
  bannedKeys: string[],
  bannedValues: string[],
): Field[]
If a field has:
value.type === 'address'
then it creates an edge:
{
  name: path,
  target: value.address,
}
So for trace visualization, you could either:
1. model traces as fake ApiProjectResponse fields, so existing graph renders them, or
2. build a dedicated trace graph app using the reusable graph renderer concepts.
Option 1 is faster but semantically awkward. Option 2 is cleaner.
Programmatic interaction with DiscoUI
Simple HTTP client usage
Once DiscoUI runs on port 2021, you can interact with it using normal HTTP.
Example TypeScript:
const base = 'http://localhost:2021'
const projects = await fetch(`${base}/api/projects`).then((r) => r.json())
const project = await fetch(`${base}/api/projects/arbitrum`).then((r) =>
  r.json(),
)
const code = await fetch(
  `${base}/api/projects/arbitrum/code/eth:0x1234...`,
).then((r) => r.json())
EventSource/SSE usage
For terminal-style endpoints:
const es = new EventSource(
  'http://localhost:2021/api/terminal/find-minters?address=eth:0x...',
)
es.onmessage = (event) => {
  console.log(event.data.replace(/\\n/g, '\n'))
}
es.onerror = () => {
  es.close()
}
Important caveat
The API is an internal UI API:
- no stable OpenAPI schema found,
- no versioning,
- duplicated types between l2b and protocolbeat,
- some endpoints are disabled in --readonly,
- some endpoints shell out to l2b commands.
So for automation, prefer wrapping it in your own adapter and pinning to a specific L2BEAT commit.
How to adapt this for MEV transaction visualization
Recommended architecture
Add a new “trace” feature alongside the existing discovery app.
Backend additions in packages/l2b
Suggested new files:
packages/l2b/src/implementations/discovery-ui/traces/router.ts
packages/l2b/src/implementations/discovery-ui/traces/getTrace.ts
packages/l2b/src/implementations/discovery-ui/traces/toTraceGraph.ts
Attach in main.ts:
attachTraceRouter(app, configReader)
Possible API:
GET /api/traces/:chain/:txHash
GET /api/traces/:chain/:txHash/graph
POST /api/traces/analyze
Example graph response:
interface ApiTraceGraphResponse {
  transactionHash: string
  chain: string
  calls: ApiTraceCallNode[]
  edges: ApiTraceCallEdge[]
  tokens?: TokenTransfer[]
  mevLabels?: MevLabel[]
}
interface ApiTraceCallNode {
  id: string
  depth: number
  from: string
  to: string
  type: string
  input: string
  selector?: string
  decodedFunction?: string
  value?: string
  contractName?: string
  addressType?: string
}
interface ApiTraceCallEdge {
  from: string
  to: string
  kind: 'CALL' | 'DELEGATECALL' | 'STATICCALL' | 'CREATE' | 'LOG'
}
Frontend additions in packages/protocolbeat
Suggested new app:
packages/protocolbeat/src/apps/trace/TraceApp.tsx
packages/protocolbeat/src/apps/trace/TracePage.tsx
packages/protocolbeat/src/apps/trace/TraceSearchPage.tsx
packages/protocolbeat/src/apps/trace/api.ts
Register in:
packages/protocolbeat/src/App.tsx
Add route:
/trace
/trace/:chain/:txHash
You can reuse patterns from:
- DiscoveryApp.tsx
- CodeApp.tsx
- DiffoveryApp.tsx
- api/api.ts
- node graph renderer under panel-nodes
MEV-specific data you probably need
For MEV transaction understanding, raw call trace is not enough. You likely want to enrich it with:
1. Call hierarchy
- CALL, DELEGATECALL, STATICCALL, CREATE
- from/to/value/input/output
2. Decoded calldata
- use discovered ABI where available
- fallback to 4byte/Sourcify signatures
3. Logs
- token transfers
- swaps
- sync/reserve updates
- liquidation events
- flashloan events
4. Balance/token deltas
- per address
- per token
- before/after or inferred from logs
5. MEV semantic labels
- arbitrage
- sandwich front-run/back-run
- liquidation
- backrun
- oracle update dependency
- builder/searcher/coinbase payment
6. Known contract metadata
- contract name from discovery
- proxy implementation
- address type
- ABI entries
- code link
DiscoUI can already provide contract metadata for discovered projects; the missing piece is joining transaction traces against this metadata.
Practical integration path
Phase 1 — Use existing API read-only
Start DiscoUI:
cd l2beat
pnpm -C packages/l2b dev ui
Then script against:
GET /api/projects
GET /api/projects/:project
GET /api/projects/:project/code/:address
GET /api/projects/:project/codeSearch
Use this to map MEV transaction addresses to known L2BEAT discovered contracts.
Phase 2 — Build trace fetcher outside UI
Before modifying DiscoUI, prototype using existing discovery provider patterns:
- copy the provider setup from Minters.ts
- call provider.getDebugTrace(txHash)
- walk DebugTransactionCallResponse
- emit your own graph JSON
The most relevant examples are:
packages/l2b/src/commands/Minters.ts
packages/l2b/src/implementations/minters/getMinters.ts
packages/discovery/src/discovery/handlers/user/EventTraceHandler.ts
Phase 3 — Add backend trace API
Add /api/traces/... to l2b.
Return trace graph JSON rather than raw Geth trace. Keep raw trace optional because it can be large.
Suggested endpoints:
GET /api/traces/:chain/:txHash/raw
GET /api/traces/:chain/:txHash/graph
GET /api/traces/:chain/:txHash/decoded
Phase 4 — Add frontend trace app
Add a TraceAppModule in protocolbeat.
Register routes:
const modules: AppModule[] = [
  DiscoveryAppModule,
  DiffoveryAppModule,
  CodeAppModule,
  TraceAppModule,
]
Use existing graph renderer ideas but create trace-specific nodes:
- contract/account nodes
- call edges
- event/log annotations
- token-flow overlays
- profit/loss summary panel
Key risks / constraints
1. RPC support
- debug_traceTransaction is not universally available.
- Public RPCs often disable it.
- You may need Erigon/Geth archive/debug node access.
2. Trace size
- MEV transactions can have very large call trees.
- UI needs pruning, clustering, and lazy expansion.
3. Address format
- L2BEAT uses ChainSpecificAddress, e.g. eth:0x....
- Raw traces use plain 0x....
- You must normalize addresses carefully.
4. DiscoUI API stability
- Internal API, no stable spec.
- Pin a commit if building automation around it.
5. Readonly mode
- Deployed DiscoUI uses --readonly.
- Many config/template/analyze/terminal endpoints are unavailable in readonly.
6. Current graph model mismatch
- Existing graph = static discovered contract references.
- MEV trace graph = dynamic transaction call/event/value flow.
- Reusing the renderer is possible; reusing ApiProjectResponse directly may become awkward.
Most relevant files shortlist
If you only inspect 15 files, inspect these:
packages/l2b/src/commands/UI.ts
packages/l2b/src/implementations/discovery-ui/main.ts
packages/l2b/src/implementations/discovery-ui/getProjects.ts
packages/l2b/src/implementations/discovery-ui/getProject.ts
packages/l2b/src/implementations/discovery-ui/getCode.ts
packages/l2b/src/implementations/discovery-ui/layouts/router.ts
packages/l2b/src/implementations/discovery-ui/configs/router.ts
packages/l2b/src/implementations/minters/getMinters.ts
packages/l2b/src/commands/Minters.ts
packages/protocolbeat/src/App.tsx
packages/protocolbeat/src/api/api.ts
packages/protocolbeat/src/api/types.ts
packages/protocolbeat/src/apps/discovery/DiscoveryApp.tsx
packages/protocolbeat/src/apps/discovery/panel-nodes/NodesPanel.tsx
packages/discovery/src/discovery/provider/DebugTransactionTrace.ts
packages/discovery/src/discovery/provider/IProvider.ts
packages/discovery/src/discovery/provider/LowLevelProvider.ts
packages/discovery/src/discovery/handlers/user/EventTraceHandler.ts
Bottom line
For your task, the best path is:
1. Use DiscoUI’s existing /api/projects/:project and code endpoints to map MEV transaction addresses to known contracts.
2. Reuse @l2beat/discovery’s getDebugTrace() support to fetch execution traces.
3. Add a dedicated trace API under packages/l2b/src/implementations/discovery-ui.
4. Add a dedicated trace frontend module under packages/protocolbeat/src/apps/trace.
5. Reuse the node/edge rendering ideas from panel-nodes, but define a trace-specific graph data model instead of forcing traces into ApiProjectResponse.
