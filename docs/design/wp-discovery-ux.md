# Work package: DiscoUI — Discovery UX refinements (pane split, tabs, reasoning, gas/tip context, foundry grounding)

Prepared 2026-07-22. DiscoUI / agent track only (`apps/disco`,
`apps/agent-api`); reads one endpoint the explorer already serves
(`GET /api/mev/tx/:hash`), no explorer-track changes. Decisions in **ADR-013**;
builds on ADR-012 (autonomous typed bundles, persistent sessions, context
budgeting) and ADR-009 (agent-api). Independent of wp-mev-discovery (ADR-012
implementation) and wp-explorer-v2.

## Current-state anchors

- **Discovery pane** = `apps/disco/src/apps/discovery/panel-agent/DiscoveryPanes.tsx`.
  A shared `prepare()` streams bundles (`streamPrepareBundles`); one
  `DiscoveryKind` per active research kind renders context meter + bundle list
  (`max-h-32 overflow-auto`) + verdict/turns + a textarea with an **[Ask]**
  button. Rendered **inside** `PreviewPanel` above the stock preview.
- **Preview panel** = `panel-preview/PreviewPanel.tsx`: renders `<DiscoveryPanes>`
  then `PermissionsPreview`/`ContractsPreview` (+ "show only selected"). Panel id
  `preview`, label **"Discovery"** (`multi-view/config.tsx` `PANEL_LABELS`).
- **Panel registry** = `multi-view/config.tsx`: `PANEL_IDS`, `PANELS`,
  `PANEL_LABELS`, `dockingConfig`/`traceDockingConfig` default layouts.
- **Top bar** = `multi-view/TopBar.tsx` `useIncidentIdentity`: incident kind +
  `fmtAmount(profit)` (per-leg `getTxMev` fan-out to find the profit entry).
- **agent-api** = `apps/agent-api/src/server.ts`: `discoveryBase()` builds the
  base prompt (bundles + trace tree + swaps); `DISCOVERY_PROMPTS` per kind;
  `/api/agent/discovery` runs the persistent session via `runAnalysis`.
- **Runner** = `apps/agent-api/src/runner.ts`: `runSessionTurn` subscribes to
  `session.subscribe` and emits `delta` on `message_update`/`text_delta`. Tools:
  `get_function_code`, `flag_important_nodes`.
- **pi harness** (`@earendil-works/pi-agent-core@0.79.1`) emits
  `thinking_start` / `thinking_delta` / `thinking_end`; sessions carry a
  `ThinkingLevel` (`setThinkingLevel`, clamped to model capability).
- **Incident economics already computed**: `apps/explorer-api/src/mev.ts` reads
  `miner_payments` (`gas_price`, `gas_used`, `base_fee_per_gas`,
  `coinbase_transfer`) and exposes them on `GET /api/mev/tx/:hash`
  (`coinbaseTransferWei`, `gasPriceWei`, `gasUsed`, `coinbaseTransferEth`).
- **Stream event unions**: `apps/disco/src/api/agent.ts` `AgentStreamEvent`;
  `runner.ts` `RunEvent`. Both extended in U6.

## Tasks

Ordered roughly by independence; U1/U4/U5/U6-fe are pure frontend, U7/U8 span
both, U2/U3 are docking wiring.

### U1 — Remove profit from the top bar (XS) — ADR-013 §1

> "remove the token profit display from the discoUI top bar."

In `TopBar.tsx` `useIncidentIdentity`: keep the incident `kind` + short tx hash,
**delete the `profit` lookup and the `fmtAmount(profit)` span**, and remove the
now-unused per-leg `mevQueries` (`getTxMev`) fan-out and the `FormattedAmount`
import if it becomes unused. Bar shows `kind · 0xabcd…`.

### U2 — Split preview artifact into its own pane (S) — ADR-013 §2

> "move preview artifact from Discovery pane into a separate preview pane."

- In `PreviewPanel.tsx`, drop `<DiscoveryPanes>`; the file now renders **only**
  the stock permissions/contracts artifact.
- Add a new component (e.g. `panel-agent/DiscoveryPanel.tsx`) that renders
  `<DiscoveryPanes project={project} />` as a standalone panel body.
- In `config.tsx`: keep `preview` → the Discovery panel body, label stays
  **"Discovery"**. Add a new panel id **`contracts`** → `PreviewPanel`, label
  **"Preview"**, `IconWebApp` (move the icon; give Discovery a fitting icon e.g.
  `IconStamp`/`IconSigma`). Add `contracts` to `PANEL_IDS`.
