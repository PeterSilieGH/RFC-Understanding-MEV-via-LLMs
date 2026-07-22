import type { Logger } from "pino";
import { validateBytecode } from "./bytecode.js";
import type { DecompilerConfig } from "./config.js";
import type { PanoramixRunner } from "./runner.js";
import {
  DECOMPILER_SCHEMA_VERSION,
  type DecompilationError,
  type DecompilationResponse,
  PANORAMIX_ENGINE,
} from "./types.js";

export interface ServiceReply {
  statusCode: number;
  headers?: Readonly<Record<string, string>>;
  body: DecompilationResponse;
}

export function requestError(error: DecompilationError, bytecodeBytes = 0): DecompilationResponse {
  return {
    schemaVersion: DECOMPILER_SCHEMA_VERSION,
    status: "error",
    engine: PANORAMIX_ENGINE,
    bytecodeBytes,
    durationMs: 0,
    code: null,
    functions: [],
    problems: [],
    warnings: [],
    error,
  };
}

export class DecompilerService {
  private active = 0;

  constructor(
    private readonly config: DecompilerConfig,
    private readonly runner: PanoramixRunner,
    private readonly logger: Logger,
  ) {}

  async decompile(body: unknown): Promise<ServiceReply> {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return {
        statusCode: 400,
        body: requestError({
          code: "invalid_request",
          message: "request body must be an object containing bytecode",
        }),
      };
    }

    const requestBody = body as Record<string, unknown>;
    if (
      Object.keys(requestBody).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(requestBody, "bytecode")
    ) {
      return {
        statusCode: 400,
        body: requestError({
          code: "invalid_request",
          message: "bytecode is the only accepted request field",
        }),
      };
    }

    const validation = validateBytecode(requestBody.bytecode, this.config.maxBytecodeBytes);
    if (!validation.ok) {
      return {
        statusCode: validation.code === "bytecode_too_large" ? 413 : 400,
        body: requestError(
          { code: validation.code, message: validation.message },
          validation.bytes,
        ),
      };
    }

    if (this.active >= this.config.maxConcurrency) {
      return {
        statusCode: 429,
        headers: { "Retry-After": "1" },
        body: requestError(
          { code: "busy", message: "all decompiler worker slots are busy" },
          validation.bytecode.bytes,
        ),
      };
    }

    this.active += 1;
    try {
      const result = await this.runner.decompile(
        validation.bytecode.hex,
        validation.bytecode.bytes,
      );
      return {
        statusCode: result.status === "timeout" ? 504 : result.status === "error" ? 502 : 200,
        body: result,
      };
    } catch (error) {
      this.logger.error({ err: error }, "unhandled decompiler failure");
      return {
        statusCode: 500,
        body: requestError(
          { code: "internal_error", message: "decompiler request failed" },
          validation.bytecode.bytes,
        ),
      };
    } finally {
      this.active -= 1;
    }
  }
}
