import {
  EvidenceIntegrityError,
  type ExecutionArtifact,
  type FlowArtifact,
  type FundMovement,
  type PutExecutionArtifact,
  type PutFlowArtifact,
  type TraceCall,
} from "@mev/evidence";
import {
  type DebugTransactionCall,
  type FlowEdge,
  type FlowEndpoint,
  type NativeFlowFact,
  type TokenFlowFact,
  type TokenTransfer,
  type TraceCallNode,
  type TraceEdge,
  type TraceEdgeKind,
  type TraceGraph,
  buildTraceFlowEdges,
  canonicalLogMovementId,
  canonicalNativeMovementId,
} from "@mev/trace-graph";
import { id } from "ethers";
import { DebugTraceCache } from "./provider.js";

export const TRACE_GRAPH_SCHEMA_VERSION = 2 as const;
export const EXECUTION_SCHEMA_VERSION = 2 as const;
export const FLOW_SCHEMA_VERSION = 1 as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TRANSFER_TOPIC = id("Transfer(address,address,uint256)").toLowerCase();
const NATIVE_CALL_TYPES = new Set(["CALL", "CREATE", "CREATE2", "SELFDESTRUCT"]);

interface EvidenceStore {
  findExecutionArtifact(
    chainId: string,
    transactionHash: string,
    schemaVersion: number,
    preferredProducers?: readonly ExecutionArtifact["producer"][],
  ): Promise<ExecutionArtifact | undefined>;
  findFlowArtifact(
    chainId: string,
    transactionHash: string,
    schemaVersion: number,
    preferredProducers?: readonly string[],
  ): Promise<FlowArtifact | undefined>;
  putExecutionArtifact(input: PutExecutionArtifact): Promise<ExecutionArtifact>;
  putFlowArtifact(input: PutFlowArtifact): Promise<FlowArtifact>;
}

export interface TraceReceiptLog {
  address: string;
  topics: readonly string[];
  data: string;
  index?: number;
  logIndex?: number;
}

export interface TraceReceipt {
  blockHash: string | null;
  blockNumber: number;
  status?: number | null;
  logs: readonly TraceReceiptLog[];
}

interface TraceBlock {
  hash?: string | null;
  number: number;
}

interface TraceNetwork {
  chainId: bigint | number | string;
}

export interface TraceEvidenceRpc {
  send(method: string, params: unknown[]): Promise<unknown>;
  getTransactionReceipt(transactionHash: string): Promise<TraceReceipt | null>;
  getBlock(blockHash: string): Promise<TraceBlock | null>;
  getNetwork(): Promise<TraceNetwork>;
}

export interface TraceGraphEvidenceMetadata {
  source: ExecutionArtifact["producer"];
  schemaVersion: number;
  completeness: ExecutionArtifact["completeness"];
  contentHash: string;
}

export interface TraceFlowEvidenceMetadata {
  source: string;
  schemaVersion: number;
  completeness: FlowArtifact["completeness"];
  contentHash: string;
}

export interface TraceGraphV2Envelope {
  schemaVersion: typeof TRACE_GRAPH_SCHEMA_VERSION;
  transactionHash: string;
  snapshot: {
    chainId: string;
    blockNumber: string;
    blockHash: string;
  };
  evidence: {
    execution: TraceGraphEvidenceMetadata;
    flow: TraceFlowEvidenceMetadata | null;
  };
  graph: TraceGraph;
}

/**
 * DB-first trace graph resolver. Only a missing/corrupt normalized execution
 * artifact can enter the bounded debug fallback. Missing optional flow detail
 * is surfaced as partial metadata and never triggers a transaction replay.
 */
export class TraceEvidenceGateway {
  readonly #inFlight = new Map<string, Promise<TraceGraphV2Envelope>>();
  readonly #debug: DebugTraceCache;

  constructor(
    private readonly store: EvidenceStore,
    private readonly rpc: TraceEvidenceRpc,
    private readonly defaultChainId = "1",
    debugCache?: DebugTraceCache,
  ) {
    this.#debug = debugCache ?? new DebugTraceCache(rpc);
  }

