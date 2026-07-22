export const DECOMPILER_SCHEMA_VERSION = 1 as const;
export const PANORAMIX_NAME = "panoramix" as const;
export const PANORAMIX_VERSION = "0.6.1" as const;
export const PANORAMIX_REVISION = "23edd11058abafcba9340afc768d2aa9274c0b62" as const;
export const PANORAMIX_LICENSE = "MIT" as const;

export type DecompilationStatus = "complete" | "partial" | "timeout" | "unsupported" | "error";

export interface DecompilerEngine {
  name: typeof PANORAMIX_NAME;
  version: typeof PANORAMIX_VERSION;
  revision: typeof PANORAMIX_REVISION;
  license: typeof PANORAMIX_LICENSE;
}

export interface DecompiledFunction {
  selector: string | null;
  name: string;
  signature: string | null;
  payable: boolean | null;
  constant: boolean | null;
  code: string | null;
}

export interface DecompilationProblem {
  selector: string | null;
  name: string | null;
  message: string;
}

export interface DecompilationError {
  code:
    | "invalid_request"
    | "invalid_bytecode"
    | "bytecode_too_large"
    | "busy"
    | "timeout"
    | "output_limit"
    | "process_failed"
    | "invalid_engine_output"
    | "internal_error";
  message: string;
}

export interface DecompilationResponse {
  schemaVersion: typeof DECOMPILER_SCHEMA_VERSION;
  status: DecompilationStatus;
  engine: DecompilerEngine;
  bytecodeBytes: number;
  durationMs: number;
  code: string | null;
  functions: DecompiledFunction[];
  problems: DecompilationProblem[];
  warnings: string[];
  error?: DecompilationError;
}

export const PANORAMIX_ENGINE: DecompilerEngine = {
  name: PANORAMIX_NAME,
  version: PANORAMIX_VERSION,
  revision: PANORAMIX_REVISION,
  license: PANORAMIX_LICENSE,
};