- Seed both default layouts (`dockingConfig`, `traceDockingConfig`) so the new
  Preview panel is reachable without manual docking. Storage keys unchanged
  (ADR-013 consequences: persisted `preview` still resolves to Discovery).
- **Trap:** `isValidKey`/`isPanelId` derive from `PANEL_IDS`; adding `contracts`
  there is enough for validation and the panel-type switcher.

### U3 — Research kinds as hideable tabs (M) — ADR-013 §3

> "turn MEV Discovery and Vulnerability Discovery in the Discovery pane into
> tabs, so they can be hidden via click."

In `DiscoveryPanes`:
- Keep the shared prepare banner (preparing/error/warnings) at the top.
- Render a **tab bar** with one tab per active kind (`kinds`). Local state holds
  the active tab; **clicking the active tab toggles collapse** (hide the
  `DiscoveryKind` body). Persist the collapsed/active choice in component state
  (optionally `localStorage` for stickiness — not required).
- Render only the active kind's `DiscoveryKind` (others unmounted or hidden).
  The context meter lives inside `DiscoveryKind`, so it follows the active tab.
- One active kind still renders a single tab (consistent collapse affordance).

### U4 — Enter to send, Shift+Enter newline; remove [Ask] (XS) — ADR-013 §4

> "remove [ask] button for follow up of discovery (mev and vuln) chats. instead
> use enter to input and shift+enter for newline in prompt window."

In `DiscoveryKind`'s follow-up textarea: delete the `<Button>Ask</Button>`; add
`onKeyDown` — on **Enter without Shift**, `preventDefault()` and submit the
trimmed question (reuse the existing guard: no-op if `running` or empty),
clearing the input; **Shift+Enter** falls through to a newline. Update the
placeholder to mention "Enter to send · Shift+Enter for newline". Optimistically
append the question with an aria-live **Follow-up registered** status before
context loading or stream startup.

### U5 — Bundles fully visible, never inner-scrolled (XS) — ADR-013 §5

> "prevent the bundles from being collapsed and scrollable. they shall all be
> seen without scrolling."

In `DiscoveryKind`, remove `max-h-32 overflow-auto` from the bundle-list
container so every bundle button renders in the pane flow. Overflow is absorbed
by the Discovery panel's own scroll (post-U2 the panel owns the whole leaf).

### U6 — Stream reasoning + pane-filling scrollable output (M) — ADR-013 §6

> "add reasoning to the Discovery Agent and make the output a fixed sized
> scrollable window."

**Backend (`runner.ts`, `server.ts`, `agent.ts`):**
- Extend `RunEvent` with `{ type: "reasoning"; text: string }`. In
  `runSessionTurn`'s `session.subscribe`, handle `thinking_delta` (accumulate,
  emit `reasoning`). Confirm the exact event shape: `message_update` with
  `assistantMessageEvent.type === "thinking_delta"` vs. a top-level
  `thinking_delta` — verify against `pi-agent-core` `proxy.d.ts` before wiring.
- Request a non-zero thinking level on Discovery sessions where supported
  (`setThinkingLevel`, harness clamps to model capability). Gate on a config
  default so cost stays predictable.
- `/api/agent/discovery` forwards `reasoning` over NDJSON (already forwards all
  events). Add `{ type: 'reasoning'; text: string }` to `AgentStreamEvent`.

**Frontend (`DiscoveryPanes.tsx`):**
- Accumulate `reasoning` into separate state from `live` (verdict). Render
  reasoning **dim + collapsible** above the verdict.
- Wrap reasoning + verdict/turns in a **min-h-0 flex-1, scrollable** container so
  it consumes the remainder of the docked pane and long verdicts scroll in
  place. Reasoning is **display-only**: not persisted into
  `stored.turns`, not sent back on follow-ups (ADR-013 §6).

### U7 — Gas fees & builder tip into the baseline (bundle-prep) prompt (M) — ADR-013 §7

> "pass gas fees and builder tips from Mev Block Explorer to DiscoUI MEV
> Discovery Baseline prompt."

**Primary target = the bundle-prep ("baseline") pass; the verdict base is
secondary.** Data is already on `GET /api/mev/tx/:hash`'s `transaction`:
`coinbaseTransferWei`, `gasPriceWei`, `gasUsed`, `baseFeePerGasWei` (set in
`explorer-api/src/mev.ts` `getBlockMev`).

