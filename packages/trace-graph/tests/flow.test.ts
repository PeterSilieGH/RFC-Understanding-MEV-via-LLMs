import { describe, expect, it } from "vitest";
import {
  type FlowEdge,
  buildConfiguredControlEdges,
  buildTraceFlowEdges,
  canonicalLogMovementId,
  parseDebugTrace,
  selectFlowEdges,
  toTraceGraph,
} from "../src/index.js";

const TX = `0x${"ab".repeat(32)}`;
const BLOCK = `0x${"cd".repeat(32)}`;
const A = `0x${"11".repeat(20)}`;
const B = `0x${"22".repeat(20)}`;
const C = `0x${"33".repeat(20)}`;
const D = `0x${"44".repeat(20)}`;
const TOKEN = `0x${"55".repeat(20)}`;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f41f16df971d5f13c17b0ff9c2";

function addressTopic(address: string): string {
  return `0x${"0".repeat(24)}${address.slice(2)}`;
}

describe("trace flow facts", () => {
  it("keeps one control edge per frame and only eligible native movements", () => {
    const graph = toTraceGraph(
      TX,
      "eth",
      parseDebugTrace({
        type: "CALL",
        from: A,
        to: B,
        value: "0x2",
        calls: [
          { type: "DELEGATECALL", from: B, to: C, value: "0x3" },
          { type: "STATICCALL", from: B, to: C, value: "0x4" },
          { type: "CALLCODE", from: B, to: C, value: "0x5" },
          { type: "CREATE", from: B, to: C, value: "0x6" },
          { type: "SELFDESTRUCT", from: C, to: D, value: "0x7" },
        ],
      }),
      { chainId: "1", blockHash: BLOCK, includeFlowEdges: true },
    );

    const control = graph.flowEdges?.filter((edge) => edge.layer === "control") ?? [];
    expect(control).toHaveLength(5);
    expect(control.every((edge) => edge.count === 1)).toBe(true);
    expect(control.every((edge) => edge.from.nodeId && edge.to.nodeId)).toBe(true);

    const native =
      graph.flowEdges?.filter((edge) => edge.facts.some((fact) => fact.type === "native")) ?? [];
    expect(
      native.map((edge) => edge.facts[0]?.type === "native" && edge.facts[0].amountRaw).sort(),
    ).toEqual(["2", "6", "7"]);
    expect(native.map((edge) => [edge.from.address, edge.to.address])).toEqual(
      expect.arrayContaining([
        [A, B],
        [B, C],
        [C, D],
      ]),
    );
  });

  it("marks children attempted when their own frame or an ancestor reverted", () => {
    const graph = toTraceGraph(
      TX,
      "eth",
      parseDebugTrace({
        type: "CALL",
        from: A,
        to: B,
        error: "execution reverted",
        calls: [
          {
            type: "CALL",
            from: B,
            to: C,
            value: "0x9",
            logs: [
              {
                address: TOKEN,
                topics: [TRANSFER_TOPIC, addressTopic(D), addressTopic(A)],
                data: "0x5",
              },
            ],
          },
        ],
      }),
      { chainId: "1", blockHash: BLOCK, includeFlowEdges: true },
    );

    const childControl = graph.flowEdges?.find((edge) => edge.layer === "control");
    expect(childControl?.status).toBe("attempted");
    const funds = graph.flowEdges?.filter((edge) => edge.layer === "funds") ?? [];
    expect(funds).toHaveLength(2);
    expect(funds.every((edge) => edge.status === "attempted")).toBe(true);
  });

  it("uses committed receipt logs authoritatively and preserves actual direction", () => {
    const graph = toTraceGraph(
      TX,
      "eth",
      parseDebugTrace({
        type: "CALL",
        from: A,
        to: B,
        calls: [
          {
            type: "CALL",
            from: B,
            to: C,
            logs: [
              {
                address: TOKEN,
                topics: [TRANSFER_TOPIC, addressTopic(D), addressTopic(A)],
                data: "0x5",
              },
            ],
          },
        ],
      }),
    );
    const receipt = {
      blockHash: BLOCK,
      logIndex: 7,
      token: TOKEN,
      from: D,
      to: A,
      amountRaw: "5",
      standard: "erc20" as const,
      anchorCallNodeId: "0",
    };
    const flows = buildTraceFlowEdges({
      transactionHash: TX,
      chain: "eth",
      chainId: "1",
      nodes: graph.nodes,
      edges: graph.edges,
      tokenTransfers: graph.tokenTransfers,
      // A decoded/classifier duplicate carries the same canonical identity.
      receiptTokenTransfers: [receipt, receipt],
    });

    const funds = flows.filter((edge) => edge.layer === "funds");
    expect(funds).toHaveLength(1);
    expect(funds[0]?.id).toBe(
      canonicalLogMovementId({
        chainId: "1",
        blockHash: BLOCK,
        transactionHash: TX,
        logIndex: 7,
        eventItemIndex: 0,
        standard: "erc20",
        token: TOKEN,
      }),
    );
    expect(funds[0]?.from.address).toBe(D);
    expect(funds[0]?.to.address).toBe(A);
    expect(funds[0]?.status).toBe("committed");
    expect(funds[0]?.count).toBe(1);
  });
});

