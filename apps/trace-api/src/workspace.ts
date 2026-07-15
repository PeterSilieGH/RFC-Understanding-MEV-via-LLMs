// Synthetic per-incident discovery projects (ADR-008, work package T2).
//
// A tx hash resolves to an *incident* (all legs of the MEV event, from
// explorer-api's per-tx facts) and the incident to a disposable discovery
// project named trace-<hash8>, built from the unique contract addresses of
// all legs' traces and run with maxDepth 0 so discovery never follows
// references beyond that set (bounded run, measured in T1: ~10s, ~54 RPC
// requests for a 10-contract sandwich).
//
// The project name is derived from the lexicographically smallest leg hash,
// not the deep-linked one, so front-run, victim and back-run links all map
// to the same project.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "@mev/config";
import type { DebugTransactionCall } from "@mev/trace-graph";
import { ethers } from "ethers";
import { getTraceCached } from "./provider.js";

const config = loadConfig();

/**
 * Absolute role of a leg within its incident (folder names in the List
 * panel, ADR-008) - never relative to which leg resolved the workspace.
 */
export type LegRole =
  | "frontrun"
  | "backrun"
  | "victim"
  | "winner"
  | "loser"
  | "counterpart"
  | "root";

export interface IncidentLeg {
  txHash: string;
  role: LegRole;
  /** mev[] entry type this leg was resolved from (e.g. "sandwich_frontrun"). */
  viaType: string | null;
}

/** Panel enrichment read from the synthetic project's discovered.json. */
export interface WorkspaceEnrichment {
  /** lowercase 0x address -> discovered name + checksummed eth: address. */
  contracts: Record<string, { name: string | null; address: string }>;
  /** 4-byte selector (0x…) -> function name, from the discovered ABIs. */
  selectors: Record<string, string>;
}

export interface WorkspaceStatus extends Partial<WorkspaceEnrichment> {
  project: string;
  status: "discovering" | "ready" | "error";
  legs: IncidentLeg[];
  addressCount: number | null;
  error: string | null;
}

interface RunState {
  status: "discovering" | "ready" | "error";
  legs: IncidentLeg[];
  addressCount: number | null;
  error: string | null;
}

// One state per project; concurrent requests for any leg of the same
// incident share the same run (same dedupe idea as block inspection).
const runs = new Map<string, RunState>();

// Discovery re-checks contract state, so cap how many addresses we feed it;
// beyond this the graph view still works, only naming/Values degrade.
const MAX_INITIAL_ADDRESSES = 64;
const DISCOVERY_TIMEOUT_MS = 5 * 60 * 1000;

/** mev[] fields that reference other legs of the same incident. */
const LEG_FIELDS: [string, LegRole][] = [
  ["counterpartTxHash", "counterpart"],
  ["frontrunTxHash", "frontrun"],
  ["backrunTxHash", "backrun"],
  ["winnerTxHash", "winner"],
  ["reverseTxHash", "counterpart"],
];
const LEG_LIST_FIELDS: [string, LegRole][] = [
  ["victimTxHashes", "victim"],
  ["loserTxHashes", "loser"],
];

/** What an entry type says about the tx that carries it / its counterpart. */
const SELF_ROLE_BY_TYPE: Record<string, LegRole> = {
  sandwich_frontrun: "frontrun",
  sandwich_backrun: "backrun",
  sandwiched_victim: "victim",
};
const COUNTERPART_ROLE_BY_TYPE: Record<string, LegRole> = {
  sandwich_frontrun: "backrun",
  sandwich_backrun: "frontrun",
};

const TX_HASH_RE = /^0x[0-9a-f]{64}$/;