  async getGraph(transactionHash: string): Promise<TraceGraphV2Envelope> {
    const key = `${this.defaultChainId}:${transactionHash.toLowerCase()}`;
    const running = this.#inFlight.get(key);
    if (running) return running;
    const request = this.#load(transactionHash.toLowerCase()).finally(() => {
      if (this.#inFlight.get(key) === request) this.#inFlight.delete(key);
    });
    this.#inFlight.set(key, request);
    return request;
  }

  async #load(transactionHash: string): Promise<TraceGraphV2Envelope> {
    let execution = await this.#findExecution(transactionHash, ["inspector", "debug-cache"]);
    if (!execution) return this.#debugFallback(transactionHash);

    let flow = await this.#findFlow(transactionHash, [execution.producer, "inspector", "debug-cache"]);
    // A corrupt preferred inspector row must not force another replay when a
    // previously persisted debug fallback is healthy.
    if (!flow && execution.producer !== "debug-cache") {
      flow = await this.#findFlow(transactionHash, ["debug-cache"]);
    }
    return graphEnvelope(execution, flow);
  }

  async #findExecution(
    transactionHash: string,
    producers: readonly ExecutionArtifact["producer"][],
  ): Promise<ExecutionArtifact | undefined> {
    try {
      return await this.store.findExecutionArtifact(
        this.defaultChainId,
        transactionHash,
        EXECUTION_SCHEMA_VERSION,
        producers,
      );
    } catch (error) {
      if (!isCorruptEvidence(error)) throw error;
      if (producers.includes("debug-cache") && producers.length > 1) {
        return this.#findExecution(transactionHash, ["debug-cache"]);
      }
      return undefined;
    }
  }

  async #findFlow(
    transactionHash: string,
    producers: readonly string[],
  ): Promise<FlowArtifact | undefined> {
    try {
      return await this.store.findFlowArtifact(
        this.defaultChainId,
        transactionHash,
        FLOW_SCHEMA_VERSION,
        [...new Set(producers)],
      );
    } catch (error) {
      if (!isCorruptEvidence(error)) throw error;
      return undefined;
    }
  }

  async #debugFallback(transactionHash: string): Promise<TraceGraphV2Envelope> {
    const [receipt, network, trace] = await Promise.all([
      this.rpc.getTransactionReceipt(transactionHash),
      this.rpc.getNetwork(),
      this.#debug.get(transactionHash),
    ]);
    if (!receipt?.blockHash) throw new Error("transaction receipt is unavailable or unmined");
    const block = await this.rpc.getBlock(receipt.blockHash);
    if (!block?.hash || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      throw new Error("transaction receipt block snapshot could not be verified");
    }
    if (block.number !== receipt.blockNumber) {
      throw new Error("transaction receipt block number does not match its block hash");
    }
    const snapshot = {
      chainId: String(network.chainId),
      blockNumber: String(receipt.blockNumber),
      blockHash: receipt.blockHash.toLowerCase(),
    };
    const calls = normalizeDebugCalls(trace);
    const execution = await this.store.putExecutionArtifact({
      ...snapshot,
      transactionHash,
      schemaVersion: EXECUTION_SCHEMA_VERSION,
      producer: "debug-cache",
      completeness: "complete",
      capabilities: ["call-tree", "native-value", "call-scoped-logs"],
      calls,
    });
    const flow = await this.store.putFlowArtifact({
      ...snapshot,
      transactionHash,
      schemaVersion: FLOW_SCHEMA_VERSION,
      producer: "debug-cache",
      completeness: "complete",
      movements: normalizeDebugMovements(trace, calls, receipt.logs, {
        ...snapshot,
        transactionHash,
      }),
    });
    return graphEnvelope(execution, flow);
  }
}

