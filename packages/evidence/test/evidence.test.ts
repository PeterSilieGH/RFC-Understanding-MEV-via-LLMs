import { describe, expect, it } from "vitest";
import {
  type EvidenceClient,
  EvidenceConflictError,
  EvidenceIntegrityError,
  type EvidencePool,
  PostgresEvidenceStore,
  canonicalJson,
  decompilationArtifactSchema,
  hashJson,
  sha256,
  sourceArtifactSchema,
  traceCallSchema,
} from "../src/index.js";

const NOW = new Date("2026-07-22T12:00:00.000Z");
const ADDRESS = `0x${"ab".repeat(20)}`;
const CODEHASH_A = `0x${"11".repeat(32)}`;
const CODEHASH_B = `0x${"22".repeat(32)}`;
const BLOCKHASH_A = `0x${"aa".repeat(32)}`;
const BLOCKHASH_B = `0x${"bb".repeat(32)}`;
const TX_HASH = `0x${"cc".repeat(32)}`;

type Row = Record<string, unknown>;

class MemoryEvidenceDatabase implements EvidencePool, EvidenceClient {
  readonly blobs = new Map<string, Row>();
  readonly codes = new Map<string, Row>();
  readonly deployments = new Map<string, Row>();

  async connect(): Promise<EvidenceClient> {
    return this;
  }

  release(): void {}

  async query(text: string, values: unknown[] = []): Promise<{ rows: Row[] }> {
    const sql = text.replace(/\s+/g, " ").trim();
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };

    if (sql.startsWith("INSERT INTO evidence_blobs")) {
      const key = String(values[0]);
      if (!this.blobs.has(key)) {
        this.blobs.set(key, {
          content_hash: key,
          media_type: values[1],
          body: values[2],
          created_at: NOW,
        });
      }
      return { rows: [] };
    }
    if (sql.includes("FROM evidence_blobs WHERE content_hash")) {
      const row = this.blobs.get(String(values[0]));
      return { rows: row ? [row] : [] };
    }

    if (sql.startsWith("INSERT INTO evidence_code_artifacts")) {
      const key = String(values[0]);
      if (!this.codes.has(key)) {
        this.codes.set(key, {
          runtime_codehash: key,
          bytecode_content_hash: values[1],
          byte_length: values[2],
          created_at: NOW,
        });
      }
      return { rows: [] };
    }
    if (sql.includes("FROM evidence_code_artifacts c JOIN evidence_blobs")) {
      const code = this.codes.get(String(values[0]));
      if (!code) return { rows: [] };
      const blob = this.blobs.get(String(code.bytecode_content_hash));
      return { rows: blob ? [{ ...code, body: blob.body }] : [] };
    }
    if (sql.includes("FROM evidence_code_artifacts WHERE runtime_codehash")) {
      const row = this.codes.get(String(values[0]));
      return { rows: row ? [row] : [] };
    }

    if (sql.startsWith("INSERT INTO evidence_snapshot_deployments")) {
      const key = `${values[0]}:${values[2]}:${values[3]}`;
      if (!this.deployments.has(key)) {
        this.deployments.set(key, {
          chain_id: values[0],
          block_number: values[1],
          block_hash: values[2],
          address: values[3],
          runtime_codehash: values[4],
          producer: values[5],
          schema_version: values[6],
          completeness: values[7],
          observed_at: new Date(String(values[8])),
        });
      }
      return { rows: [] };
    }
    if (sql.includes("FROM evidence_snapshot_deployments") && sql.includes("block_hash = $2")) {
      const row = this.deployments.get(`${values[0]}:${values[1]}:${values[2]}`);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes("FROM evidence_snapshot_deployments") && sql.includes("block_number = $2")) {
      const rows = [...this.deployments.values()]
        .filter(
          (row) =>
            String(row.chain_id) === String(values[0]) &&
            String(row.block_number) === String(values[1]) &&
            row.address === values[2],
        )
        .sort((left, right) => String(left.block_hash).localeCompare(String(right.block_hash)));
      return { rows };
    }

    throw new Error(`MemoryEvidenceDatabase does not implement query: ${sql}`);
  }
}

