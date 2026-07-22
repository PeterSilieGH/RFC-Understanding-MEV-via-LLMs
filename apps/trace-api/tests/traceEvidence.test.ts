import {
  type ExecutionArtifact,
  type FlowArtifact,
  type PutExecutionArtifact,
  type PutFlowArtifact,
  hashJson,
} from "@mev/evidence";
import { describe, expect, it, vi } from "vitest";
import { DebugTraceCache } from "../src/provider.js";
import {
  TraceEvidenceGateway,
  type TraceEvidenceRpc,
} from "../src/traceEvidence.js";

const TX = `0x${"1".repeat(64)}`;
const BLOCK = `0x${"2".repeat(64)}`;
const FROM = "0x0000000000000000000000000000000000000001";
const TO = "0x0000000000000000000000000000000000000002";
const TOKEN = "0x0000000000000000000000000000000000000003";

const DEBUG_TRACE = {
  type: "CALL",
  from: FROM,
  to: TO,
  input: "0x12345678",
  output: "0x",
  value: "0x1",
  gas: "0x100",
  gasUsed: "0x10",
};

function execution(producer: "inspector" | "debug-cache" = "inspector"): ExecutionArtifact {
  const content = {
    chainId: "1",
    blockNumber: "100",
    blockHash: BLOCK,
    transactionHash: TX,
    schemaVersion: 2,
    producer,
    completeness: "complete" as const,
    capabilities: ["call-tree", "native-value"],
    calls: [
      {
        traceAddress: [],
        parentTraceAddress: null,
        callType: "CALL" as const,
        from: FROM,
        to: TO,
        selector: "0x12345678",
        inputSize: 4,
        outputSize: 0,
        subtraces: 0,
        valueWei: "1",
        gas: "256",
        gasUsed: "16",
        error: null,
        reverted: false,
      },
    ],
  };
  return { ...content, contentHash: hashJson(content), createdAt: new Date(0).toISOString() };
}

function flow(producer = "inspector"): FlowArtifact {
  const content = {
    chainId: "1",
    blockNumber: "100",
    blockHash: BLOCK,
    transactionHash: TX,
    schemaVersion: 1,
    producer,
    completeness: "complete" as const,
    movements: [
      {
        id: "receipt:fixture:0",
        kind: "erc20" as const,
        tokenAddress: TOKEN,
        traceAddress: [] as number[],
        from: FROM,
        to: TO,
        amount: "7",
        status: "observed" as const,
      },
    ],
  };
  return { ...content, contentHash: hashJson(content), createdAt: new Date(0).toISOString() };
}

function rpc(send = vi.fn(async () => DEBUG_TRACE)): TraceEvidenceRpc {
  return {
    send,
    getTransactionReceipt: vi.fn(async () => ({
      blockHash: BLOCK,
      blockNumber: 100,
      status: 1,
      logs: [],
    })),
    getBlock: vi.fn(async () => ({ hash: BLOCK, number: 100 })),
    getNetwork: vi.fn(async () => ({ chainId: 1n })),
  };
}

function store(input: {
  execution?: ExecutionArtifact;
  flow?: FlowArtifact;
}) {
  let persistedExecution = input.execution;
  let persistedFlow = input.flow;
  return {
    findExecutionArtifact: vi.fn(async () => persistedExecution),
    findFlowArtifact: vi.fn(async () => persistedFlow),
    putExecutionArtifact: vi.fn(async (value: PutExecutionArtifact) => {
      persistedExecution = {
        ...value,
        contentHash: hashJson(value),
        createdAt: new Date(0).toISOString(),
      };
      return persistedExecution;
    }),
    putFlowArtifact: vi.fn(async (value: PutFlowArtifact) => {
      persistedFlow = {
        ...value,
        contentHash: hashJson(value),
        createdAt: new Date(0).toISOString(),
      };
      return persistedFlow;
    }),
  };
}

describe("DB-first trace evidence", () => {
  it("reconstructs an inspected graph and receipt-backed Funds with zero debug calls", async () => {
    const database = store({ execution: execution(), flow: flow() });
    const provider = rpc();

    const result = await new TraceEvidenceGateway(database, provider).getGraph(TX);

    expect(provider.send).not.toHaveBeenCalled();
    expect(provider.getTransactionReceipt).not.toHaveBeenCalled();
    expect(result.evidence.execution.source).toBe("inspector");
    expect(result.evidence.flow?.source).toBe("inspector");
    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.flowEdges?.some((edge) => edge.id === "receipt:fixture:0")).toBe(true);
  });

  it("does not replay when only optional flow evidence is missing", async () => {
    const database = store({ execution: execution() });
    const provider = rpc();

    const result = await new TraceEvidenceGateway(database, provider).getGraph(TX);

    expect(provider.send).not.toHaveBeenCalled();
    expect(result.evidence.flow).toBeNull();
    expect(result.graph.flowEdges?.every((edge) => edge.layer === "control")).toBe(true);
  });

  it("coalesces one missing-evidence replay and persists normalized artifacts", async () => {
    const database = store({});
    const provider = rpc();
    const gateway = new TraceEvidenceGateway(database, provider);

    const [first, second] = await Promise.all([gateway.getGraph(TX), gateway.getGraph(TX)]);

    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(provider.getTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(database.putExecutionArtifact).toHaveBeenCalledTimes(1);
    expect(database.putFlowArtifact).toHaveBeenCalledTimes(1);
    expect(first.evidence.execution.source).toBe("debug-cache");
    expect(second).toEqual(first);

    const restarted = new TraceEvidenceGateway(database, provider);
    await restarted.getGraph(TX);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it("clears a rejected fallback so a later request retries", async () => {
    let attempts = 0;
    const provider = rpc(
      vi.fn(async () => {
        attempts++;
        if (attempts === 1) throw new Error("temporary debug failure");
        return DEBUG_TRACE;
      }),
    );
    const database = store({});
    const gateway = new TraceEvidenceGateway(
      database,
      provider,
      "1",
      new DebugTraceCache(provider, 1_000),
    );

    const rejected = await Promise.allSettled([gateway.getGraph(TX), gateway.getGraph(TX)]);
    expect(rejected.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    await expect(gateway.getGraph(TX)).resolves.toMatchObject({
      evidence: { execution: { source: "debug-cache" } },
    });
    expect(provider.send).toHaveBeenCalledTimes(2);
  });
});
