import { isAbsolute, resolve } from "node:path";

const DEFAULT_SOCKET_PATH = "/run/decompiler-api/decompiler.sock";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTECODE_BYTES = 24_576;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENCY = 1;

const MAX_TIMEOUT_MS = 180_000;
const MAX_BYTECODE_BYTES = 24_576;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_CONCURRENCY = 4;

export interface DecompilerConfig {
  socketPath: string;
  timeoutMs: number;
  maxBytecodeBytes: number;
  maxOutputBytes: number;
  maxConcurrency: number;
  pythonExecutable: string;
  adapterPath: string;
  cacheHome: string;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function loadDecompilerConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DecompilerConfig {
  const configuredSocketPath = env.DECOMPILER_API_SOCKET ?? DEFAULT_SOCKET_PATH;
  if (!isAbsolute(configuredSocketPath) || !configuredSocketPath.endsWith(".sock")) {
    throw new Error("DECOMPILER_API_SOCKET must be an absolute .sock path");
  }
  const socketPath = resolve(configuredSocketPath);

  return {
    socketPath,
    timeoutMs: boundedInteger(
      env.DECOMPILER_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      100,
      MAX_TIMEOUT_MS,
      "DECOMPILER_TIMEOUT_MS",
    ),
    maxBytecodeBytes: boundedInteger(
      env.DECOMPILER_MAX_BYTECODE_BYTES,
      DEFAULT_MAX_BYTECODE_BYTES,
      1,
      MAX_BYTECODE_BYTES,
      "DECOMPILER_MAX_BYTECODE_BYTES",
    ),
    maxOutputBytes: boundedInteger(
      env.DECOMPILER_MAX_OUTPUT_BYTES,
      DEFAULT_MAX_OUTPUT_BYTES,
      1024,
      MAX_OUTPUT_BYTES,
      "DECOMPILER_MAX_OUTPUT_BYTES",
    ),
    maxConcurrency: boundedInteger(
      env.DECOMPILER_MAX_CONCURRENCY,
      DEFAULT_MAX_CONCURRENCY,
      1,
      MAX_CONCURRENCY,
      "DECOMPILER_MAX_CONCURRENCY",
    ),
    pythonExecutable: env.DECOMPILER_PYTHON ?? "/opt/panoramix/bin/python",
    adapterPath:
      env.DECOMPILER_PANORAMIX_ADAPTER ?? "/repo/apps/decompiler-api/python/panoramix_adapter.py",
    cacheHome: resolve(env.DECOMPILER_CACHE_HOME ?? "/tmp/panoramix-cache"),
  };
}