export function graphEnvelope(
  execution: ExecutionArtifact,
  flow: FlowArtifact | undefined,
): TraceGraphV2Envelope {
  if (
    flow &&
    (flow.chainId !== execution.chainId ||
      flow.blockHash !== execution.blockHash ||
      flow.blockNumber !== execution.blockNumber ||
      flow.transactionHash !== execution.transactionHash)
  ) {
    throw new EvidenceIntegrityError("execution and flow evidence belong to different snapshots");
  }
  const graph = executionToGraph(execution, flow);
  return {
    schemaVersion: TRACE_GRAPH_SCHEMA_VERSION,
    transactionHash: execution.transactionHash,
    snapshot: {
      chainId: execution.chainId,
      blockNumber: execution.blockNumber,
      blockHash: execution.blockHash,
    },
    evidence: {
      execution: {
        source: execution.producer,
        schemaVersion: execution.schemaVersion,
        completeness: execution.completeness,
        contentHash: execution.contentHash,
      },
      flow: flow
        ? {
            source: flow.producer,
            schemaVersion: flow.schemaVersion,
            completeness: flow.completeness,
            contentHash: flow.contentHash,
          }
        : null,
    },
    graph,
  };
}

export function executionToGraph(execution: ExecutionArtifact, flow?: FlowArtifact): TraceGraph {
  const calls = [...execution.calls].sort((left, right) => comparePath(left.traceAddress, right.traceAddress));
  const nodes = calls.map(callToNode);
  const edges: TraceEdge[] = nodes.flatMap((node) =>
    node.parentId
      ? [{ from: node.parentId, to: node.id, kind: edgeKind(node.type) }]
      : [],
  );
  const tokenTransfers: TokenTransfer[] = (flow?.movements ?? []).flatMap((movement) => {
    if (movement.kind === "native" || !movement.traceAddress || !movement.tokenAddress) return [];
    return [
      {
        nodeId: pathId(movement.traceAddress),
        token: movement.tokenAddress,
        from: movement.from,
        to: movement.to,
        amountRaw: movement.amount,
      },
    ];
  });
  const graph: TraceGraph = {
    transactionHash: execution.transactionHash,
    chain: chainName(execution.chainId),
    nodeCount: nodes.length,
    maxDepth: nodes.reduce((maximum, node) => Math.max(maximum, node.depth), 0),
    nodes,
    edges,
    tokenTransfers,
  };
  const controls = buildTraceFlowEdges({
    transactionHash: execution.transactionHash,
    chain: graph.chain,
    chainId: execution.chainId,
    blockHash: execution.blockHash,
    nodes,
    edges,
    tokenTransfers: [],
  }).filter((edge) => edge.layer === "control");
  graph.flowEdges = [...controls, ...flowMovementsToEdges(flow?.movements ?? [], nodes)].sort(
    (left, right) => left.id.localeCompare(right.id),
  );
  return graph;
}

export function normalizeDebugCalls(root: DebugTransactionCall): TraceCall[] {
  const calls: TraceCall[] = [];
  const visit = (
    call: DebugTransactionCall,
    traceAddress: number[],
    parentTraceAddress: number[] | null,
    ancestorReverted: boolean,
  ) => {
    const localError = call.error ?? call.revertReason ?? null;
    const reverted = ancestorReverted || localError !== null;
    calls.push({
      traceAddress,
      parentTraceAddress,
      callType: normalizedCallType(call.type),
      from: normalizedAddress(call.from) ?? ZERO_ADDRESS,
      to: normalizedAddress(call.to),
      selector: call.input && call.input.length >= 10 ? call.input.slice(0, 10).toLowerCase() : null,
      inputSize: hexByteLength(call.input),
      outputSize: call.output === undefined ? null : hexByteLength(call.output),
      subtraces: call.calls?.length ?? 0,
      valueWei: quantity(call.value, "0"),
      gas: call.gas === undefined ? null : quantity(call.gas, "0"),
      gasUsed: call.gasUsed === undefined ? null : quantity(call.gasUsed, "0"),
      error: localError,
      reverted,
    });
    (call.calls ?? []).forEach((child, index) =>
      visit(child, [...traceAddress, index], traceAddress, reverted),
    );
  };
  visit(root, [], null, false);
  return calls;
}

