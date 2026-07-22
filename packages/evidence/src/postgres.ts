import { pool as sharedPool } from "@mev/db";
import type { Pool } from "pg";
import { z } from "zod";
import { EvidenceConflictError, EvidenceIntegrityError } from "./errors.js";
import { hashJson, sha256 } from "./hash.js";
import {
  type ContractRelation,
  type DecompilationArtifact,
  type DecompiledFunction,
  type Deployment,
  type ExecutionArtifact,
  type FlowArtifact,
  type Snapshot,
  type SourceArtifact,
  type TokenMetadata,
  contentHashSchema,
  contractRelationSchema,
  decimalStringSchema,
  decompilationArtifactSchema,
  deploymentSchema,
  executionArtifactSchema,
  flowArtifactSchema,
  hash32Schema,
  snapshotSchema,
  sourceArtifactSchema,
  tokenMetadataSchema,
} from "./schemas.js";

type DbRow = Record<string, unknown>;

export interface EvidenceClient {
  query(text: string, values?: unknown[]): Promise<{ rows: DbRow[]; rowCount?: number | null }>;
  release(): void;
}

export interface EvidencePool {
  connect(): Promise<EvidenceClient>;
  query(text: string, values?: unknown[]): Promise<{ rows: DbRow[]; rowCount?: number | null }>;
}

export interface ContentBlob {
  contentHash: string;
  mediaType: string;
  body: Uint8Array;
  createdAt: string;
}

export interface CodeArtifact {
  runtimeCodehash: string;
  bytecodeContentHash: string;
  bytecode: Uint8Array;
  byteLength: number;
  createdAt: string;
}

export interface PutSourceArtifact {
  runtimeCodehash: string;
  provider: string;
  providerRevision: string;
  status: "verified" | "unverified" | "error";
  source?: Uint8Array;
  mediaType?: string;
  abi?: unknown;
  metadata?: Record<string, unknown>;
  errorClass?: string;
  retryAfter?: string | null;
  attemptCount?: number;
  attemptedAt?: string;
}

export interface PutTokenMetadata extends Snapshot {
  tokenAddress: string;
  runtimeCodehash: string;
  status: "resolved" | "unavailable" | "error";
  symbol?: string | null;
  name?: string | null;
  decimals?: number | null;
  producer: string;
  schemaVersion: number;
  completeness: "complete" | "partial";
  errorClass?: string;
  retryAfter?: string | null;
  attemptCount?: number;
  observedAt?: string;
}

export interface PutDecompilationArtifact {
  runtimeCodehash: string;
  engine: string;
  engineRevision: string;
  optionsHash: string;
  status: "complete" | "partial" | "timeout" | "unsupported" | "error";
  pseudocode?: Uint8Array;
  mediaType?: string;
  functionIndex?: DecompiledFunction[];
  failedFunctions?: string[];
  warnings?: string[];
  durationMs?: number | null;
  errorClass?: string;
  retryAfter?: string | null;
  attemptCount?: number;
}

export type PutExecutionArtifact = Omit<ExecutionArtifact, "contentHash" | "createdAt">;
export type PutFlowArtifact = Omit<FlowArtifact, "contentHash" | "createdAt">;

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new EvidenceIntegrityError(`Expected database timestamp, received ${typeof value}`);
}

function requiredRow(rows: DbRow[], description: string): DbRow {
  const row = rows[0];
  if (!row) throw new EvidenceIntegrityError(`Database did not return ${description}`);
  return row;
}

