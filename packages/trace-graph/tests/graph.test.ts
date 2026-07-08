import { describe, expect, it } from "vitest";
import { isTxHash, normalizeAddress, parseDebugTrace, toTraceGraph } from "../src/index.js";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f41f16df971d5f13c17b0ff9c2";
const BOT = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x2222222222222222222222222222222222222222";
const POOL = "0x3333333333333333333333333333333333333333";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// A minimal swap-shaped callTracer response: bot -> router -> pool, with an
// ERC20 Transfer emitted inside the pool call and a reverted sibling call.
const fixture = {
  type: "CALL",
  from: BOT,
  to: ROUTER,
  input: "0x38ed173900000000000000000000000000000000000000000000000000000000000000ff",
  output: "0x01",
  value: "0x0",
  gasUsed: "0x30d40",
  calls: [
    {
      type: "STATICCALL",
      from: ROUTER,
      to: POOL,
      input: "0x0902f1ac",
      calls: [],
    },
    {
      type: "CALL",
      from: ROUTER,
      to: POOL,
      input: "0x022c0d9f",
      gasUsed: "0x9c40",
      logs: [
        {
          address: WETH,
          topics: [
            TRANSFER_TOPIC,
            `0x000000000000000000000000${POOL.slice(2)}`,
            `0x000000000000000000000000${BOT.slice(2)}`,
          ],
          data: "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
        },
      ],
    },
    {
      type: "CALL",
      from: ROUTER,
      to: POOL,
      input: "0xdeadbeef",
      error: "execution reverted",
      revertReason: "K",
    },
  ],
};

const TX = "0xABCDEF0000000000000000000000000000000000000000000000000000000001";

describe("parseDebugTrace + toTraceGraph", () => {
  const graph = toTraceGraph(TX, "eth", parseDebugTrace(fixture));

  it("walks every call frame into a node with trace-path ids", () => {
    expect(graph.nodeCount).toBe(4);
    expect(graph.nodes.map((n) => n.id)).toEqual(["root", "0", "1", "2"]);
    expect(graph.maxDepth).toBe(1);
    expect(graph.transactionHash).toBe(TX.toLowerCase());
  });

  it("creates one typed edge per parent-child call", () => {
    expect(graph.edges).toEqual([
      { from: "root", to: "0", kind: "STATICCALL" },
      { from: "root", to: "1", kind: "CALL" },
      { from: "root", to: "2", kind: "CALL" },
    ]);
  });

  it("keeps the selector but not the calldata", () => {
    const root = graph.nodes[0];
    expect(root.selector).toBe("0x38ed1739");
    expect(root.inputSize).toBe(36);
    expect(JSON.stringify(graph)).not.toContain("000000ff");
  });

  it("extracts ERC20 transfers from withLog logs", () => {
    expect(graph.tokenTransfers).toEqual([
      {
        nodeId: "1",
        token: WETH.toLowerCase(),
        from: POOL,
        to: BOT,
        amountRaw: (10n ** 18n).toString(),
      },
    ]);
  });

  it("carries revert information", () => {
    const reverted = graph.nodes.find((n) => n.id === "2");
    expect(reverted?.error).toBe("execution reverted");
    expect(reverted?.revertReason).toBe("K");
  });
});

describe("address helpers", () => {
  it("normalizes plain and chain-specific addresses", () => {
    expect(normalizeAddress(WETH)).toBe(WETH.toLowerCase());
    expect(normalizeAddress(`eth:${WETH}`)).toBe(WETH.toLowerCase());
    expect(normalizeAddress("eth:0x123")).toBeNull();
    expect(normalizeAddress("bogus")).toBeNull();
  });

  it("recognizes transaction hashes", () => {
    expect(isTxHash(TX)).toBe(true);
    expect(isTxHash(WETH)).toBe(false);
  });
});