function normalizeDebugMovements(
  root: DebugTransactionCall,
  calls: readonly TraceCall[],
  logs: readonly TraceReceiptLog[],
  snapshot: {
    chainId: string;
    blockHash: string;
    transactionHash: string;
  },
): FundMovement[] {
  const movements: FundMovement[] = [];
  for (const call of calls) {
    if (!NATIVE_CALL_TYPES.has(call.callType) || !call.to || BigInt(call.valueWei) <= 0n) continue;
    movements.push({
      id: canonicalNativeMovementId({
        ...snapshot,
        traceAddress: pathId(call.traceAddress),
        from: call.from,
        to: call.to,
        value: call.valueWei,
      }),
      kind: "native",
      tokenAddress: null,
      traceAddress: call.traceAddress,
      from: call.from,
      to: call.to,
      amount: call.valueWei,
      status: call.reverted ? "attempted" : "observed",
    });
  }

  logs.forEach((log, position) => {
    const transfer = transferMovement(log, position, calls, snapshot);
    if (transfer) movements.push(transfer);
  });
  // callTracer logs are useful only for attempted/reverted movements. Receipt
  // logs are authoritative for committed transfers and already cover those.
  collectAttemptedTraceTransfers(root, [], false, calls, snapshot, movements);
  return deduplicateMovements(movements);
}

function transferMovement(
  log: TraceReceiptLog,
  position: number,
  calls: readonly TraceCall[],
  snapshot: { chainId: string; blockHash: string; transactionHash: string },
): FundMovement | undefined {
  if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || (log.topics.length !== 3 && log.topics.length !== 4)) {
    return undefined;
  }
  const from = topicAddress(log.topics[1]);
  const to = topicAddress(log.topics[2]);
  const tokenAddress = normalizedAddress(log.address);
  if (!from || !to || !tokenAddress) return undefined;
  let amount: string;
  try {
    amount = BigInt(log.topics.length === 4 ? (log.topics[3] as string) : log.data).toString();
  } catch {
    return undefined;
  }
  const logIndex = log.index ?? log.logIndex ?? position;
  const kind = log.topics.length === 4 ? "erc721" : "erc20";
  const anchor = calls.find((call) => call.to === tokenAddress)?.traceAddress ?? null;
  return {
    id: canonicalLogMovementId({
      ...snapshot,
      logIndex,
      eventItemIndex: 0,
      standard: kind,
      token: tokenAddress,
      tokenId: kind === "erc721" ? amount : undefined,
    }),
    kind,
    tokenAddress,
    traceAddress: anchor,
    from,
    to,
    amount,
    status: "observed",
  };
}

function collectAttemptedTraceTransfers(
  call: DebugTransactionCall,
  path: number[],
  ancestorReverted: boolean,
  calls: readonly TraceCall[],
  snapshot: { chainId: string; blockHash: string; transactionHash: string },
  output: FundMovement[],
): void {
  const reverted = ancestorReverted || call.error !== undefined || call.revertReason !== undefined;
  if (reverted) {
    (call.logs ?? []).forEach((log, index) => {
      const transfer = transferMovement(
        { address: log.address ?? "", topics: log.topics, data: log.data ?? "0x", index },
        index,
        calls,
        snapshot,
      );
      if (!transfer) return;
      output.push({
        ...transfer,
        id: `attempted:${snapshot.transactionHash}:${pathId(path)}:${index}:${transfer.tokenAddress}`,
        traceAddress: path,
        status: "attempted",
      });
    });
  }
  (call.calls ?? []).forEach((child, index) =>
    collectAttemptedTraceTransfers(child, [...path, index], reverted, calls, snapshot, output),
  );
}

