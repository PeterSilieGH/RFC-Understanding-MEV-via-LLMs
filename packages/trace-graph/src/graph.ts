import type { DebugTransactionCall } from "./debugTrace.js";

// The trace-specific graph model (ADR-005): a dedicated shape for dynamic
// call flow, deliberately not a retrofit of DiscoUI's static ApiProjectResponse.
// The transform runs server-side; nodes carry the selector and sizes instead
// of full calldata so large MEV traces stay shippable — the raw trace is
// available behind a separate endpoint.

export type TraceEdgeKind =
  | "CALL"
  | "DELEGATECALL"
  | "STATICCALL"
  | "CALLCODE"
  | "CREATE"
  | "CREATE2"
  | "SELFDESTRUCT"
  | "UNKNOWN";

export interface TraceCallNode {
  /** Trace path: "root" for the top frame, then "0", "0.1", … */
  id: string;
  parentId: string | null;
  depth: number;
  type: string;
  from: string;
  to: string | null;
  /** 4-byte function selector, when calldata is present. */
  selector: string | null;
  inputSize: number;
  outputSize: number;
  valueWei: string | null;
  gasUsed: string | null;
  error: string | null;
  revertReason: string | null;
  logCount: number;
  childCount: number;
}

export interface TraceEdge {
  from: string;
  to: string;
  kind: TraceEdgeKind;
}

export interface TokenTransfer {
  /** Node id of the call whose logs contained the transfer. */
  nodeId: string;
  token: string;
  from: string;
  to: string;
  amountRaw: string;
}

export interface TraceGraph {
  transactionHash: string;
  chain: string;
  nodeCount: number;
  maxDepth: number;
  nodes: TraceCallNode[];
  edges: TraceEdge[];
  tokenTransfers: TokenTransfer[];
}

const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f41f16df971d5f13c17b0ff9c2";

const EDGE_KINDS: TraceEdgeKind[] = [
  "CALL",
  "DELEGATECALL",
  "STATICCALL",
  "CALLCODE",
  "CREATE",
  "CREATE2",
  "SELFDESTRUCT",
];

function edgeKind(type: string): TraceEdgeKind {
  const upper = type.toUpperCase() as TraceEdgeKind;
  return EDGE_KINDS.includes(upper) ? upper : "UNKNOWN";
}

function hexByteLength(hex: string | undefined): number {
  if (!hex || !hex.startsWith("0x")) return 0;
  return (hex.length - 2) / 2;
}

function selectorOf(input: string | undefined): string | null {
  if (!input || input.length < 10) return null;
  return input.slice(0, 10).toLowerCase();
}

/** An indexed-address topic is a 32-byte word with the address in the low 20 bytes. */
function topicToAddress(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

export function toTraceGraph(
  transactionHash: string,
  chain: string,
  rootCall: DebugTransactionCall,
): TraceGraph {
  const nodes: TraceCallNode[] = [];
  const edges: TraceEdge[] = [];
  const tokenTransfers: TokenTransfer[] = [];
  let maxDepth = 0;

  function visit(
    call: DebugTransactionCall,
    id: string,
    parentId: string | null,
    depth: number,
  ): void {
    maxDepth = Math.max(maxDepth, depth);
    nodes.push({
      id,
      parentId,
      depth,
      type: call.type.toUpperCase(),
      from: call.from.toLowerCase(),
      to: call.to?.toLowerCase() ?? null,
      selector: selectorOf(call.input),
      inputSize: hexByteLength(call.input),
      outputSize: hexByteLength(call.output),
      valueWei: call.value && call.value !== "0x0" ? BigInt(call.value).toString() : null,
      gasUsed: call.gasUsed ? BigInt(call.gasUsed).toString() : null,
      error: call.error ?? null,
      revertReason: call.revertReason ?? null,
      logCount: call.logs?.length ?? 0,
      childCount: call.calls?.length ?? 0,
    });
    if (parentId !== null) {
      edges.push({ from: parentId, to: id, kind: edgeKind(call.type) });
    }

    for (const log of call.logs ?? []) {
      // Only the classic ERC20 shape (3 topics: sig + indexed from/to); ERC721
      // Transfer has 4 topics and is skipped here on purpose.
      if (
        log.address &&
        log.data &&
        log.topics.length === 3 &&
        log.topics[0] === ERC20_TRANSFER_TOPIC
      ) {
        let amountRaw: string;
        try {
          amountRaw = BigInt(log.data).toString();
        } catch {
          continue;
        }
        tokenTransfers.push({
          nodeId: id,
          token: log.address.toLowerCase(),
          from: topicToAddress(log.topics[1]),
          to: topicToAddress(log.topics[2]),
          amountRaw,
        });
      }
    }

    (call.calls ?? []).forEach((child, i) => {
      visit(child, id === "root" ? String(i) : `${id}.${i}`, id, depth + 1);
    });
  }

  visit(rootCall, "root", null, 0);

  return {
    transactionHash: transactionHash.toLowerCase(),
    chain,
    nodeCount: nodes.length,
    maxDepth,
    nodes,
    edges,
    tokenTransfers,
  };
}
