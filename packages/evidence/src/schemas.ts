import { z } from "zod";

export const decimalStringSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase());
export const hash32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value.toLowerCase());
export const contentHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const timestampSchema = z.string().datetime({ offset: true });
export const completenessSchema = z.enum(["complete", "partial"]);

export const snapshotSchema = z
  .object({
    chainId: decimalStringSchema,
    blockNumber: decimalStringSchema,
    blockHash: hash32Schema,
  })
  .strict();

export const deploymentSchema = snapshotSchema
  .extend({
    address: addressSchema,
    runtimeCodehash: hash32Schema,
    producer: z.string().min(1).max(128),
    schemaVersion: z.number().int().positive(),
    completeness: completenessSchema,
    observedAt: timestampSchema,
  })
  .strict();

export const contractRelationSchema = snapshotSchema
  .extend({
    fromAddress: addressSchema,
    toAddress: addressSchema,
    relationKind: z.enum(["implementation", "beacon", "facet"]),
    producer: z.string().min(1).max(128),
    metadata: z.record(z.string(), z.unknown()),
    observedAt: timestampSchema,
  })
  .strict();

const retryFields = {
  errorClass: z.string().min(1).max(256).nullable(),
  retryAfter: timestampSchema.nullable(),
  attemptCount: z.number().int().positive(),
  lastAttemptAt: timestampSchema,
};