function flowMovementsToEdges(
  movements: readonly FundMovement[],
  nodes: readonly TraceCallNode[],
): FlowEdge[] {
  return movements.map((movement) => {
    const anchorCallNodeId = movement.traceAddress ? pathId(movement.traceAddress) : undefined;
    const status = movement.status === "attempted" ? "attempted" : "committed";
    if (movement.kind === "native") {
      const fact: NativeFlowFact = {
        type: "native",
        movementId: movement.id,
        amountRaw: movement.amount,
        anchorCallNodeId: anchorCallNodeId ?? "root",
        traceAddress: anchorCallNodeId ?? "root",
        provenance: "trace-call",
      };
      return {
        id: movement.id,
        layer: "funds",
        from: endpoint(movement.from, anchorCallNodeId, nodes),
        to: endpoint(movement.to, anchorCallNodeId, nodes),
        label: `${movement.amount} wei`,
        facts: [fact],
        count: 1,
        status,
      };
    }
    const fact: TokenFlowFact = {
      type: "token",
      movementId: movement.id,
      standard: movement.kind,
      token: movement.tokenAddress,
      amountRaw: movement.amount,
      anchorCallNodeId,
      eventItemIndex: 0,
      provenance: movement.status === "attempted" ? "trace-log" : "receipt-log",
    };
    return {
      id: movement.id,
      layer: "funds",
      from: endpoint(movement.from, anchorCallNodeId, nodes),
      to: endpoint(movement.to, anchorCallNodeId, nodes),
      label: `${movement.amount} ${movement.kind.toUpperCase()}`,
      facts: [fact],
      count: 1,
      status,
    };
  });
}

function endpoint(address: string, anchorId: string | undefined, nodes: readonly TraceCallNode[]): FlowEndpoint {
  const normalized = address.toLowerCase();
  if (anchorId) {
    const anchor = nodes.find((node) => node.id === anchorId);
    if (anchor?.to === normalized) return { address: normalized, nodeId: anchorId };
    if (anchor?.from === normalized && anchor.parentId) {
      const parent = nodes.find((node) => node.id === anchor.parentId);
      if (parent) return { address: normalized, nodeId: parent.id };
    }
  }
  const node = nodes.find((candidate) => candidate.to === normalized);
  return node ? { address: normalized, nodeId: node.id } : { address: normalized };
}

function callToNode(call: TraceCall): TraceCallNode {
  const id = pathId(call.traceAddress);
  return {
    id,
    parentId: call.parentTraceAddress === null ? null : pathId(call.parentTraceAddress),
    depth: call.traceAddress.length,
    type: call.callType,
    from: call.from,
    to: call.to,
    selector: call.selector,
    inputSize: call.inputSize,
    outputSize: call.outputSize ?? 0,
    valueWei: call.valueWei === "0" ? null : call.valueWei,
    gasUsed: call.gasUsed,
    error: call.error ?? (call.reverted ? "reverted" : null),
    revertReason: null,
    logCount: 0,
    childCount: call.subtraces,
  };
}

function normalizedCallType(value: string): TraceCall["callType"] {
  const upper = value.replace(/[_-]/g, "").toUpperCase();
  if (
    upper === "CALL" ||
    upper === "CALLCODE" ||
    upper === "DELEGATECALL" ||
    upper === "STATICCALL" ||
    upper === "CREATE" ||
    upper === "CREATE2" ||
    upper === "SELFDESTRUCT"
  ) {
    return upper;
  }
  return "UNKNOWN";
}

function edgeKind(type: string): TraceEdgeKind {
  const normalized = normalizedCallType(type);
  return normalized;
}

function normalizedAddress(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(normalized) ? normalized : null;
}

function topicAddress(value: string | undefined): string | undefined {
  return value && /^0x[0-9a-fA-F]{64}$/.test(value)
    ? `0x${value.slice(-40)}`.toLowerCase()
    : undefined;
}

function pathId(path: readonly number[]): string {
  return path.length === 0 ? "root" : path.join(".");
}

function comparePath(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const difference = (left[index] as number) - (right[index] as number);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function hexByteLength(value: string | undefined): number {
  return value?.startsWith("0x") ? Math.max(0, Math.floor((value.length - 2) / 2)) : 0;
}

function quantity(value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  try {
    return BigInt(value).toString();
  } catch {
    return fallback;
  }
}

function deduplicateMovements(values: readonly FundMovement[]): FundMovement[] {
  const seen = new Set<string>();
  return values.filter((movement) => {
    if (seen.has(movement.id)) return false;
    seen.add(movement.id);
    return true;
  });
}

function chainName(chainId: string): string {
  return chainId === "1" ? "eth" : `eip155-${chainId}`;
}

function isCorruptEvidence(error: unknown): boolean {
  return error instanceof EvidenceIntegrityError || (error instanceof Error && error.name === "ZodError");
}