describe("evidence schemas", () => {
  it("uses lossless decimal strings and rejects unknown fields", () => {
    const call = {
      traceAddress: [0],
      parentTraceAddress: [],
      callType: "CALL",
      from: ADDRESS,
      to: ADDRESS,
      selector: "0x12345678",
      inputSize: 4,
      outputSize: 32,
      subtraces: 0,
      valueWei: "100000000000000000000000000000000000000",
      gas: "21000",
      gasUsed: "20000",
      error: null,
      reverted: false,
    };
    expect(traceCallSchema.parse(call).valueWei).toBe(call.valueWei);
    expect(() => traceCallSchema.parse({ ...call, valueWei: 1 })).toThrow();
    expect(() => traceCallSchema.parse({ ...call, extra: true })).toThrow();
  });

  it("requires retry metadata for negative source evidence", () => {
    const negative = {
      runtimeCodehash: CODEHASH_A,
      provider: "etherscan",
      providerRevision: "v2",
      status: "unverified",
      sourceContentHash: null,
      abi: null,
      metadata: {},
      errorClass: "not_verified",
      retryAfter: "2026-07-23T12:00:00.000Z",
      attemptCount: 1,
      lastAttemptAt: NOW.toISOString(),
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    expect(sourceArtifactSchema.parse(negative).status).toBe("unverified");
    expect(() => sourceArtifactSchema.parse({ ...negative, errorClass: null })).toThrow();
  });

  it("keeps partial decompilation provenance and recovered function bounds", () => {
    const bodyHash = sha256("def unknown12345678():\n  return 1\n");
    const artifact = decompilationArtifactSchema.parse({
      runtimeCodehash: CODEHASH_A,
      engine: "panoramix",
      engineRevision: "23edd110",
      optionsHash: sha256("{}"),
      status: "partial",
      pseudocodeContentHash: bodyHash,
      functionIndex: [
        { selector: "0x12345678", name: "unknown12345678", startLine: 1, endLine: 2 },
      ],
      failedFunctions: ["0xffffffff"],
      warnings: ["one function timed out"],
      durationMs: 1200,
      outputHash: bodyHash,
      errorClass: null,
      retryAfter: null,
      attemptCount: 1,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(artifact.status).toBe("partial");
  });
});

describe("content-addressed evidence", () => {
  it("round-trips bodies byte-exactly and rejects inconsistent claims", async () => {
    const database = new MemoryEvidenceDatabase();
    const store = new PostgresEvidenceStore(database, () => NOW);
    const body = new Uint8Array([0, 1, 2, 254, 255]);
    const contentHash = await store.putContent(body, "application/octet-stream");

    const stored = await store.getContent(contentHash);
    expect(stored?.body).toEqual(body);
    expect(stored?.contentHash).toBe(sha256(body));

    database.blobs.get(contentHash)!.body = new Uint8Array([9, 9, 9]);
    await expect(store.putContent(body, "text/plain", contentHash)).rejects.toBeInstanceOf(
      EvidenceConflictError,
    );
    database.blobs.get(contentHash)!.body = body;
    await expect(
      store.putContent(body, "application/octet-stream", sha256("different")),
    ).rejects.toBeInstanceOf(EvidenceIntegrityError);
  });

  it("keeps reorg snapshots distinct instead of overwriting an address mapping", async () => {
    const database = new MemoryEvidenceDatabase();
    const store = new PostgresEvidenceStore(database, () => NOW);
    await store.putCodeArtifact(CODEHASH_A, new Uint8Array([0x60, 0x00]));
    await store.putCodeArtifact(CODEHASH_B, new Uint8Array([0x5f, 0x00]));

    const common = {
      chainId: "1",
      blockNumber: "20000000",
      address: ADDRESS.toUpperCase().replace("0X", "0x"),
      producer: "trace-api",
      schemaVersion: 1,
      completeness: "complete" as const,
      observedAt: NOW.toISOString(),
    };
    await store.putDeployment({ ...common, blockHash: BLOCKHASH_A, runtimeCodehash: CODEHASH_A });
    await store.putDeployment({ ...common, blockHash: BLOCKHASH_B, runtimeCodehash: CODEHASH_B });

    const first = await store.getDeployment(
      { chainId: "1", blockNumber: "20000000", blockHash: BLOCKHASH_A },
      ADDRESS,
    );
    const second = await store.getDeployment(
      { chainId: "1", blockNumber: "20000000", blockHash: BLOCKHASH_B },
      ADDRESS,
    );
    expect(first?.runtimeCodehash).toBe(CODEHASH_A);
    expect(second?.runtimeCodehash).toBe(CODEHASH_B);
    expect(await store.listDeploymentHistory("1", "20000000", ADDRESS)).toHaveLength(2);
  });

  it("rejects conflicting runtime mappings for one exact snapshot", async () => {
    const database = new MemoryEvidenceDatabase();
    const store = new PostgresEvidenceStore(database, () => NOW);
    await store.putCodeArtifact(CODEHASH_A, new Uint8Array([0x60]));
    await store.putCodeArtifact(CODEHASH_B, new Uint8Array([0x5f]));
    const deployment = {
      chainId: "1",
      blockNumber: "1",
      blockHash: BLOCKHASH_A,
      address: ADDRESS,
      runtimeCodehash: CODEHASH_A,
      producer: "test",
      schemaVersion: 1,
      completeness: "complete" as const,
      observedAt: NOW.toISOString(),
    };
    await store.putDeployment(deployment);
    await expect(
      store.putDeployment({ ...deployment, runtimeCodehash: CODEHASH_B }),
    ).rejects.toBeInstanceOf(EvidenceConflictError);
  });
});

describe("canonical evidence hashes", () => {
  it("are independent of object insertion order but preserve arrays", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
    expect(hashJson({ b: 2, a: 1 })).toBe(hashJson({ a: 1, b: 2 }));
    expect(hashJson({ a: [1, 2] })).not.toBe(hashJson({ a: [2, 1] }));
  });
});

describe("DB-first transaction lookup", () => {
  it("finds execution and flow evidence without resolving a receipt", async () => {
    const call = {
      traceAddress: [],
      parentTraceAddress: null,
      callType: "CALL" as const,
      from: ADDRESS,
      to: ADDRESS,
      selector: null,
      inputSize: 0,
      outputSize: 0,
      subtraces: 0,
      valueWei: "0",
      gas: null,
      gasUsed: null,
      error: null,
      reverted: false,
    };
    const execution = {
      chainId: "1",
      blockNumber: "100",
      blockHash: BLOCKHASH_A,
      transactionHash: TX_HASH,
      schemaVersion: 1,
      producer: "inspector" as const,
      completeness: "complete" as const,
      capabilities: ["calls"],
      calls: [call],
    };
    const movement = {
      id: "native:root",
      kind: "native" as const,
      traceAddress: [],
      from: ADDRESS,
      to: `0x${"cd".repeat(20)}`,
      tokenAddress: null,
      amount: "42",
      status: "observed" as const,
    };
    const flow = {
      chainId: "1",
      blockNumber: "100",
      blockHash: BLOCKHASH_A,
      transactionHash: TX_HASH,
      schemaVersion: 1,
      producer: "inspector",
      completeness: "complete" as const,
      movements: [movement],
    };
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const lookupPool: EvidencePool = {
      connect: async () => {
        throw new Error("find methods must not acquire a transactional client");
      },
      query: async (text, values = []) => {
        queries.push({ text, values });
        if (text.includes("evidence_execution_artifacts")) {
          return {
            rows: [
              {
                chain_id: execution.chainId,
                block_number: execution.blockNumber,
                block_hash: execution.blockHash,
                transaction_hash: execution.transactionHash,
                schema_version: execution.schemaVersion,
                producer: execution.producer,
                completeness: execution.completeness,
                capabilities: execution.capabilities,
                calls: execution.calls,
                content_hash: hashJson(execution),
                created_at: NOW,
              },
            ],
          };
        }
        return {
          rows: [
            {
              chain_id: flow.chainId,
              block_number: flow.blockNumber,
              block_hash: flow.blockHash,
              transaction_hash: flow.transactionHash,
              schema_version: flow.schemaVersion,
              producer: flow.producer,
              completeness: flow.completeness,
              movements: flow.movements,
              content_hash: hashJson(flow),
              created_at: NOW,
            },
          ],
        };
      },
    };
    const store = new PostgresEvidenceStore(lookupPool, () => NOW);

    expect((await store.findExecutionArtifact("1", TX_HASH, 1))?.producer).toBe("inspector");
    expect((await store.findFlowArtifact("1", TX_HASH, 1))?.movements[0].amount).toBe("42");
    expect(queries[0].values[3]).toEqual(["inspector", "debug-cache"]);
    expect(queries.every(({ text }) => !text.toLowerCase().includes("receipt"))).toBe(true);
    await expect(store.findExecutionArtifact("1", TX_HASH, 1, [])).rejects.toThrow();
  });
});
