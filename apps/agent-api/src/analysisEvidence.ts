import { loadConfig } from "@mev/config";
import { z } from "zod";
import type { SourceQuality } from "./bundles.js";
import type { FunctionEntry } from "./signatures.js";

const config = loadConfig();
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_FUNCTIONS = 256;
const MAX_FUNCTION_BYTES = 32 * 1024;
const MAX_TOTAL_FUNCTION_BYTES = 512 * 1024;

const entrySchema = z
  .object({
    contract: z.string().max(256).nullable(),
    name: z.string().min(1).max(256),
    signature: z.string().min(1).max(2_000),
    code: z.string().max(MAX_FUNCTION_BYTES).nullable(),
  })
  .strict();

const responseSchema = z
  .object({
    candidateId: z.string().regex(/^[0-9a-f]{24,64}$/),
    artifactRef: z.string().min(1).max(500),
    // Deployment/proxy metadata the gateway attaches; accepted (and currently
    // unused by the reusable code bundle) so strict validation does not reject
    // a well-formed artifact.
    deploymentArtifactRef: z.string().min(1).max(500).optional(),
    proxyType: z.string().max(200).nullable().optional(),
    implementationAddresses: z
      .array(z.string().regex(/^0x[0-9a-f]{40}$/))
      .max(64)
      .optional(),
    address: z.string().regex(/^0x[0-9a-f]{40}$/),
    name: z.string().max(500).nullable(),
    runtimeCodehash: z.string().regex(/^0x[0-9a-f]{64}$/),
    snapshot: z.object({}).passthrough(),
    sourceQuality: z.enum(["verified", "decompiled", "opaque"]),
    provenance: z
      .object({
        kind: z.string().min(1).max(100),
        provider: z.string().min(1).max(200),
        revision: z.string().min(1).max(200),
        contentHash: z.string().max(200).nullable(),
        status: z.string().min(1).max(100),
        warnings: z.array(z.string().max(2_000)).max(64),
      })
      .strict(),
    entries: z.array(entrySchema).max(MAX_FUNCTIONS),
    limitations: z.array(z.string().max(2_000)).max(64),
  })
  .strict();

export interface AnalysisEvidence {
  candidateId: string;
  artifactRef: string;
  address: string;
  name: string | null;
  runtimeCodehash: string;
  sourceQuality: SourceQuality;
  entries: FunctionEntry[];
  provenance: z.infer<typeof responseSchema>["provenance"];
  limitations: string[];
}

export async function resolveAnalysisEvidence(
  project: string,
  candidateId: string,
  signal: AbortSignal,
): Promise<AnalysisEvidence> {
  const response = await fetch(
    `http://localhost:${config.TRACE_API_PORT}/internal/evidence/projects/${encodeURIComponent(project)}/candidates/${encodeURIComponent(candidateId)}/analysis`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal,
    },
  );
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_RESPONSE_BYTES) {
    throw new Error("contract evidence response exceeded 4 MiB");
  }
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("contract evidence response exceeded 4 MiB");
  }
  if (!response.ok) {
    throw new Error(
      `contract evidence resolution failed (${response.status}): ${body.slice(0, 500)}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new Error("contract evidence gateway returned invalid JSON");
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `contract evidence gateway returned an invalid artifact: ${parsed.error.message}`,
    );
  }
  if (parsed.data.candidateId !== candidateId) {
    throw new Error("contract evidence gateway returned a different candidate");
  }
  const totalBytes = parsed.data.entries.reduce(
    (total, entry) => total + Buffer.byteLength(entry.code ?? "", "utf8"),
    0,
  );
  if (totalBytes > MAX_TOTAL_FUNCTION_BYTES) {
    throw new Error("contract evidence function bodies exceeded 512 KiB");
  }
  return {
    candidateId: parsed.data.candidateId,
    artifactRef: parsed.data.artifactRef,
    address: parsed.data.address,
    name: parsed.data.name,
    runtimeCodehash: parsed.data.runtimeCodehash,
    sourceQuality: parsed.data.sourceQuality,
    provenance: parsed.data.provenance,
    entries: parsed.data.entries.map((entry) => ({
      contract: entry.contract,
      name: entry.name,
      signature: entry.signature,
      body: entry.code,
    })),
    limitations: parsed.data.limitations,
  };
}
