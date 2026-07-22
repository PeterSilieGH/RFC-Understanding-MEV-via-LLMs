import type { TokenTransfer, TraceCallNode, TraceEdge } from "./graph.js";

/**
 * DIVERGENCE(mev): semantic graph overlays are deliberately separate from
 * DiscoUI node fields. Fields affect layout and persistence; flow facts do not.
 */
export type FlowLayer = "control" | "funds";
export type FlowStatus = "observed" | "committed" | "attempted" | "configured";

export interface FlowEndpoint {
  /** The real address at this end of the semantic relationship. */
  address: string;
  /** A call-frame/project node that can anchor the endpoint, when one exists. */
  nodeId?: string;
}

export interface ControlFlowFact {
  type: "call";
  callNodeId: string;
  parentCallNodeId: string;
  callType: string;
  selector: string | null;
  gasUsed: string | null;
  failed: boolean;
}

export interface NativeFlowFact {
  type: "native";
  movementId: string;
  amountRaw: string;
  anchorCallNodeId: string;
  traceAddress: string;
  provenance: "trace-call";
}

export interface TokenFlowFact {
  type: "token";
  movementId: string;
  standard: "erc20" | "erc721" | "erc1155" | "unknown";
  token: string;
  tokenId?: string;
  amountRaw: string;
  anchorCallNodeId?: string;
  logIndex?: number;
  eventItemIndex: number;
  provenance: "trace-log" | "receipt-log";
}

export interface PermissionFlowFact {
  type: "permission";
  permission: string;
  delay?: string;
  condition?: string;
  via?: string[];
  direct: boolean;
}

export type FlowFact = ControlFlowFact | NativeFlowFact | TokenFlowFact | PermissionFlowFact;

export interface FlowEdge {
  id: string;
  layer: FlowLayer;
  from: FlowEndpoint;
  to: FlowEndpoint;
  label: string;
  facts: FlowFact[];
  /** One for a detailed edge; greater values only exist after address LOD aggregation. */
  count: number;
  status: FlowStatus;
}

export interface ReceiptTokenTransfer {
  blockHash: string;
  logIndex: number;
  eventItemIndex?: number;
  standard?: "erc20" | "erc721" | "erc1155" | "unknown";
  token: string;
  tokenId?: string;
  from: string;
  to: string;
  amountRaw: string;
  /** Exact trace/log provenance when the persisted decoder supplied it. */
  anchorCallNodeId?: string;
}

export interface TraceFlowContext {
  transactionHash: string;
  chain: string;
  chainId?: string;
  blockHash?: string;
  nodes: readonly TraceCallNode[];
  edges: readonly TraceEdge[];
  tokenTransfers: readonly TokenTransfer[];
  /**
   * When present, receipt logs are authoritative for committed movements.
   * Trace logs are then retained only for reverted/attempted frames. This is
   * what prevents trace, receipt, and classifier views from double-counting.
   */
  receiptTokenTransfers?: readonly ReceiptTokenTransfer[];
}

export interface ConfiguredControlInput {
  controller: FlowEndpoint;
  target: FlowEndpoint;
  permission: string;
  delay?: string;
  condition?: string;
  via?: string[];
  direct: boolean;
}

export interface FlowSelection {
  edges: FlowEdge[];
  lod: "detail" | "aggregate" | "large";
  truncatedCount: number;
  originalCount: number;
}

export interface FlowSelectionOptions {
  visibleNodeCount: number;
  selectedNodeIds?: readonly string[];
  detailNodeThreshold?: number;
  detailFactThreshold?: number;
  aggregateNodeThreshold?: number;
  aggregateFactThreshold?: number;
  controlCap?: number;
  fundsCap?: number;
}

export const FLOW_CONTROL_EDGE_CAP = 300;
export const FLOW_FUNDS_EDGE_CAP = 200;

const NATIVE_MOVEMENT_TYPES = new Set(["CALL", "CREATE", "CREATE2", "SELFDESTRUCT"]);

function normalize(value: string): string {
  return value.toLowerCase();
}

function part(value: string | number | boolean): string {
  return encodeURIComponent(String(value).toLowerCase());
}

export function canonicalNativeMovementId(input: {
  chainId: string;
  blockHash: string;
  transactionHash: string;
  traceAddress: string;
  from: string;
  to: string;
  value: string;
}): string {
  return [
    "native",
    input.chainId,
    input.blockHash,
    input.transactionHash,
    input.traceAddress,
    input.from,
    input.to,
    input.value,
  ]
    .map(part)
    .join(":");
}