async function resolveIncidentLegs(txHash: string): Promise<IncidentLeg[]> {
  const res = await fetch(`http://localhost:${config.EXPLORER_API_PORT}/api/mev/tx/${txHash}`);
  if (!res.ok) {
    throw new Error(`explorer-api /api/mev/tx returned ${res.status}`);
  }
  const body = (await res.json()) as {
    transaction: { mev: Record<string, unknown>[] } | null;
  };

  const legs = new Map<string, IncidentLeg>();
  const add = (hash: unknown, role: LegRole, viaType: string | null) => {
    if (typeof hash !== "string") return;
    const normalized = hash.toLowerCase();
    if (!TX_HASH_RE.test(normalized)) return;
    const existing = legs.get(normalized);
    // a specific role beats the generic ones a leg may pick up first
    if (existing && !(existing.role === "root" && role !== "root")) return;
    legs.set(normalized, { txHash: normalized, role, viaType });
  };

  add(txHash, "root", null);
  for (const entry of body.transaction?.mev ?? []) {
    const viaType = typeof entry.type === "string" ? entry.type : "unknown";
    const selfRole = SELF_ROLE_BY_TYPE[viaType];
    if (selfRole) add(txHash, selfRole, viaType);
    for (const [field, role] of LEG_FIELDS) {
      const effective =
        field === "counterpartTxHash" ? (COUNTERPART_ROLE_BY_TYPE[viaType] ?? role) : role;
      add(entry[field], effective, viaType);
    }
    for (const [field, role] of LEG_LIST_FIELDS) {
      const list = entry[field];
      if (Array.isArray(list)) for (const h of list) add(h, role, viaType);
    }
  }
  return [...legs.values()];
}

/** Unique call targets across all legs' traces, in trace order. */
function collectAddresses(traces: DebugTransactionCall[]): string[] {
  const addresses = new Set<string>();
  const visit = (call: DebugTransactionCall) => {
    const to = call.to?.toLowerCase();
    // skip precompiles (and the zero address) - not contracts to discover
    if (to && BigInt(to) > 0xffffn) addresses.add(to);
    for (const child of call.calls ?? []) visit(child);
  };
  for (const trace of traces) visit(trace);
  return [...addresses];
}

function projectNameFor(legs: IncidentLeg[]): string {
  const canonical = legs
    .map((l) => l.txHash)
    .sort()[0]
    .slice(2, 10);
  return `trace-${canonical}`;
}

function projectDir(project: string): string {
  return join(config.DISCOVERY_PROJECTS_DIR, project);
}

async function writeProjectConfig(project: string, addresses: string[]): Promise<void> {
  const jsonc = `{
  // Synthetic per-incident discovery project, generated by trace-api
  // (ADR-008). Disposable cache - safe to delete, never commit.
  // maxDepth 0 = discover only the trace's own address set; relatives are
  // skipped before any RPC work.
  "$schema": "../../../../discovery/schemas/config.v2.schema.json",
  "name": "${project}",
  "import": ["../globalConfig.jsonc"],
  "maxDepth": 0,
  "maxAddresses": ${addresses.length + 16},
  "initialAddresses": [
${addresses.map((a) => `    "eth:${a}"`).join(",\n")}
  ]
}
`;
  await mkdir(projectDir(project), { recursive: true });
  await writeFile(join(projectDir(project), "config.jsonc"), jsonc);
}

/**
 * Runs `l2b discover <project>` through disco-api's terminal endpoint and
 * waits for the SSE stream to end. Closing the stream kills the run
 * server-side, which is also how a timeout aborts a stuck run.
 */
// Discovery runs are serialized process-wide (not just deduped per project):
// concurrent `l2b discover` runs share the discovery-cache SQLite and die
// with SQLITE_BUSY when they overlap.
let discoveryQueue: Promise<void> = Promise.resolve();

function runDiscovery(project: string): Promise<void> {
  const run = discoveryQueue.then(() => runDiscoveryNow(project));
  discoveryQueue = run.catch(() => {});
  return run;
}