function bytesFromRow(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  throw new EvidenceIntegrityError("Database returned a non-binary evidence body");
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

function jsonValue(value: unknown, fallback: unknown): unknown {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

function sourceFromRow(row: DbRow): SourceArtifact {
  return sourceArtifactSchema.parse({
    runtimeCodehash: row.runtime_codehash,
    provider: row.provider,
    providerRevision: row.provider_revision,
    status: row.status,
    sourceContentHash: row.source_content_hash,
    abi: jsonValue(row.abi, null),
    metadata: jsonValue(row.metadata, {}),
    errorClass: row.error_class,
    retryAfter: row.retry_after === null ? null : toIso(row.retry_after),
    attemptCount: Number(row.attempt_count),
    lastAttemptAt: toIso(row.last_attempt_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function tokenFromRow(row: DbRow): TokenMetadata {
  return tokenMetadataSchema.parse({
    chainId: String(row.chain_id),
    blockNumber: String(row.block_number),
    blockHash: row.block_hash,
    tokenAddress: row.token_address,
    runtimeCodehash: row.runtime_codehash,
    status: row.status,
    symbol: row.symbol,
    name: row.name,
    decimals: row.decimals === null ? null : Number(row.decimals),
    producer: row.producer,
    schemaVersion: Number(row.schema_version),
    completeness: row.completeness,
    errorClass: row.error_class,
    retryAfter: row.retry_after === null ? null : toIso(row.retry_after),
    attemptCount: Number(row.attempt_count),
    observedAt: toIso(row.observed_at),
    updatedAt: toIso(row.updated_at),
  });
}

function decompilationFromRow(row: DbRow): DecompilationArtifact {
  return decompilationArtifactSchema.parse({
    runtimeCodehash: row.runtime_codehash,
    engine: row.engine,
    engineRevision: row.engine_revision,
    optionsHash: row.options_hash,
    status: row.status,
    pseudocodeContentHash: row.pseudocode_content_hash,
    functionIndex: jsonValue(row.function_index, []),
    failedFunctions: jsonValue(row.failed_functions, []),
    warnings: jsonValue(row.warnings, []),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    outputHash: row.output_hash,
    errorClass: row.error_class,
    retryAfter: row.retry_after === null ? null : toIso(row.retry_after),
    attemptCount: Number(row.attempt_count),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

/** Transactional Postgres adapter; consumers never depend on table shapes. */
export class PostgresEvidenceStore {
  readonly #database: EvidencePool;
  readonly #now: () => Date;

  constructor(
    database: EvidencePool = sharedPool as unknown as EvidencePool,
    now: () => Date = () => new Date(),
  ) {
    this.#database = database;
    this.#now = now;
  }

  async #transaction<T>(work: (client: EvidenceClient) => Promise<T>): Promise<T> {
    const client = await this.#database.connect();
    try {
      await client.query("BEGIN");
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async #putContent(
    client: EvidenceClient,
    body: Uint8Array,
    mediaType: string,
    expectedHash?: string,
  ): Promise<string> {
    const contentHash = sha256(body);
    if (expectedHash !== undefined && expectedHash !== contentHash) {
      throw new EvidenceIntegrityError(
        `Evidence body hash mismatch: expected ${expectedHash}, computed ${contentHash}`,
      );
    }
    await client.query(
      `INSERT INTO evidence_blobs (content_hash, media_type, body)
       VALUES ($1, $2, $3) ON CONFLICT (content_hash) DO NOTHING`,
      [contentHash, mediaType, Buffer.from(body)],
    );
    const result = await client.query(
      "SELECT content_hash, media_type, body FROM evidence_blobs WHERE content_hash = $1",
      [contentHash],
    );
    const row = requiredRow(result.rows, `content blob ${contentHash}`);
    const stored = bytesFromRow(row.body);
    if (!equalBytes(stored, body)) {
      throw new EvidenceConflictError(`Conflicting content already exists for ${contentHash}`);
    }
    return contentHash;
  }

  async putContent(body: Uint8Array, mediaType: string, expectedHash?: string): Promise<string> {
    if (!(body instanceof Uint8Array)) {
      throw new EvidenceIntegrityError("Evidence content must be binary data");
    }
    z.string().min(1).max(256).parse(mediaType);
    if (expectedHash !== undefined) contentHashSchema.parse(expectedHash);
    return this.#transaction((client) => this.#putContent(client, body, mediaType, expectedHash));
  }

  async getContent(contentHash: string): Promise<ContentBlob | undefined> {
    contentHashSchema.parse(contentHash);
    const result = await this.#database.query(
      `SELECT content_hash, media_type, body, created_at
       FROM evidence_blobs WHERE content_hash = $1`,
      [contentHash],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const body = bytesFromRow(row.body);
    if (sha256(body) !== row.content_hash) {
      throw new EvidenceIntegrityError(
        `Stored evidence body failed hash validation: ${contentHash}`,
      );
    }
    return {
      contentHash: String(row.content_hash),
      mediaType: String(row.media_type),
      body,
      createdAt: toIso(row.created_at),
    };
  }

  async putCodeArtifact(runtimeCodehashInput: string, bytecode: Uint8Array): Promise<CodeArtifact> {
    const runtimeCodehash = hash32Schema.parse(runtimeCodehashInput);
    if (!(bytecode instanceof Uint8Array)) {
      throw new EvidenceIntegrityError("Runtime bytecode must be binary data");
    }
    return this.#transaction(async (client) => {
      const bytecodeContentHash = await this.#putContent(
        client,
        bytecode,
        "application/vnd.ethereum.evm-bytecode",
      );
      await client.query(
        `INSERT INTO evidence_code_artifacts
           (runtime_codehash, bytecode_content_hash, byte_length)
         VALUES ($1, $2, $3)
         ON CONFLICT (runtime_codehash) DO NOTHING`,
        [runtimeCodehash, bytecodeContentHash, bytecode.byteLength],
      );
      const result = await client.query(
        `SELECT runtime_codehash, bytecode_content_hash, byte_length, created_at
         FROM evidence_code_artifacts WHERE runtime_codehash = $1`,
        [runtimeCodehash],
      );
      const row = requiredRow(result.rows, `code artifact ${runtimeCodehash}`);
      if (
        row.bytecode_content_hash !== bytecodeContentHash ||
        Number(row.byte_length) !== bytecode.byteLength
      ) {
        throw new EvidenceConflictError(
          `Runtime codehash ${runtimeCodehash} is already mapped to different bytecode`,
        );
      }
      return {
        runtimeCodehash,
        bytecodeContentHash,
        bytecode: new Uint8Array(bytecode),
        byteLength: bytecode.byteLength,
        createdAt: toIso(row.created_at),
      };
    });
  }

  async getCodeArtifact(runtimeCodehashInput: string): Promise<CodeArtifact | undefined> {
    const runtimeCodehash = hash32Schema.parse(runtimeCodehashInput);
    const result = await this.#database.query(
      `SELECT c.runtime_codehash, c.bytecode_content_hash, c.byte_length, c.created_at, b.body
       FROM evidence_code_artifacts c
       JOIN evidence_blobs b ON b.content_hash = c.bytecode_content_hash
       WHERE c.runtime_codehash = $1`,
      [runtimeCodehash],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const bytecode = bytesFromRow(row.body);
    if (sha256(bytecode) !== row.bytecode_content_hash) {
      throw new EvidenceIntegrityError(`Bytecode for ${runtimeCodehash} failed hash validation`);
    }
    return {
      runtimeCodehash,
      bytecodeContentHash: String(row.bytecode_content_hash),
      bytecode,
      byteLength: Number(row.byte_length),
      createdAt: toIso(row.created_at),
    };
  }

  async putDeployment(input: Deployment): Promise<Deployment> {
    const deployment = deploymentSchema.parse(input);
    return this.#transaction(async (client) => {
      await client.query(
        `INSERT INTO evidence_snapshot_deployments
           (chain_id, block_number, block_hash, address, runtime_codehash,
            producer, schema_version, completeness, observed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (chain_id, block_hash, address) DO NOTHING`,
        [
          deployment.chainId,
          deployment.blockNumber,
          deployment.blockHash,
          deployment.address,
          deployment.runtimeCodehash,
          deployment.producer,
          deployment.schemaVersion,
          deployment.completeness,
          deployment.observedAt,
        ],
      );
      const result = await client.query(
        `SELECT * FROM evidence_snapshot_deployments
         WHERE chain_id = $1 AND block_hash = $2 AND address = $3`,
        [deployment.chainId, deployment.blockHash, deployment.address],
      );
      const stored = this.#deploymentFromRow(requiredRow(result.rows, "snapshot deployment"));
      if (
        stored.runtimeCodehash !== deployment.runtimeCodehash ||
        stored.blockNumber !== deployment.blockNumber
      ) {
        throw new EvidenceConflictError(
          `Snapshot ${deployment.chainId}:${deployment.blockHash}:${deployment.address} has conflicting runtime evidence`,
        );
      }
      return stored;
    });
  }

  #deploymentFromRow(row: DbRow): Deployment {
    return deploymentSchema.parse({
      chainId: String(row.chain_id),
      blockNumber: String(row.block_number),
      blockHash: row.block_hash,
      address: row.address,
      runtimeCodehash: row.runtime_codehash,
      producer: row.producer,
      schemaVersion: Number(row.schema_version),
      completeness: row.completeness,
      observedAt: toIso(row.observed_at),
    });
  }

  async getDeployment(
    snapshotInput: Snapshot,
    addressInput: string,
  ): Promise<Deployment | undefined> {
    const snapshot = snapshotSchema.parse(snapshotInput);
    const address = deploymentSchema.shape.address.parse(addressInput);
    const result = await this.#database.query(
      `SELECT * FROM evidence_snapshot_deployments
       WHERE chain_id = $1 AND block_hash = $2 AND address = $3`,
      [snapshot.chainId, snapshot.blockHash, address],
    );
    if (!result.rows[0]) return undefined;
    const deployment = this.#deploymentFromRow(result.rows[0]);
    if (deployment.blockNumber !== snapshot.blockNumber) {
      throw new EvidenceIntegrityError("Deployment block number does not match its block hash");
    }
    return deployment;
  }

  async listDeploymentHistory(
    chainId: string,
    blockNumber: string,
    addressInput: string,
  ): Promise<Deployment[]> {
    const parsed = snapshotSchema.pick({ chainId: true, blockNumber: true }).parse({
      chainId,
      blockNumber,
    });
    const address = deploymentSchema.shape.address.parse(addressInput);
    const result = await this.#database.query(
      `SELECT * FROM evidence_snapshot_deployments
       WHERE chain_id = $1 AND block_number = $2 AND address = $3
       ORDER BY block_hash`,
      [parsed.chainId, parsed.blockNumber, address],
    );
    return result.rows.map((row) => this.#deploymentFromRow(row));
  }

  async putContractRelation(input: ContractRelation): Promise<ContractRelation> {
    const relation = contractRelationSchema.parse(input);
    return this.#transaction(async (client) => {
      await client.query(
        `INSERT INTO evidence_contract_relations
           (chain_id, block_number, block_hash, from_address, to_address,
            relation_kind, producer, metadata, observed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         ON CONFLICT (chain_id, block_hash, from_address, to_address, relation_kind) DO NOTHING`,
        [
          relation.chainId,
          relation.blockNumber,
          relation.blockHash,
          relation.fromAddress,
          relation.toAddress,
          relation.relationKind,
          relation.producer,
          JSON.stringify(relation.metadata),
          relation.observedAt,
        ],
      );
      const result = await client.query(
        `SELECT * FROM evidence_contract_relations
         WHERE chain_id = $1 AND block_hash = $2 AND from_address = $3
           AND to_address = $4 AND relation_kind = $5`,
        [
          relation.chainId,
          relation.blockHash,
          relation.fromAddress,
          relation.toAddress,
          relation.relationKind,
        ],
      );
      const stored = this.#relationFromRow(requiredRow(result.rows, "contract relation"));
      if (
        stored.blockNumber !== relation.blockNumber ||
        stored.producer !== relation.producer ||
        hashJson(stored.metadata) !== hashJson(relation.metadata)
      ) {
        throw new EvidenceConflictError("Contract relation conflicts at the same snapshot");
      }
      return stored;
    });
  }

  #relationFromRow(row: DbRow): ContractRelation {
    return contractRelationSchema.parse({
      chainId: String(row.chain_id),
      blockNumber: String(row.block_number),
      blockHash: row.block_hash,
      fromAddress: row.from_address,
      toAddress: row.to_address,
      relationKind: row.relation_kind,
      producer: row.producer,
      metadata: jsonValue(row.metadata, {}),
      observedAt: toIso(row.observed_at),
    });
  }

  async listContractRelations(snapshotInput: Snapshot): Promise<ContractRelation[]> {
    const snapshot = snapshotSchema.parse(snapshotInput);
    const result = await this.#database.query(
      `SELECT * FROM evidence_contract_relations
       WHERE chain_id = $1 AND block_hash = $2
       ORDER BY from_address, to_address, relation_kind`,
      [snapshot.chainId, snapshot.blockHash],
    );
    const relations = result.rows.map((row) => this.#relationFromRow(row));
    if (relations.some((relation) => relation.blockNumber !== snapshot.blockNumber)) {
      throw new EvidenceIntegrityError(
        "Contract relation block number does not match its block hash",
      );
    }
    return relations;
  }

  async putSourceArtifact(input: PutSourceArtifact): Promise<SourceArtifact> {
    const runtimeCodehash = hash32Schema.parse(input.runtimeCodehash);
    const provider = z.string().min(1).max(128).parse(input.provider);
    const providerRevision = z.string().min(1).max(256).parse(input.providerRevision);
    if (input.source !== undefined && !(input.source instanceof Uint8Array)) {
      throw new EvidenceIntegrityError("Source evidence must be binary data");
    }
    const now = (input.attemptedAt ? new Date(input.attemptedAt) : this.#now()).toISOString();
    const attemptCount = input.attemptCount ?? 1;
    const metadata = input.metadata ?? {};
    const verified = input.status === "verified";
    if (verified !== (input.source !== undefined)) {
      throw new EvidenceIntegrityError(
        "Verified source requires bytes; negative source forbids bytes",
      );
    }
    if (!verified && !input.errorClass) {
      throw new EvidenceIntegrityError("Negative source evidence requires errorClass");
    }

    return this.#transaction(async (client) => {
      const sourceContentHash = input.source
        ? await this.#putContent(
            client,
            input.source,
            input.mediaType ?? "text/plain; charset=utf-8",
          )
        : null;
      const existingResult = await client.query(
        `SELECT * FROM evidence_source_artifacts
         WHERE runtime_codehash = $1 AND provider = $2 AND provider_revision = $3
         FOR UPDATE`,
        [runtimeCodehash, provider, providerRevision],
      );
      const existing = existingResult.rows[0] ? sourceFromRow(existingResult.rows[0]) : undefined;
      if (existing?.status === "verified") {
        if (verified && existing.sourceContentHash !== sourceContentHash) {
          throw new EvidenceConflictError(
            "Verified source artifact is immutable for this revision",
          );
        }
        return existing;
      }

      await client.query(
        `INSERT INTO evidence_source_artifacts
           (runtime_codehash, provider, provider_revision, status, source_content_hash,
            abi, metadata, error_class, retry_after, attempt_count, last_attempt_at,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $11, $11)
         ON CONFLICT (runtime_codehash, provider, provider_revision) DO UPDATE SET
           status = EXCLUDED.status,
           source_content_hash = EXCLUDED.source_content_hash,
           abi = EXCLUDED.abi,
           metadata = EXCLUDED.metadata,
           error_class = EXCLUDED.error_class,
           retry_after = EXCLUDED.retry_after,
           attempt_count = EXCLUDED.attempt_count,
           last_attempt_at = EXCLUDED.last_attempt_at,
           updated_at = EXCLUDED.updated_at`,
        [
          runtimeCodehash,
          provider,
          providerRevision,
          input.status,
          sourceContentHash,
          JSON.stringify(input.abi ?? null),
          JSON.stringify(metadata),
          verified ? null : input.errorClass,
          verified ? null : (input.retryAfter ?? null),
          attemptCount,
          now,
        ],
      );
      const result = await client.query(
        `SELECT * FROM evidence_source_artifacts
         WHERE runtime_codehash = $1 AND provider = $2 AND provider_revision = $3`,
        [runtimeCodehash, provider, providerRevision],
      );
      return sourceFromRow(requiredRow(result.rows, "source artifact"));
    });
  }

  async getSourceArtifact(
    runtimeCodehashInput: string,
    provider: string,
    providerRevision: string,
  ): Promise<(SourceArtifact & { source: Uint8Array | null }) | undefined> {
    const runtimeCodehash = hash32Schema.parse(runtimeCodehashInput);
    z.string().min(1).max(128).parse(provider);
    z.string().min(1).max(256).parse(providerRevision);
    const result = await this.#database.query(
      `SELECT s.*, b.body AS source_body
       FROM evidence_source_artifacts s
       LEFT JOIN evidence_blobs b ON b.content_hash = s.source_content_hash
       WHERE s.runtime_codehash = $1 AND s.provider = $2 AND s.provider_revision = $3`,
      [runtimeCodehash, provider, providerRevision],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const artifact = sourceFromRow(row);
    const source =
      row.source_body === null || row.source_body === undefined
        ? null
        : bytesFromRow(row.source_body);
    if (artifact.status === "verified" && source === null) {
      throw new EvidenceIntegrityError("Verified source artifact is missing its content body");
    }
    if (source && sha256(source) !== artifact.sourceContentHash) {
      throw new EvidenceIntegrityError("Stored source body failed hash validation");
    }
    return { ...artifact, source };
  }

  async putTokenMetadata(input: PutTokenMetadata): Promise<TokenMetadata> {
    const now = (input.observedAt ? new Date(input.observedAt) : this.#now()).toISOString();
    const candidate = tokenMetadataSchema.parse({
      ...input,
      symbol: input.status === "resolved" ? (input.symbol ?? null) : null,
      name: input.status === "resolved" ? (input.name ?? null) : null,
      decimals: input.status === "resolved" ? input.decimals : null,
      errorClass: input.status === "resolved" ? null : input.errorClass,
      retryAfter: input.status === "resolved" ? null : (input.retryAfter ?? null),
      attemptCount: input.attemptCount ?? 1,
      observedAt: now,
      updatedAt: now,
    });
    return this.#transaction(async (client) => {
      const existingResult = await client.query(
        `SELECT * FROM evidence_token_metadata
         WHERE chain_id = $1 AND block_hash = $2 AND token_address = $3 AND runtime_codehash = $4
         FOR UPDATE`,
        [candidate.chainId, candidate.blockHash, candidate.tokenAddress, candidate.runtimeCodehash],
      );
      const existing = existingResult.rows[0] ? tokenFromRow(existingResult.rows[0]) : undefined;
      if (existing?.status === "resolved") {
        if (
          candidate.status === "resolved" &&
          (existing.symbol !== candidate.symbol ||
            existing.name !== candidate.name ||
            existing.decimals !== candidate.decimals)
        ) {
          throw new EvidenceConflictError("Resolved token metadata conflicts at the same snapshot");
        }
        return existing;
      }
      await client.query(
        `INSERT INTO evidence_token_metadata
           (chain_id, block_number, block_hash, token_address, runtime_codehash, status,
            symbol, name, decimals, producer, schema_version, completeness, error_class,
            retry_after, attempt_count, observed_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
         ON CONFLICT (chain_id, block_hash, token_address, runtime_codehash) DO UPDATE SET
           status = EXCLUDED.status, symbol = EXCLUDED.symbol, name = EXCLUDED.name,
           decimals = EXCLUDED.decimals, producer = EXCLUDED.producer,
           schema_version = EXCLUDED.schema_version, completeness = EXCLUDED.completeness,
           error_class = EXCLUDED.error_class, retry_after = EXCLUDED.retry_after,
           attempt_count = EXCLUDED.attempt_count, updated_at = EXCLUDED.updated_at`,
        [
          candidate.chainId,
          candidate.blockNumber,
          candidate.blockHash,
          candidate.tokenAddress,
          candidate.runtimeCodehash,
          candidate.status,
          candidate.symbol,
          candidate.name,
          candidate.decimals,
          candidate.producer,
          candidate.schemaVersion,
          candidate.completeness,
          candidate.errorClass,
          candidate.retryAfter,
          candidate.attemptCount,
          candidate.observedAt,
        ],
      );
      const result = await client.query(
        `SELECT * FROM evidence_token_metadata
         WHERE chain_id = $1 AND block_hash = $2 AND token_address = $3 AND runtime_codehash = $4`,
        [candidate.chainId, candidate.blockHash, candidate.tokenAddress, candidate.runtimeCodehash],
      );
      return tokenFromRow(requiredRow(result.rows, "token metadata"));
    });
  }

  async getTokenMetadata(
    snapshotInput: Snapshot,
    tokenAddressInput: string,
    runtimeCodehashInput: string,
  ): Promise<TokenMetadata | undefined> {
    const snapshot = snapshotSchema.parse(snapshotInput);
    const tokenAddress = deploymentSchema.shape.address.parse(tokenAddressInput);
    const runtimeCodehash = hash32Schema.parse(runtimeCodehashInput);
    const result = await this.#database.query(
      `SELECT * FROM evidence_token_metadata
       WHERE chain_id = $1 AND block_hash = $2 AND token_address = $3 AND runtime_codehash = $4`,
      [snapshot.chainId, snapshot.blockHash, tokenAddress, runtimeCodehash],
    );
    if (!result.rows[0]) return undefined;
    const metadata = tokenFromRow(result.rows[0]);
    if (metadata.blockNumber !== snapshot.blockNumber) {
      throw new EvidenceIntegrityError("Token metadata block number does not match its block hash");
    }
    return metadata;
  }

  async putDecompilationArtifact(input: PutDecompilationArtifact): Promise<DecompilationArtifact> {
    const runtimeCodehash = hash32Schema.parse(input.runtimeCodehash);
    const engine = z.string().min(1).max(128).parse(input.engine);
    const engineRevision = z.string().min(1).max(256).parse(input.engineRevision);
    const optionsHash = contentHashSchema.parse(input.optionsHash);
    if (input.pseudocode !== undefined && !(input.pseudocode instanceof Uint8Array)) {
      throw new EvidenceIntegrityError("Decompiled evidence must be binary data");
    }
    const positive = input.status === "complete" || input.status === "partial";
    if (positive !== (input.pseudocode !== undefined)) {
      throw new EvidenceIntegrityError(
        "Complete/partial decompilation requires pseudocode; failure forbids pseudocode",
      );
    }
    if (!positive && !input.errorClass) {
      throw new EvidenceIntegrityError("Failed decompilation requires errorClass");
    }
    const now = this.#now().toISOString();
    return this.#transaction(async (client) => {
      const pseudocodeContentHash = input.pseudocode
        ? await this.#putContent(
            client,
            input.pseudocode,
            input.mediaType ?? "text/x-panoramix; charset=utf-8",
          )
        : null;
      const existingResult = await client.query(
        `SELECT * FROM evidence_decompilation_artifacts
         WHERE runtime_codehash = $1 AND engine = $2 AND engine_revision = $3 AND options_hash = $4
         FOR UPDATE`,
        [runtimeCodehash, engine, engineRevision, optionsHash],
      );
      const existing = existingResult.rows[0]
        ? decompilationFromRow(existingResult.rows[0])
        : undefined;
      if (existing && (existing.status === "complete" || existing.status === "partial")) {
        if (positive && existing.pseudocodeContentHash !== pseudocodeContentHash) {
          throw new EvidenceConflictError("Decompilation output is immutable for this engine key");
        }
        return existing;
      }

      await client.query(
        `INSERT INTO evidence_decompilation_artifacts
           (runtime_codehash, engine, engine_revision, options_hash, status,
            pseudocode_content_hash, function_index, failed_functions, warnings,
            duration_ms, output_hash, error_class, retry_after, attempt_count,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb,
                 $10, $6, $11, $12, $13, $14, $14)
         ON CONFLICT (runtime_codehash, engine, engine_revision, options_hash) DO UPDATE SET
           status = EXCLUDED.status, pseudocode_content_hash = EXCLUDED.pseudocode_content_hash,
           function_index = EXCLUDED.function_index, failed_functions = EXCLUDED.failed_functions,
           warnings = EXCLUDED.warnings, duration_ms = EXCLUDED.duration_ms,
           output_hash = EXCLUDED.output_hash, error_class = EXCLUDED.error_class,
           retry_after = EXCLUDED.retry_after, attempt_count = EXCLUDED.attempt_count,
           updated_at = EXCLUDED.updated_at`,
        [
          runtimeCodehash,
          engine,
          engineRevision,
          optionsHash,
          input.status,
          pseudocodeContentHash,
          JSON.stringify(input.functionIndex ?? []),
          JSON.stringify(input.failedFunctions ?? []),
          JSON.stringify(input.warnings ?? []),
          input.durationMs ?? null,
          positive ? null : input.errorClass,
          positive ? null : (input.retryAfter ?? null),
          input.attemptCount ?? 1,
          now,
        ],
      );
      const result = await client.query(
        `SELECT * FROM evidence_decompilation_artifacts
         WHERE runtime_codehash = $1 AND engine = $2 AND engine_revision = $3 AND options_hash = $4`,
        [runtimeCodehash, engine, engineRevision, optionsHash],
      );
      return decompilationFromRow(requiredRow(result.rows, "decompilation artifact"));
    });
  }

  async getDecompilationArtifact(
    runtimeCodehashInput: string,
    engine: string,
    engineRevision: string,
    optionsHash: string,
  ): Promise<(DecompilationArtifact & { pseudocode: Uint8Array | null }) | undefined> {
    const runtimeCodehash = hash32Schema.parse(runtimeCodehashInput);
    z.string().min(1).max(128).parse(engine);
    z.string().min(1).max(256).parse(engineRevision);
    contentHashSchema.parse(optionsHash);
    const result = await this.#database.query(
      `SELECT d.*, b.body AS pseudocode_body
       FROM evidence_decompilation_artifacts d
       LEFT JOIN evidence_blobs b ON b.content_hash = d.pseudocode_content_hash
       WHERE d.runtime_codehash = $1 AND d.engine = $2
         AND d.engine_revision = $3 AND d.options_hash = $4`,
      [runtimeCodehash, engine, engineRevision, optionsHash],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const artifact = decompilationFromRow(row);
    const pseudocode =
      row.pseudocode_body === null || row.pseudocode_body === undefined
        ? null
        : bytesFromRow(row.pseudocode_body);
    if ((artifact.status === "complete" || artifact.status === "partial") && pseudocode === null) {
      throw new EvidenceIntegrityError("Successful decompilation is missing its pseudocode body");
    }
    if (pseudocode && sha256(pseudocode) !== artifact.pseudocodeContentHash) {
      throw new EvidenceIntegrityError("Stored pseudocode failed hash validation");
    }
    return { ...artifact, pseudocode };
  }

  async putExecutionArtifact(input: PutExecutionArtifact): Promise<ExecutionArtifact> {
    const parsed = executionArtifactSchema
      .omit({ contentHash: true, createdAt: true })
      .parse(input);
    const contentHash = hashJson(parsed);
    const createdAt = this.#now().toISOString();
    return this.#transaction(async (client) => {
      await client.query(
        `INSERT INTO evidence_execution_artifacts
           (chain_id, block_number, block_hash, transaction_hash, schema_version,
            producer, completeness, capabilities, calls, content_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
         ON CONFLICT (chain_id, block_hash, transaction_hash, schema_version, producer) DO NOTHING`,
        [
          parsed.chainId,
          parsed.blockNumber,
          parsed.blockHash,
          parsed.transactionHash,
          parsed.schemaVersion,
          parsed.producer,
          parsed.completeness,
          JSON.stringify(parsed.capabilities),
          JSON.stringify(parsed.calls),
          contentHash,
          createdAt,
        ],
      );
      const result = await client.query(
        `SELECT * FROM evidence_execution_artifacts
         WHERE chain_id = $1 AND block_hash = $2 AND transaction_hash = $3
           AND schema_version = $4 AND producer = $5`,
        [
          parsed.chainId,
          parsed.blockHash,
          parsed.transactionHash,
          parsed.schemaVersion,
          parsed.producer,
        ],
      );
      const stored = this.#executionFromRow(requiredRow(result.rows, "execution artifact"));
      if (stored.contentHash !== contentHash) {
        throw new EvidenceConflictError(
          "Execution artifact key already contains different evidence",
        );
      }
      return stored;
    });
  }

  #executionFromRow(row: DbRow): ExecutionArtifact {
    const artifact = executionArtifactSchema.parse({
      chainId: String(row.chain_id),
      blockNumber: String(row.block_number),
      blockHash: row.block_hash,
      transactionHash: row.transaction_hash,
      schemaVersion: Number(row.schema_version),
      producer: row.producer,
      completeness: row.completeness,
      capabilities: jsonValue(row.capabilities, []),
      calls: jsonValue(row.calls, []),
      contentHash: row.content_hash,
      createdAt: toIso(row.created_at),
    });
    const { contentHash, createdAt: _createdAt, ...content } = artifact;
    if (hashJson(content) !== contentHash) {
      throw new EvidenceIntegrityError("Stored execution artifact failed hash validation");
    }
    return artifact;
  }

  async getExecutionArtifact(
    snapshotInput: Snapshot,
    transactionHashInput: string,
    schemaVersion: number,
    producer: ExecutionArtifact["producer"],
  ): Promise<ExecutionArtifact | undefined> {
    const snapshot = snapshotSchema.parse(snapshotInput);
    const transactionHash = hash32Schema.parse(transactionHashInput);
    const result = await this.#database.query(
      `SELECT * FROM evidence_execution_artifacts
       WHERE chain_id = $1 AND block_hash = $2 AND transaction_hash = $3
         AND schema_version = $4 AND producer = $5`,
      [snapshot.chainId, snapshot.blockHash, transactionHash, schemaVersion, producer],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const artifact = this.#executionFromRow(row);
    if (artifact.blockNumber !== snapshot.blockNumber) {
      throw new EvidenceIntegrityError("Execution block number does not match its block hash");
    }
    return artifact;
  }

  /** Find DB evidence by transaction hash without an RPC receipt lookup. */
  async findExecutionArtifact(
    chainIdInput: string,
    transactionHashInput: string,
    schemaVersion: number,
    preferredProducers: readonly ExecutionArtifact["producer"][] = ["inspector", "debug-cache"],
  ): Promise<ExecutionArtifact | undefined> {
    const chainId = decimalStringSchema.parse(chainIdInput);
    const transactionHash = hash32Schema.parse(transactionHashInput);
    const version = z.number().int().positive().parse(schemaVersion);
    const producers = z
      .array(z.enum(["inspector", "debug-cache", "debug-live"]))
      .min(1)
      .parse([...preferredProducers]);
    const result = await this.#database.query(
      `SELECT * FROM evidence_execution_artifacts
       WHERE chain_id = $1 AND transaction_hash = $2 AND schema_version = $3
         AND producer = ANY($4::text[])
       ORDER BY array_position($4::text[], producer), block_number DESC, created_at DESC
       LIMIT 1`,
      [chainId, transactionHash, version, producers],
    );
    return result.rows[0] ? this.#executionFromRow(result.rows[0]) : undefined;
  }

  async putFlowArtifact(input: PutFlowArtifact): Promise<FlowArtifact> {
    const parsed = flowArtifactSchema.omit({ contentHash: true, createdAt: true }).parse(input);
    const contentHash = hashJson(parsed);
    const createdAt = this.#now().toISOString();
    return this.#transaction(async (client) => {
      await client.query(
        `INSERT INTO evidence_flow_artifacts
           (chain_id, block_number, block_hash, transaction_hash, schema_version,
            producer, completeness, movements, content_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
         ON CONFLICT (chain_id, block_hash, transaction_hash, schema_version, producer) DO NOTHING`,
        [
          parsed.chainId,
          parsed.blockNumber,
          parsed.blockHash,
          parsed.transactionHash,
          parsed.schemaVersion,
          parsed.producer,
          parsed.completeness,
          JSON.stringify(parsed.movements),
          contentHash,
          createdAt,
        ],
      );
      const result = await client.query(
        `SELECT * FROM evidence_flow_artifacts
         WHERE chain_id = $1 AND block_hash = $2 AND transaction_hash = $3
           AND schema_version = $4 AND producer = $5`,
        [
          parsed.chainId,
          parsed.blockHash,
          parsed.transactionHash,
          parsed.schemaVersion,
          parsed.producer,
        ],
      );
      const stored = this.#flowFromRow(requiredRow(result.rows, "flow artifact"));
      if (stored.contentHash !== contentHash) {
        throw new EvidenceConflictError("Flow artifact key already contains different evidence");
      }
      return stored;
    });
  }

  #flowFromRow(row: DbRow): FlowArtifact {
    const artifact = flowArtifactSchema.parse({
      chainId: String(row.chain_id),
      blockNumber: String(row.block_number),
      blockHash: row.block_hash,
      transactionHash: row.transaction_hash,
      schemaVersion: Number(row.schema_version),
      producer: row.producer,
      completeness: row.completeness,
      movements: jsonValue(row.movements, []),
      contentHash: row.content_hash,
      createdAt: toIso(row.created_at),
    });
    const { contentHash, createdAt: _createdAt, ...content } = artifact;
    if (hashJson(content) !== contentHash) {
      throw new EvidenceIntegrityError("Stored flow artifact failed hash validation");
    }
    return artifact;
  }

  async getFlowArtifact(
    snapshotInput: Snapshot,
    transactionHashInput: string,
    schemaVersion: number,
    producer: string,
  ): Promise<FlowArtifact | undefined> {
    const snapshot = snapshotSchema.parse(snapshotInput);
    const transactionHash = hash32Schema.parse(transactionHashInput);
    const result = await this.#database.query(
      `SELECT * FROM evidence_flow_artifacts
       WHERE chain_id = $1 AND block_hash = $2 AND transaction_hash = $3
         AND schema_version = $4 AND producer = $5`,
      [snapshot.chainId, snapshot.blockHash, transactionHash, schemaVersion, producer],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const artifact = this.#flowFromRow(row);
    if (artifact.blockNumber !== snapshot.blockNumber) {
      throw new EvidenceIntegrityError("Flow block number does not match its block hash");
    }
    return artifact;
  }

  /** Flow equivalent of findExecutionArtifact; performs no chain lookup. */
  async findFlowArtifact(
    chainIdInput: string,
    transactionHashInput: string,
    schemaVersion: number,
    preferredProducers: readonly string[] = ["inspector", "debug-cache"],
  ): Promise<FlowArtifact | undefined> {
    const chainId = decimalStringSchema.parse(chainIdInput);
    const transactionHash = hash32Schema.parse(transactionHashInput);
    const version = z.number().int().positive().parse(schemaVersion);
    const producers = z
      .array(z.string().min(1).max(128))
      .min(1)
      .parse([...preferredProducers]);
    const result = await this.#database.query(
      `SELECT * FROM evidence_flow_artifacts
       WHERE chain_id = $1 AND transaction_hash = $2 AND schema_version = $3
         AND producer = ANY($4::text[])
       ORDER BY array_position($4::text[], producer), block_number DESC, created_at DESC
       LIMIT 1`,
      [chainId, transactionHash, version, producers],
    );
    return result.rows[0] ? this.#flowFromRow(result.rows[0]) : undefined;
  }
}

export function asEvidencePool(database: Pool): EvidencePool {
  return database as unknown as EvidencePool;
}