**Frontend:**
- Extend `TxMev.transaction` in `api/traces.ts` with the optional gas/tip fields
  (`coinbaseTransferWei`, `gasPriceWei`, `gasUsed`, `baseFeePerGasWei` — strings).
- Add `buildGasContext(txHash)` in `panel-agent/traceTree.ts`. Per leg, format
  **gas fee** (`gasUsed` × `gasPriceWei`, split base-fee vs. priority using
  `baseFeePerGasWei`) and **builder tip** (`coinbaseTransferWei` + priority-fee
  portion). Wei parsed as `bigint`; render in ETH. Returns `''` when no incident
  / uninspected (mirrors `buildSwapContext`).
- In `DiscoveryPanes.prepare()`, fetch `buildGasContext(txHash)` and send it as
  `gas` on the `streamPrepareBundles` request. In `DiscoveryKind.run`, also fetch
  it (with trace tree/swaps) and send `gas` on `streamDiscovery`. Extend both
  request types in `agent.ts`.

**Backend (`server.ts` + `bundles.ts`):**
- `/api/agent/bundles/prepare` accepts `gas?: string`; thread it through
  `generateContractBundles` → `buildBundlePrompt(contract, kinds, targetTokens,
  gas)`, which appends an **"Incident economics (gas & builder tip)"** section.
- `/api/agent/discovery` accepts `gas?: string`; pass into `discoveryBase()`,
  which appends the same section after swaps. Include it in the input-token
  estimate so the 413 overflow guard (ADR-012 §4) stays honest.
- Keep the client-builds-context pattern (matches trace tree/swaps); do not
  refetch in agent-api.
- **Caching caveat (ADR-013 §7):** economics informs bundle `notes` only on the
  first encounter of a codehash (bundles are reused); the secondary verdict-base
  section covers later incidents. The stored bundle stays structural — no new
  persisted economics field.

### U8 — Foundry (`cast`) hint + read-only tool for the Discovery agent (M/L) — ADR-013 §8

> "add information to the Discovery agents that hints them at using foundry
> (especially cast) for retrieving additional information."

**Both the prompt hint and the tool are in scope (confirmed).** `cast` is present
at `/usr/bin/cast`; `RPC_URL` and `ETHERSCAN_API_KEY` come from `@mev/config`.

- **Prompt:** extend `DISCOVERY_PROMPTS` (and the bundle-prep prompt) to tell the
  agent it may use the `cast` tool to retrieve storage slots, balances, `call`
  results, code, and token metadata when supplied evidence is insufficient — with
  the grounding rule that any `cast`-derived fact must be cited.
- **Tool:** add a bounded, **read-only** `cast` tool in `runner.ts` alongside
  `get_function_code`, wired via a new `RunRequest.enableCast?: boolean` and
  offered on the discovery + prepare runs. Implement by spawning
  `/usr/bin/cast <subcommand> …` via `node:child_process` `execFile` (never a
  shell — args passed as an array, no `shell: true`, so there is no shell-escape
  surface). Inject `ETH_RPC_URL=RPC_URL` and `ETHERSCAN_API_KEY` into the child
  env. Allowlist read subcommands only (`call`, `storage`, `balance`, `code`,
  `codesize`, `4byte`, `4byte-decode`, `sig`, `tx`, `receipt`, `block`,
  `block-number`, `chain-id`, `nonce`, `age`, `basefee`, `gas-price`); **reject**
  anything else — hard-block `send`, `mktx`, `publish`, `rpc`, wallet/broadcast
  forms. Bound output size and calls per run; emit a `tool` event per call
  (mirrors `get_function_code`).
- **Update the runner header comment** ("no filesystem or bash tools") to note
  the ADR-013 read-only `cast` exception.
- **Degradation:** on `ENOENT` (no `cast`) or missing RPC, the tool returns an
  "unavailable" text result and the agent falls back to supplied material — no
  hard failure.
- **Traps:** strict allowlist + `execFile` (no shell); cap stdout (e.g. 8 KiB)
  and a per-call timeout; latency (each call is a provider round-trip — ADR-012
  latency note applies); keep provenance on cited results.

### U9 — Navigation-stable, compact bundle preparation (L) — ADR-014 §1–3

- Move preparation ownership from the mounted Discovery pane to a module-level,
  project/model/kind/effort-keyed job registry. Workspace navigation only
  unsubscribes the pane; it must not abort the request.