export function canonicalLogMovementId(input: {
  chainId: string;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  eventItemIndex: number;
  standard: string;
  token: string;
  tokenId?: string;
}): string {
  const assetId = `${input.standard}:${normalize(input.token)}:${input.tokenId ?? "fungible"}`;
  return [
    "log",
    input.chainId,
    input.blockHash,
    input.transactionHash,
    input.logIndex,
    input.eventItemIndex,
    assetId,
  ]
    .map(part)
    .join(":");
}

/** Build deterministic semantic edges from one trace graph's existing facts. */
export function buildTraceFlowEdges(context: TraceFlowContext): FlowEdge[] {
  const nodesById = new Map(context.nodes.map((node) => [node.id, node]));
  const ancestorFailed = failedCallIds(context.nodes, nodesById);
  const result = new Map<string, FlowEdge>();

  for (const edge of context.edges) {
    const parent = nodesById.get(edge.from);
    const child = nodesById.get(edge.to);
    if (!parent || !child) continue;
    const failed = ancestorFailed.has(child.id);
    const id = `control:${part(context.transactionHash)}:${part(child.id)}`;
    result.set(id, {
      id,
      layer: "control",
      from: endpointForCall(parent),
      to: endpointForCall(child),
      label: controlLabel(child),
      facts: [
        {
          type: "call",
          callNodeId: child.id,
          parentCallNodeId: parent.id,
          callType: edge.kind,
          selector: child.selector,
          gasUsed: child.gasUsed,
          failed,
        },
      ],
      count: 1,
      status: failed ? "attempted" : "observed",
    });
  }

  for (const node of context.nodes) {
    if (!node.valueWei) continue;
    let value: bigint;
    try {
      value = BigInt(node.valueWei);
    } catch {
      continue;
    }
    if (value <= 0n) continue;
    if (!NATIVE_MOVEMENT_TYPES.has(node.type.toUpperCase())) continue;
    if (!node.to) continue;
    const from = normalize(node.from);
    const to = normalize(node.to);
    const id = canonicalNativeMovementId({
      chainId: context.chainId ?? context.chain,
      blockHash: context.blockHash ?? "unknown-block",
      transactionHash: context.transactionHash,
      traceAddress: node.id,
      from,
      to,
      value: node.valueWei,
    });
    const fact: NativeFlowFact = {
      type: "native",
      movementId: id,
      amountRaw: node.valueWei,
      anchorCallNodeId: node.id,
      traceAddress: node.id,
      provenance: "trace-call",
    };
    result.set(id, {
      id,
      layer: "funds",
      from: endpointForAddress(from, node.id, context.nodes),
      to: endpointForAddress(to, node.id, context.nodes),
      label: `${node.valueWei} wei`,
      facts: [fact],
      count: 1,
      status: ancestorFailed.has(node.id) ? "attempted" : "committed",
    });
  }

  const hasReceiptEvidence = context.receiptTokenTransfers !== undefined;
  if (hasReceiptEvidence) {
    for (const transfer of context.receiptTokenTransfers ?? []) {
      const standard = transfer.standard ?? "unknown";
      const eventItemIndex = transfer.eventItemIndex ?? 0;
      const id = canonicalLogMovementId({
        chainId: context.chainId ?? context.chain,
        blockHash: transfer.blockHash,
        transactionHash: context.transactionHash,
        logIndex: transfer.logIndex,
        eventItemIndex,
        standard,
        token: transfer.token,
        tokenId: transfer.tokenId,
      });
      const fact: TokenFlowFact = {
        type: "token",
        movementId: id,
        standard,
        token: normalize(transfer.token),
        tokenId: transfer.tokenId,
        amountRaw: transfer.amountRaw,
        anchorCallNodeId: transfer.anchorCallNodeId,
        logIndex: transfer.logIndex,
        eventItemIndex,
        provenance: "receipt-log",
      };
      // A repeated classifier/decoder row with the same canonical id enriches
      // the movement; it never becomes a second edge.
      mergeMovement(
        result,
        movementEdge(context.nodes, transfer.from, transfer.to, fact, "committed"),
      );
    }
  }

  context.tokenTransfers.forEach((transfer, index) => {
    const attempted = ancestorFailed.has(transfer.nodeId);
    if (hasReceiptEvidence && !attempted) return;
    const id = [
      "trace-log",
      context.chain,
      context.transactionHash,
      transfer.nodeId,
      index,
      transfer.token,
      transfer.from,
      transfer.to,
      transfer.amountRaw,
    ]
      .map(part)
      .join(":");
    const fact: TokenFlowFact = {
      type: "token",
      movementId: id,
      standard: "erc20",
      token: normalize(transfer.token),
      amountRaw: transfer.amountRaw,
      anchorCallNodeId: transfer.nodeId,
      eventItemIndex: 0,
      provenance: "trace-log",
    };
    mergeMovement(
      result,
      movementEdge(
        context.nodes,
        transfer.from,
        transfer.to,
        fact,
        attempted ? "attempted" : "committed",
      ),
    );
  });

  return [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function buildConfiguredControlEdges(input: readonly ConfiguredControlInput[]): FlowEdge[] {
  return input
    .map((permission) => {
      const fact: PermissionFlowFact = {
        type: "permission",
        permission: permission.permission,
        delay: permission.delay,
        condition: permission.condition,
        via: permission.via,
        direct: permission.direct,
      };
      const id = [
        "configured",
        permission.controller.address,
        permission.target.address,
        permission.permission,
        permission.delay ?? "",
        permission.condition ?? "",
        (permission.via ?? []).join(","),
        permission.direct,
      ]
        .map(part)
        .join(":");
      return {
        id,
        layer: "control" as const,
        from: permission.controller,
        to: permission.target,
        label: `configured ${permission.permission}`,
        facts: [fact],
        count: 1,
        status: "configured" as const,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Deterministic renderer budget. Counts greater than one are introduced only
 * after address-level aggregation; per-call control edges always have count 1.
 */
export function selectFlowEdges(
  input: readonly FlowEdge[],
  options: FlowSelectionOptions,
): FlowSelection {
  const ordered = [...input].sort((a, b) => a.id.localeCompare(b.id));
  const originalCount = ordered.length;
  const factCount = ordered.reduce((sum, edge) => sum + edge.facts.length, 0);
  const detail =
    options.visibleNodeCount <= (options.detailNodeThreshold ?? 120) &&
    factCount <= (options.detailFactThreshold ?? 160);
  if (detail) {
    return { edges: ordered, lod: "detail", truncatedCount: 0, originalCount };
  }

  const aggregated = aggregateByAddress(ordered);
  const medium =
    options.visibleNodeCount <= (options.aggregateNodeThreshold ?? 1_000) &&
    factCount <= (options.aggregateFactThreshold ?? 1_200);
  if (medium) {
    return { edges: aggregated, lod: "aggregate", truncatedCount: 0, originalCount };
  }

  const selected = new Set(options.selectedNodeIds ?? []);
  const relevant =
    selected.size === 0
      ? aggregated
      : aggregated.filter((edge) => edgeTouchesSelection(edge, selected));
  const controlCap = options.controlCap ?? FLOW_CONTROL_EDGE_CAP;
  const fundsCap = options.fundsCap ?? FLOW_FUNDS_EDGE_CAP;
  const kept: FlowEdge[] = [];
  let controls = 0;
  let funds = 0;
  for (const edge of relevant) {
    if (edge.layer === "control") {
      if (controls >= controlCap) continue;
      controls++;
    } else {
      if (funds >= fundsCap) continue;
      funds++;
    }
    kept.push(edge);
  }
  return {
    edges: kept,
    lod: "large",
    truncatedCount: Math.max(0, aggregated.length - kept.length),
    originalCount,
  };
}

function failedCallIds(
  nodes: readonly TraceCallNode[],
  nodesById: ReadonlyMap<string, TraceCallNode>,
): Set<string> {
  const failed = new Set<string>();
  for (const node of nodes) {
    let current: TraceCallNode | undefined = node;
    while (current) {
      if (current.error) {
        failed.add(node.id);
        break;
      }
      current = current.parentId ? nodesById.get(current.parentId) : undefined;
    }
  }
  return failed;
}

function endpointForCall(node: TraceCallNode): FlowEndpoint {
  return { address: normalize(node.to ?? node.from), nodeId: node.id };
}

function endpointForAddress(
  address: string,
  anchorCallNodeId: string | undefined,
  nodes: readonly TraceCallNode[],
): FlowEndpoint {
  const normalized = normalize(address);
  if (anchorCallNodeId) {
    const anchor = nodes.find((node) => node.id === anchorCallNodeId);
    if (anchor && normalize(anchor.to ?? "") === normalized) {
      return { address: normalized, nodeId: anchor.id };
    }
    if (anchor && normalize(anchor.from) === normalized && anchor.parentId) {
      const parent = nodes.find((node) => node.id === anchor?.parentId);
      if (parent && normalize(parent.to ?? parent.from) === normalized) {
        return { address: normalized, nodeId: parent.id };
      }
    }
  }
  const match = nodes.find((node) => normalize(node.to ?? "") === normalized);
  return match ? { address: normalized, nodeId: match.id } : { address: normalized };
}

function controlLabel(node: TraceCallNode): string {
  const selector = node.selector ? ` ${node.selector}` : "";
  const gas = node.gasUsed ? ` · ${node.gasUsed} gas` : "";
  const failed = node.error ? " · failed" : "";
  return `${node.type}${selector} ×1${gas}${failed}`;
}

function movementEdge(
  nodes: readonly TraceCallNode[],
  from: string,
  to: string,
  fact: TokenFlowFact,
  status: "committed" | "attempted",
): FlowEdge {
  return {
    id: fact.movementId,
    layer: "funds",
    from: endpointForAddress(from, fact.anchorCallNodeId, nodes),
    to: endpointForAddress(to, fact.anchorCallNodeId, nodes),
    label: `${fact.amountRaw} ${fact.standard.toUpperCase()}`,
    facts: [fact],
    count: 1,
    status,
  };
}

function mergeMovement(target: Map<string, FlowEdge>, incoming: FlowEdge): void {
  const existing = target.get(incoming.id);
  if (!existing) {
    target.set(incoming.id, incoming);
    return;
  }
  const facts = new Map(existing.facts.map((fact) => [factKey(fact), fact]));
  for (const fact of incoming.facts) facts.set(factKey(fact), fact);
  target.set(incoming.id, { ...existing, facts: [...facts.values()] });
}

function factKey(fact: FlowFact): string {
  if (fact.type === "call") return `call:${fact.callNodeId}`;
  if (fact.type === "permission") return `permission:${fact.permission}:${fact.direct}`;
  return `${fact.type}:${fact.movementId}:${fact.provenance}`;
}

function aggregateByAddress(edges: readonly FlowEdge[]): FlowEdge[] {
  const groups = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    const factKinds = [...new Set(edge.facts.map((fact) => fact.type))].sort().join(",");
    const key = [
      edge.layer,
      normalize(edge.from.address),
      normalize(edge.to.address),
      edge.status,
      factKinds,
    ].join("|");
    const group = groups.get(key);
    if (group) group.push(edge);
    else groups.set(key, [edge]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => {
      const facts = group.flatMap((edge) => edge.facts);
      const first = group[0] as FlowEdge;
      const label =
        first.layer === "control" ? aggregateControlLabel(facts) : aggregateFundsLabel(facts);
      return {
        id: `aggregate:${part(key)}`,
        layer: first.layer,
        from: { address: normalize(first.from.address) },
        to: { address: normalize(first.to.address) },
        label,
        facts,
        count: group.reduce((sum, edge) => sum + edge.count, 0),
        status: first.status,
      };
    });
}

function aggregateControlLabel(facts: readonly FlowFact[]): string {
  const calls = facts.filter((fact): fact is ControlFlowFact => fact.type === "call");
  const kinds = new Map<string, number>();
  for (const call of calls) kinds.set(call.callType, (kinds.get(call.callType) ?? 0) + 1);
  return [...kinds.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${kind} ×${count}`)
    .join(" + ");
}

function aggregateFundsLabel(facts: readonly FlowFact[]): string {
  const movements = facts.filter(
    (fact): fact is NativeFlowFact | TokenFlowFact =>
      fact.type === "native" || fact.type === "token",
  );
  const assets = new Set(
    movements.map((fact) =>
      fact.type === "native" ? "native" : `${fact.standard}:${fact.token}:${fact.tokenId ?? ""}`,
    ),
  );
  return `${movements.length} transfer${movements.length === 1 ? "" : "s"} / ${assets.size} asset${assets.size === 1 ? "" : "s"}`;
}

function edgeTouchesSelection(edge: FlowEdge, selected: ReadonlySet<string>): boolean {
  if (edge.from.nodeId && selected.has(edge.from.nodeId)) return true;
  if (edge.to.nodeId && selected.has(edge.to.nodeId)) return true;
  return edge.facts.some((fact) => {
    if (fact.type === "call") {
      return selected.has(fact.callNodeId) || selected.has(fact.parentCallNodeId);
    }
    if (fact.type === "native" || fact.type === "token") {
      return !!fact.anchorCallNodeId && selected.has(fact.anchorCallNodeId);
    }
    return false;
  });
}
