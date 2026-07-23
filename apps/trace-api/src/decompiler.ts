import { request as httpRequest } from "node:http";
import { type DecompilationResponse, PANORAMIX_ENGINE } from "@mev/decompiler-api";
import {
  type CodeArtifact,
  type DecompilationArtifact,
  type DecompiledFunction,
  type PutDecompilationArtifact,
  hashJson,
} from "@mev/evidence";
import { z } from "zod";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();

export const DECOMPILER_OPTIONS_HASH = hashJson({
  contractVersion: 1,
  renderer: "panoramix-structured-functions-v1",
});

const functionSchema = z
  .object({
    selector: z.string().nullable(),
    name: z.string(),
    signature: z.string().nullable(),
    payable: z.boolean().nullable(),
    constant: z.boolean().nullable(),
    code: z.string().nullable(),
  })
  .strict();

const problemSchema = z
  .object({
    selector: z.string().nullable(),
    name: z.string().nullable(),
    message: z.string(),
  })
  .strict();

const responseSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["complete", "partial", "timeout", "unsupported", "error"]),
    engine: z
      .object({
        name: z.literal(PANORAMIX_ENGINE.name),
        version: z.literal(PANORAMIX_ENGINE.version),
        revision: z.literal(PANORAMIX_ENGINE.revision),
        license: z.literal(PANORAMIX_ENGINE.license),
      })
      .strict(),
    bytecodeBytes: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    code: z.string().nullable(),
    functions: z.array(functionSchema),
    problems: z.array(problemSchema),
    warnings: z.array(z.string()),
    error: z
      .object({
        code: z.enum([
          "invalid_request",
          "invalid_bytecode",
          "bytecode_too_large",
          "busy",
          "timeout",
          "output_limit",
          "process_failed",
          "invalid_engine_output",
          "internal_error",
        ]),
        message: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict();

export interface DecompilerTransport {
  decompile(bytecode: string): Promise<DecompilationResponse>;
}

/** Bounded HTTP-over-UDS client. No address, RPC URL, or credentials cross it. */
export class UnixDecompilerClient implements DecompilerTransport {
  constructor(
    private readonly socketPath: string,
    private readonly timeoutMs: number,
    private readonly maxResponseBytes = MAX_RESPONSE_BYTES,
  ) {}

  async decompile(bytecode: string): Promise<DecompilationResponse> {
    const body = JSON.stringify({ bytecode });
    const raw = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };
      const req = httpRequest(
        {
          socketPath: this.socketPath,
          path: "/api/decompile",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let received = 0;
          response.on("data", (chunk: Buffer) => {
            received += chunk.byteLength;
            if (received > this.maxResponseBytes) {
              req.destroy(new Error("decompiler response exceeded the client limit"));
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => finish(() => resolve(Buffer.concat(chunks).toString("utf8"))));
        },
      );
      const timer = setTimeout(() => {
        req.destroy(new Error("decompiler request timed out"));
      }, this.timeoutMs);
      req.on("error", (error) => finish(() => reject(error)));
      req.end(body);
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("decompiler returned malformed JSON");
    }
    return responseSchema.parse(parsed) as DecompilationResponse;
  }
}

interface DecompilationStore {
  getCodeArtifact(runtimeCodehash: string): Promise<CodeArtifact | undefined>;
  getDecompilationArtifact(
    runtimeCodehash: string,
    engine: string,
    engineRevision: string,
    optionsHash: string,
  ): Promise<(DecompilationArtifact & { pseudocode: Uint8Array | null }) | undefined>;
  putDecompilationArtifact(input: PutDecompilationArtifact): Promise<DecompilationArtifact>;
}

export interface ResolvedDecompilation {
  artifact: DecompilationArtifact;
  pseudocode: Uint8Array | null;
  cache: "hit" | "miss";
}

/** Durable exact-key cache plus process-local in-flight coalescing. */
export class DecompilationGateway {
  readonly #inFlight = new Map<string, Promise<ResolvedDecompilation>>();

  constructor(
    private readonly store: DecompilationStore,
    private readonly client: DecompilerTransport,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolve(runtimeCodehash: string): Promise<ResolvedDecompilation> {
    const key = decompilationKey(runtimeCodehash);
    const active = this.#inFlight.get(key);
    if (active) return active;
    const request = this.#resolve(runtimeCodehash).finally(() => {
      if (this.#inFlight.get(key) === request) this.#inFlight.delete(key);
    });
    this.#inFlight.set(key, request);
    return request;
  }

  async #resolve(runtimeCodehash: string): Promise<ResolvedDecompilation> {
    const cached = await this.store.getDecompilationArtifact(
      runtimeCodehash,
      PANORAMIX_ENGINE.name,
      PANORAMIX_ENGINE.revision,
      DECOMPILER_OPTIONS_HASH,
    );
    if (cached && cacheIsCurrent(cached, this.now())) {
      return { artifact: cached, pseudocode: cached.pseudocode, cache: "hit" };
    }
    const code = await this.store.getCodeArtifact(runtimeCodehash);
    if (!code) throw new Error(`runtime bytecode is unavailable for ${runtimeCodehash}`);

    let response: DecompilationResponse;
    try {
      response = await this.client.decompile(`0x${Buffer.from(code.bytecode).toString("hex")}`);
    } catch (error) {
      const artifact = await this.store.putDecompilationArtifact({
        ...decompilationIdentity(runtimeCodehash),
        status: "error",
        errorClass: transportErrorClass(error),
        retryAfter: new Date(this.now().getTime() + 60_000).toISOString(),
        attemptCount: (cached?.attemptCount ?? 0) + 1,
        warnings: [boundedMessage(error)],
      });
      return { artifact, pseudocode: null, cache: "miss" };
    }

    const stored = await storeResponse(
      this.store,
      runtimeCodehash,
      response,
      (cached?.attemptCount ?? 0) + 1,
      this.now(),
    );
    return { ...stored, cache: "miss" };
  }
}

function decompilationIdentity(runtimeCodehash: string) {
  return {
    runtimeCodehash,
    engine: PANORAMIX_ENGINE.name,
    engineRevision: PANORAMIX_ENGINE.revision,
    optionsHash: DECOMPILER_OPTIONS_HASH,
  } as const;
}

function decompilationKey(runtimeCodehash: string): string {
  return [
    runtimeCodehash.toLowerCase(),
    PANORAMIX_ENGINE.name,
    PANORAMIX_ENGINE.revision,
    DECOMPILER_OPTIONS_HASH,
  ].join(":");
}

function cacheIsCurrent(artifact: DecompilationArtifact, now: Date): boolean {
  if (artifact.status === "complete" || artifact.status === "partial") return true;
  return artifact.retryAfter !== null && new Date(artifact.retryAfter).getTime() > now.getTime();
}

async function storeResponse(
  store: DecompilationStore,
  runtimeCodehash: string,
  response: DecompilationResponse,
  attemptCount: number,
  now: Date,
): Promise<{ artifact: DecompilationArtifact; pseudocode: Uint8Array | null }> {
  if (response.status === "complete" || response.status === "partial") {
    const rendered = renderStructuredDecompilation(response);
    if (rendered.pseudocode.byteLength === 0) {
      const artifact = await store.putDecompilationArtifact({
        ...decompilationIdentity(runtimeCodehash),
        status: "error",
        errorClass: "empty-output",
        retryAfter: new Date(now.getTime() + 15 * 60_000).toISOString(),
        attemptCount,
        durationMs: response.durationMs,
        warnings: boundWarnings([
          ...response.warnings,
          "decompiler returned no usable structured output",
        ]),
      });
      return { artifact, pseudocode: null };
    }
    const artifact = await store.putDecompilationArtifact({
      ...decompilationIdentity(runtimeCodehash),
      status: response.status,
      pseudocode: rendered.pseudocode,
      mediaType: "text/x-panoramix; charset=utf-8",
      functionIndex: rendered.functionIndex,
      failedFunctions: response.problems.map(
        (problem) => problem.name ?? problem.selector ?? "unknown",
      ),
      warnings: boundWarnings([
        ...response.warnings,
        ...response.problems.map((problem) => problem.message),
      ]),
      durationMs: response.durationMs,
      attemptCount,
    });
    return { artifact, pseudocode: rendered.pseudocode };
  }

  const artifact = await store.putDecompilationArtifact({
    ...decompilationIdentity(runtimeCodehash),
    status: response.status,
    errorClass: response.error?.code ?? response.status,
    retryAfter: retryAfter(response, now),
    attemptCount,
    durationMs: response.durationMs,
    failedFunctions: response.problems.map(
      (problem) => problem.name ?? problem.selector ?? "unknown",
    ),
    warnings: boundWarnings([
      ...response.warnings,
      ...response.problems.map((problem) => problem.message),
      ...(response.error ? [response.error.message] : []),
    ]),
  });
  return { artifact, pseudocode: null };
}

function renderStructuredDecompilation(response: DecompilationResponse): {
  pseudocode: Uint8Array;
  functionIndex: DecompiledFunction[];
} {
  const lines: string[] = [];
  if (response.code?.trim()) {
    lines.push("# Panoramix recovered program", response.code.trim(), "");
  }
  const functionIndex: DecompiledFunction[] = [];
  for (const fn of response.functions) {
    const startLine = lines.length + 1;
    lines.push(`# function ${fn.name}${fn.selector ? ` (${fn.selector})` : ""}`);
    if (fn.signature) lines.push(`# signature: ${fn.signature}`);
    lines.push(fn.code?.trim() || `${fn.name}: # body unavailable`);
    const endLine = lines.length;
    functionIndex.push({
      selector: normalizedSelector(fn.selector),
      name: fn.name || fn.selector || "unknown",
      startLine,
      endLine,
    });
    lines.push("");
  }
  return {
    pseudocode: encoder.encode(lines.join("\n").trim()),
    functionIndex,
  };
}

function normalizedSelector(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  return /^0x[0-9a-f]{8}$/.test(normalized) ? normalized : null;
}

function retryAfter(response: DecompilationResponse, now: Date): string {
  const retryMs =
    response.status === "timeout"
      ? 5 * 60_000
      : response.status === "unsupported"
        ? 24 * 60 * 60_000
        : response.error?.code === "busy"
          ? 5_000
          : 15 * 60_000;
  return new Date(now.getTime() + retryMs).toISOString();
}

function transportErrorClass(error: unknown): string {
  if (error instanceof Error && /timed out/i.test(error.message)) return "transport-timeout";
  return "transport-error";
}

function boundedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2_048);
}

// Panoramix problem/error messages can exceed the evidence schema's per-warning
// cap. An oversized (or too-numerous) warning list previously failed the whole
// artifact write with a Zod 502, which aborted every child contract-analysis for
// the affected contract. Bound to the *tighter* of the two consumers — the
// packages/evidence store (≤2048 chars) and agent-api's analysisEvidence
// (≤2000 chars, ≤64 entries) — so a long diagnostic degrades to a truncated note
// instead of breaking evidence resolution.
const MAX_WARNINGS = 64;
const MAX_WARNING_CHARS = 2_000;
function boundWarnings(warnings: readonly string[]): string[] {
  return warnings.slice(0, MAX_WARNINGS).map((warning) => warning.slice(0, MAX_WARNING_CHARS));
}