- Send compact contract identities from the browser. agent-api resolves runtime
  codehashes, checks the durable cache in bulk, deduplicates deployments by
  codehash, and hydrates source only for cache misses with bounded concurrency.
- Stream resolved/cached/analyzing/completed progress. Keep nginx and Express
  request-size limits unchanged.

### U10 — Durable unverified-contract fallback (S) — ADR-014 §6

- Inspect Discovery project metadata before requesting flattened source. When a
  contract is explicitly `type: "Unverified"`, do not call the source endpoint
  and do not schedule a model run that requires verified source.
- Persist one deterministic bundle per requested research kind, keyed by the
  runtime codehash. It identifies the contract as opaque, contains no invented
  entry points, and tells Discover to use trace/on-chain evidence for claims.
- Unit-test that unverified metadata bypasses `/code/`, and live-test that a
  second preparation is a cache hit without a warning.

### U11 — Discover input state and authoritative context usage (M) — ADR-014 §7–8

- Rename the initial/rebuild action to **Discover**. After a successful Discover
  interaction, hide the included-bundle selection and show **Reassess**.
  Reassess reopens selection without starting a model turn; its button becomes
  Discover again. A failed run restores selection for correction/retry.
- After `session.prompt()` completes, read pi's `getContextUsage()` and emit a
  usage NDJSON event. Persist its token count and context window on the durable
  Discovery session. The UI uses the preflight estimate until authoritative
  usage exists, then updates after every verdict and follow-up, including model
  reasoning/tool traffic.
- Extend `e2e/disco.spec.ts` against the rebuilt compose stack to verify the
  Discover → hidden bundles/Reassess → visible bundles/Discover transition and
  that context usage changes after a follow-up. Do not use a throwaway script.

### U12 — Analyze cast parity and GUI verification (S) — ADR-014 §9

- Enable the bounded read-only `cast` tool on `/api/agent/analyze`, covering
  both code and value analysis. Extend both task prompts so the model knows to
  use cast only when on-chain facts are needed and to cite its results.
- Keep the existing cast allowlist, `execFile` no-shell execution, timeout, and
  output cap unchanged.
- Add a Playwright browser test against the rebuilt stack that calls the real
  Analyze NDJSON stream through the disco-web nginx origin, asks for a concrete
  read-only cast query, and observes both a successful `cast <subcommand>` tool
  event and a completed report. The docked Analyze panel was removed by
  ADR-012, so do not restore it solely for this verification.

### U13 — Pane-filling conversation and optimistic Enter feedback (S) — ADR-013 §4, §6

- Replace the hard-coded Discovery conversation height with a `flex-1` region
  that consumes the available docking-pane height and scrolls internally.
- On Enter-submit, immediately render the submitted question and an aria-live
  **Follow-up registered** state before trace/economics context collection or
  the NDJSON response begins. Restore the question if the request fails.
- Extend the Playwright Discovery flow with a deliberately delayed follow-up
  response and observe the registered state before releasing that response.

## Sequencing & risk

- **Land order:** U1 → U5 → U4 (trivial, independent) → U2 (docking) → U3
  (tabs, depends on U2's standalone Discovery panel) → U7 (gas context) → U6
  (reasoning) → U8 (cast tool, largest new surface).
- **U2 is the only layout-touching change** — verify persisted `preview`
  layouts still resolve to Discovery and the new **Preview** panel is dockable
  in both project and trace workspaces.
- **U6/U8 add agent capability**; the rest are presentation. U8's read-only
  `cast` enforcement is the highest-risk item — gate it behind an allowlist and
  test rejection of `send`/broadcast before shipping.
- **Verification:** run `apps/disco` + `apps/agent-api` against a known incident
  (`/ui/trace/:txHash`), confirm: no profit in the bar; Discovery and Preview
  are separate panels; MEV/Vuln tabs collapse; Enter sends / Shift+Enter
  newlines; all bundles visible; reasoning streams into a fixed scroll box; the
  verdict references gas/tip; and a `cast` read query is cited (and a `send` is
  refused).
- **ADR-014 verification:** rebuild/restart `agent-api` and `disco-web`; run the
  package builds/tests, the agent API regression suite, the Playwright Discovery
  specs, and a live NDJSON replay for the known unverified trace contract.

## Out of scope

- Persisting reasoning into durable turns or rehydration prompts (ephemeral by
  ADR-013 §6).
- Any explorer-track change beyond reading `GET /api/mev/tx/:hash`.
- Write/state-changing `cast` or transaction simulation beyond read subcommands.