describe("flow renderer budgets", () => {
  const edges: FlowEdge[] = Array.from({ length: 20 }, (_, i) => ({
    id: `call-${i.toString().padStart(2, "0")}`,
    layer: "control",
    from: { address: A, nodeId: `parent-${i}` },
    to: { address: B, nodeId: `child-${i}` },
    label: "CALL",
    count: 1,
    status: "observed",
    facts: [
      {
        type: "call",
        callNodeId: `child-${i}`,
        parentCallNodeId: `parent-${i}`,
        callType: "CALL",
        selector: null,
        gasUsed: null,
        failed: false,
      },
    ],
  }));

  it("introduces counts only after address-level LOD aggregation", () => {
    const detail = selectFlowEdges(edges, { visibleNodeCount: 10 });
    expect(detail.lod).toBe("detail");
    expect(detail.edges.every((edge) => edge.count === 1 && edge.from.nodeId)).toBe(true);

    const aggregate = selectFlowEdges(edges, {
      visibleNodeCount: 121,
      detailFactThreshold: 1,
    });
    expect(aggregate.lod).toBe("aggregate");
    expect(aggregate.edges).toHaveLength(1);
    expect(aggregate.edges[0]?.count).toBe(20);
    expect(aggregate.edges[0]?.from.nodeId).toBeUndefined();
    expect(aggregate.edges[0]?.label).toBe("CALL ×20");
  });

  it("caps large traces deterministically", () => {
    const spread = edges.map((edge, index) => ({
      ...edge,
      from: { address: `controller-${index}` },
      to: { address: `target-${index}` },
    }));
    const selected = selectFlowEdges(spread, {
      visibleNodeCount: 10_000,
      aggregateFactThreshold: 1,
      controlCap: 1,
      fundsCap: 1,
    });
    expect(selected.lod).toBe("large");
    expect(selected.edges).toHaveLength(1);
    expect(selected.truncatedCount).toBe(19);
    expect(selected.edges[0]?.id).toMatch(/^aggregate:/);
  });
});

describe("configured control flow", () => {
  it("preserves controller to controlled direction and permission provenance", () => {
    const [edge] = buildConfiguredControlEdges([
      {
        controller: { address: A, nodeId: "admin" },
        target: { address: B, nodeId: "proxy" },
        permission: "upgrade",
        delay: "2 days",
        via: [C],
        direct: false,
      },
    ]);
    expect(edge?.from).toEqual({ address: A, nodeId: "admin" });
    expect(edge?.to).toEqual({ address: B, nodeId: "proxy" });
    expect(edge?.status).toBe("configured");
    expect(edge?.facts).toEqual([
      {
        type: "permission",
        permission: "upgrade",
        delay: "2 days",
        condition: undefined,
        via: [C],
        direct: false,
      },
    ]);
  });
});
