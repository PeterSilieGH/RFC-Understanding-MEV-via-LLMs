import { describe, expect, it } from "vitest";
import { buildExecutionArtifacts, buildFlowArtifacts } from "../src/evidence.js";
import type { InspectResult } from "../src/inspectBlock.js";
import type { ClassifiedTrace } from "../src/types.js";

const TX = `0x${"1".repeat(64)}`;
const BLOCK = `0x${"2".repeat(64)}`;
const A = "0x0000000000000000000000000000000000000001";
const B = "0x0000000000000000000000000000000000000002";
const C = "0x0000000000000000000000000000000000000003";
const TOKEN = "0x0000000000000000000000000000000000000010";
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function topic(address: string): string {
  return `0x${address.slice(2).padStart(64, "0")}`;
}

function call(
  traceAddress: number[],
  overrides: Partial<ClassifiedTrace> = {},
): ClassifiedTrace {
  return {
    action: {},
    blockNumber: 1,
    transactionHash: TX,
    transactionPosition: 0,
    traceAddress,
    subtraces: 0,
    type: "call",
    error: null,
    classification: "unknown",
    toAddress: B,
    fromAddress: A,
    value: 0n,
    gas: 100n,
    gasUsed: 10n,
    protocol: null,
    abiName: null,
    functionName: null,
    functionSignature: null,
    inputs: null,
    input: "0x12345678",
    output: "0x",
    callType: "call",
    ...overrides,
  };
}

function result(traces: ClassifiedTrace[]): InspectResult {
  return {
    chainId: "1",
    blockNumber: 1,
    blockHash: BLOCK,
    blockTimestamp: 1,
    receipts: [
      {
        blockNumber: 1,
        transactionHash: TX,
        transactionIndex: 0,
        gasUsed: 1n,
        effectiveGasPrice: 1n,
        cumulativeGasUsed: 1n,
        to: B,
        status: 1,
        logs: [],
      },
    ],
    classifiedTraces: traces,
    transfers: [],
    swaps: [],
    arbitrages: [],
    liquidations: [],
    sandwiches: [],
    nftTrades: [],
    minerPayments: [],
    detectors: {
      jitLiquidity: [],
      nonAtomicArbitrages: [],
      liquidationSandwiches: [],
      liquidationRaces: [],
      nftFlips: [],
    },
  };
}

describe("normalized inspector evidence", () => {
  it("retains unknown-call selectors and propagates ancestor revert status", () => {
    const artifact = buildExecutionArtifacts(
      result([
        call([], { error: "Reverted", subtraces: 1 }),
        call([0], { fromAddress: B, toAddress: C }),
      ]),
    )[0];
    expect(artifact.calls[0]).toMatchObject({ selector: "0x12345678", reverted: true });
    expect(artifact.calls[1]).toMatchObject({ reverted: true });
  });

  it("records attempted native value but never invents delegate/static value movement", () => {
    const artifact = buildFlowArtifacts(
      result([
        call([], { error: "Reverted", value: 5n }),
        call([0], { callType: "delegatecall", fromAddress: B, toAddress: C, value: 7n }),
        call([1], { callType: "staticcall", fromAddress: B, toAddress: C, value: 9n }),
      ]),
    )[0];
    expect(artifact.movements).toEqual([
      expect.objectContaining({ kind: "native", amount: "5", status: "attempted" }),
    ]);
  });

  it("uses one committed receipt movement when a decoded transfer overlaps", () => {
    const input = result([call([]), call([0], { fromAddress: B, toAddress: TOKEN })]);
    input.receipts[0].logs.push({
      address: TOKEN,
      topics: [TRANSFER_TOPIC, topic(A), topic(C)],
      data: "0x2a",
      logIndex: 7,
    });
    input.transfers.push({
      blockNumber: 1,
      transactionHash: TX,
      traceAddress: [0],
      fromAddress: A,
      toAddress: C,
      amount: 42n,
      tokenAddress: TOKEN,
    });

    const artifact = buildFlowArtifacts(input)[0];
    expect(artifact.movements).toHaveLength(1);
    expect(artifact.movements[0]).toMatchObject({
      id: `receipt:${TX}:7`,
      kind: "erc20",
      traceAddress: [0],
      status: "observed",
    });
  });
});