async function runDiscoveryNow(project: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const res = await fetch(
      `http://localhost:${config.DISCO_API_PORT}/api/terminal/discover?project=${project}&devMode=false`,
      { signal: controller.signal },
    );
    if (!res.ok || !res.body) {
      throw new Error(`disco-api terminal/discover returned ${res.status}`);
    }
    const output = await new Response(res.body).text();
    const exit = output.match(/Process exited with code (\d+)/);
    if (!exit || exit[1] !== "0") {
      const tail = output.trim().split("\n").slice(-5).join("\n");
      throw new Error(
        exit
          ? `discovery exited with code ${exit[1]}: ${tail}`
          : `discovery stream ended without exit: ${tail}`,
      );
    }
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`discovery timed out after ${DISCOVERY_TIMEOUT_MS / 1000}s (run killed)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function prepareWorkspace(project: string, legs: IncidentLeg[]): Promise<void> {
  const state = runs.get(project);
  if (!state) return;
  try {
    const traces = await Promise.all(legs.map((leg) => getTraceCached(leg.txHash)));
    let addresses = collectAddresses(traces);
    if (addresses.length > MAX_INITIAL_ADDRESSES) {
      addresses = addresses.slice(0, MAX_INITIAL_ADDRESSES);
    }
    state.addressCount = addresses.length;
    await writeProjectConfig(project, addresses);
    await runDiscovery(project);
    if (!existsSync(join(projectDir(project), "discovered.json"))) {
      throw new Error("discovery finished but wrote no discovered.json");
    }
    enrichmentCache.delete(project); // a re-run rewrote discovered.json
    state.status = "ready";
  } catch (err) {
    state.status = "error";
    state.error = (err as Error).message;
  }
}

// Names + selector decodings for the panels (ADR-008 T5), parsed once per
// project from the synthetic project's discovered.json: entry names keyed by
// lowercase address, and function selectors (keccak of the human-readable
// ABI signatures discovery collected) keyed by 4-byte hex.
const enrichmentCache = new Map<string, WorkspaceEnrichment>();

async function readEnrichment(project: string): Promise<WorkspaceEnrichment | undefined> {
  const cached = enrichmentCache.get(project);
  if (cached) return cached;
  try {
    const raw = await readFile(join(projectDir(project), "discovered.json"), "utf8");
    const discovered = JSON.parse(raw) as {
      entries?: { address: string; name?: string }[];
      abis?: Record<string, string[]>;
    };
    const contracts: WorkspaceEnrichment["contracts"] = {};
    for (const entry of discovered.entries ?? []) {
      const plain = entry.address.replace(/^[a-z]+:/, "");
      contracts[plain.toLowerCase()] = {
        name: entry.name || null,
        address: entry.address,
      };
    }
    const selectors: WorkspaceEnrichment["selectors"] = {};
    for (const signatures of Object.values(discovered.abis ?? {})) {
      for (const signature of signatures) {
        if (!signature.startsWith("function ")) continue;
        try {
          const fragment = ethers.FunctionFragment.from(signature);
          selectors[fragment.selector] ??= fragment.name;
        } catch {
          // unparseable signature - skip, decoding is best-effort
        }
      }
    }
    const enrichment = { contracts, selectors };
    enrichmentCache.set(project, enrichment);
    return enrichment;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the incident for a tx and report (or kick off) its synthetic
 * project. First call starts the bounded discovery run; repeat calls poll;
 * an existing discovered.json is served from disk without re-running.
 */
export async function getWorkspaceStatus(txHash: string): Promise<WorkspaceStatus> {
  const legs = await resolveIncidentLegs(txHash);
  const project = projectNameFor(legs);

  let state = runs.get(project);
  if (!state) {
    if (existsSync(join(projectDir(project), "discovered.json"))) {
      state = { status: "ready", legs, addressCount: null, error: null };
      runs.set(project, state);
    } else {
      state = { status: "discovering", legs, addressCount: null, error: null };
      runs.set(project, state);
      void prepareWorkspace(project, legs);
    }
  } else if (state.status === "error") {
    // errors are not cached - a later request retries (node may have recovered)
    runs.delete(project);
  }

  const enrichment = state.status === "ready" ? await readEnrichment(project) : undefined;
  return {
    project,
    status: state.status,
    legs: state.legs,
    addressCount: state.addressCount,
    error: state.error,
    ...enrichment,
  };
}