const sourceBase = z.object({
  runtimeCodehash: hash32Schema,
  provider: z.string().min(1).max(128),
  providerRevision: z.string().min(1).max(256),
  abi: z.unknown().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const sourceArtifactSchema = z.discriminatedUnion("status", [
  sourceBase
    .extend({
      status: z.literal("verified"),
      sourceContentHash: contentHashSchema,
      errorClass: z.null(),
      retryAfter: z.null(),
      attemptCount: z.number().int().positive(),
      lastAttemptAt: timestampSchema,
    })
    .strict(),
  sourceBase
    .extend({
      status: z.enum(["unverified", "error"]),
      sourceContentHash: z.null(),
      ...retryFields,
      errorClass: z.string().min(1).max(256),
    })
    .strict(),
]);

const tokenBase = snapshotSchema.extend({
  tokenAddress: addressSchema,
  runtimeCodehash: hash32Schema,
  producer: z.string().min(1).max(128),
  schemaVersion: z.number().int().positive(),
  completeness: completenessSchema,
  observedAt: timestampSchema,
  updatedAt: timestampSchema,
  attemptCount: z.number().int().positive(),
});

export const tokenMetadataSchema = z.discriminatedUnion("status", [
  tokenBase
    .extend({
      status: z.literal("resolved"),
      symbol: z.string().max(256).nullable(),
      name: z.string().max(512).nullable(),
      decimals: z.number().int().min(0).max(255),
      errorClass: z.null(),
      retryAfter: z.null(),
    })
    .strict(),
  tokenBase
    .extend({
      status: z.enum(["unavailable", "error"]),
      symbol: z.null(),
      name: z.null(),
      decimals: z.null(),
      errorClass: z.string().min(1).max(256),
      retryAfter: timestampSchema.nullable(),
    })
    .strict(),
]);

export const decompiledFunctionSchema = z
  .object({
    selector: z
      .string()
      .regex(/^0x[0-9a-fA-F]{8}$/)
      .transform((value) => value.toLowerCase())
      .nullable(),
    name: z.string().min(1).max(512),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .strict()
  .refine((value) => value.endLine >= value.startLine, "endLine must follow startLine");

const decompilationBase = z.object({
  runtimeCodehash: hash32Schema,
  engine: z.string().min(1).max(128),
  engineRevision: z.string().min(1).max(256),
  optionsHash: contentHashSchema,
  functionIndex: z.array(decompiledFunctionSchema),
  failedFunctions: z.array(z.string().max(512)),
  warnings: z.array(z.string().max(2048)),
  durationMs: z.number().int().nonnegative().nullable(),
  attemptCount: z.number().int().positive(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const decompilationArtifactSchema = z.discriminatedUnion("status", [
  decompilationBase
    .extend({
      status: z.enum(["complete", "partial"]),
      pseudocodeContentHash: contentHashSchema,
      outputHash: contentHashSchema,
      errorClass: z.null(),
      retryAfter: z.null(),
    })
    .strict(),
  decompilationBase
    .extend({
      status: z.enum(["timeout", "unsupported", "error"]),
      pseudocodeContentHash: z.null(),
      outputHash: z.null(),
      errorClass: z.string().min(1).max(256),
      retryAfter: timestampSchema.nullable(),
    })
    .strict(),
]);

export const traceCallSchema = z
  .object({
    traceAddress: z.array(z.number().int().nonnegative()),
    parentTraceAddress: z.array(z.number().int().nonnegative()).nullable(),
    callType: z.enum([
      "CALL",
      "CALLCODE",
      "DELEGATECALL",
      "STATICCALL",
      "CREATE",
      "CREATE2",
      "SELFDESTRUCT",
      "UNKNOWN",
    ]),
    from: addressSchema,
    to: addressSchema.nullable(),
    selector: z
      .string()
      .regex(/^0x[0-9a-fA-F]{8}$/)
      .transform((value) => value.toLowerCase())
      .nullable(),
    inputSize: z.number().int().nonnegative(),
    outputSize: z.number().int().nonnegative().nullable(),
    subtraces: z.number().int().nonnegative(),
    valueWei: decimalStringSchema,
    gas: decimalStringSchema.nullable(),
    gasUsed: decimalStringSchema.nullable(),
    error: z.string().max(4096).nullable(),
    reverted: z.boolean(),
  })
  .strict();

export const executionArtifactSchema = snapshotSchema
  .extend({
    transactionHash: hash32Schema,
    schemaVersion: z.number().int().positive(),
    producer: z.enum(["inspector", "debug-cache", "debug-live"]),
    completeness: completenessSchema,
    capabilities: z.array(z.string().min(1).max(128)),
    calls: z.array(traceCallSchema),
    contentHash: contentHashSchema,
    createdAt: timestampSchema,
  })
  .strict();

const movementBase = z.object({
  id: z.string().min(1).max(512),
  traceAddress: z.array(z.number().int().nonnegative()).nullable(),
  from: addressSchema,
  to: addressSchema,
  amount: decimalStringSchema,
  status: z.enum(["observed", "attempted"]),
});

export const fundMovementSchema = z.discriminatedUnion("kind", [
  movementBase.extend({ kind: z.literal("native"), tokenAddress: z.null() }).strict(),
  movementBase
    .extend({
      kind: z.enum(["erc20", "erc721", "erc1155"]),
      tokenAddress: addressSchema,
    })
    .strict(),
]);

export const flowArtifactSchema = snapshotSchema
  .extend({
    transactionHash: hash32Schema,
    schemaVersion: z.number().int().positive(),
    producer: z.string().min(1).max(128),
    completeness: completenessSchema,
    movements: z.array(fundMovementSchema),
    contentHash: contentHashSchema,
    createdAt: timestampSchema,
  })
  .strict();

export type Snapshot = z.infer<typeof snapshotSchema>;
export type Deployment = z.infer<typeof deploymentSchema>;
export type ContractRelation = z.infer<typeof contractRelationSchema>;
export type SourceArtifact = z.infer<typeof sourceArtifactSchema>;
export type TokenMetadata = z.infer<typeof tokenMetadataSchema>;
export type DecompiledFunction = z.infer<typeof decompiledFunctionSchema>;
export type DecompilationArtifact = z.infer<typeof decompilationArtifactSchema>;
export type TraceCall = z.infer<typeof traceCallSchema>;
export type ExecutionArtifact = z.infer<typeof executionArtifactSchema>;
export type FundMovement = z.infer<typeof fundMovementSchema>;
export type FlowArtifact = z.infer<typeof flowArtifactSchema>;
