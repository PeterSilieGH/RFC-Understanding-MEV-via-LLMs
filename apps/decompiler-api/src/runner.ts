import { type ChildProcessWithoutNullStreams, spawn as nodeSpawn } from "node:child_process";
import type { DecompilerConfig } from "./config.js";
import { sanitizeSingleLine, sanitizeText } from "./sanitize.js";
import {
  DECOMPILER_SCHEMA_VERSION,
  type DecompilationError,
  type DecompilationProblem,
  type DecompilationResponse,
  type DecompiledFunction,
  PANORAMIX_ENGINE,
} from "./types.js";

type SpawnProcess = typeof nodeSpawn;

interface AdapterPayload {
  schemaVersion?: unknown;
  text?: unknown;
  contract?: unknown;
  warnings?: unknown;
  adapterError?: unknown;
}

interface AdapterContract {
  functions?: unknown;
  problems?: unknown;
}

interface ProcessCapture {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputExceeded: boolean;
  spawnError?: Error;
}

const EMPTY_RESULT = {
  code: null,
  functions: [] as DecompiledFunction[],
  problems: [] as DecompilationProblem[],
  warnings: [] as string[],
};

function errorResult(
  bytecodeBytes: number,
  durationMs: number,
  status: "timeout" | "error",
  error: DecompilationError,
  warnings: string[] = [],
): DecompilationResponse {
  return {
    schemaVersion: DECOMPILER_SCHEMA_VERSION,
    status,
    engine: PANORAMIX_ENGINE,
    bytecodeBytes,
    durationMs,
    ...EMPTY_RESULT,
    warnings,
    error,
  };
}

function unsupportedResult(
  bytecodeBytes: number,
  durationMs: number,
  message: string,
  warnings: string[] = [],
): DecompilationResponse {
  return {
    schemaVersion: DECOMPILER_SCHEMA_VERSION,
    status: "unsupported",
    engine: PANORAMIX_ENGINE,
    bytecodeBytes,
    durationMs,
    code: null,
    functions: [],
    problems: [{ selector: null, name: null, message }],
    warnings,
  };
}

function isUnsupportedEngineError(message: string): boolean {
  return /(?:unsupported|unknown|invalid) (?:evm )?(?:opcode|instruction)/i.test(message);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? sanitizeText(value) : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function hasConstantValue(value: unknown): boolean | null {
  return value === undefined ? null : value !== null;
}

function readSelector(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return `0x${value.toString(16).padStart(8, "0")}`;
  }
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  if (/^0x[0-9a-f]{8}$/.test(normalized)) return normalized;
  if (/^[0-9a-f]{8}$/.test(normalized)) return `0x${normalized}`;
  if (/^\d+$/.test(normalized)) {
    const decimal = Number(normalized);
    if (Number.isSafeInteger(decimal) && decimal >= 0 && decimal <= 0xffffffff) {
      return `0x${decimal.toString(16).padStart(8, "0")}`;
    }
  }
  return null;
}

function parseFunctions(contract: AdapterContract): DecompiledFunction[] {
  if (!Array.isArray(contract.functions)) return [];
  return contract.functions.flatMap((entry): DecompiledFunction[] => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const name = readString(record.name) ?? readString(record.abi_name) ?? "unknown";
    const safeName = sanitizeSingleLine(name);
    return [
      {
        selector: safeName.includes("fallback") ? null : readSelector(record.hash),
        name: safeName,
        signature: readString(record.abi_name),
        payable: readBoolean(record.payable),
        constant: hasConstantValue(record.const),
        code: readString(record.print),
      },
    ];
  });
}

function parseProblems(contract: AdapterContract): DecompilationProblem[] {
  if (typeof contract.problems !== "object" || contract.problems === null) return [];
  return Object.entries(contract.problems as Record<string, unknown>).map(([selector, value]) => {
    const name = typeof value === "string" ? sanitizeSingleLine(value) : null;
    return {
      selector: readSelector(selector),
      name,
      message: name
        ? `Panoramix could not decompile ${name}`
        : "Panoramix could not decompile this function",
    };
  });
}

function parseWarnings(payload: AdapterPayload, stderr: string): string[] {
  const warnings = Array.isArray(payload.warnings)
    ? payload.warnings
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => sanitizeSingleLine(entry).slice(0, 4_096))
        .filter(Boolean)
    : [];
  const diagnostic = sanitizeSingleLine(stderr).slice(0, 4_096);
  if (diagnostic) warnings.push(diagnostic);
  return [...new Set(warnings)];
}

function killProcessGroup(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child when no detached process group exists.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The process may already have exited.
  }
}

async function captureProcess(
  child: ChildProcessWithoutNullStreams,
  bytecode: string,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<ProcessCapture> {
  let stdout: Buffer = Buffer.alloc(0);
  let stderr: Buffer = Buffer.alloc(0);
  let timedOut = false;
  let outputExceeded = false;
  let spawnError: Error | undefined;
  let totalBytes = 0;
  let forceKill: NodeJS.Timeout | undefined;

  const append = (current: Buffer, chunk: Buffer | string): Buffer => {
    if (outputExceeded) return current;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxOutputBytes) {
      outputExceeded = true;
      killProcessGroup(child, "SIGKILL");
      return current;
    }
    return Buffer.concat([current, buffer]);
  };

  child.stdout.on("data", (chunk: Buffer | string) => {
    stdout = append(stdout, chunk);
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderr = append(stderr, chunk);
  });
  child.stdin.on("error", () => {
    // EPIPE is expected if a bounded worker is terminated before consuming stdin.
  });
  child.once("error", (error) => {
    spawnError = error;
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    killProcessGroup(child, "SIGTERM");
    forceKill = setTimeout(() => killProcessGroup(child, "SIGKILL"), 250);
    forceKill.unref();
  }, timeoutMs);
  timeout.unref();

  child.stdin.end(`${bytecode}\n`);
  const [exitCode, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) =>
    child.once("close", (code, closeSignal) => resolve([code, closeSignal])),
  );
  clearTimeout(timeout);
  if (timedOut) killProcessGroup(child, "SIGKILL");
  if (forceKill !== undefined) clearTimeout(forceKill);

  return {
    exitCode,
    signal,
    stdout: stdout.toString("utf8"),
    stderr: stderr.toString("utf8"),
    timedOut,
    outputExceeded,
    spawnError,
  };
}

export interface PanoramixRunner {
  decompile(bytecode: string, bytecodeBytes: number): Promise<DecompilationResponse>;
}

export function createPanoramixRunner(
  config: DecompilerConfig,
  spawnProcess: SpawnProcess = nodeSpawn,
): PanoramixRunner {
  return {
    async decompile(bytecode, bytecodeBytes) {
      const startedAt = performance.now();
      const child = spawnProcess(config.pythonExecutable, [config.adapterPath], {
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
        env: {
          PATH: "/opt/panoramix/bin:/usr/local/bin:/usr/bin:/bin",
          PYTHONPATH: "/opt/panoramix/lib/python3.10/site-packages",
          PYTHONUNBUFFERED: "1",
          PYTHONDONTWRITEBYTECODE: "1",
          XDG_CACHE_HOME: config.cacheHome,
          HOME: config.cacheHome,
          TMPDIR: config.cacheHome,
          TMP: config.cacheHome,
          TEMP: config.cacheHome,
          NO_COLOR: "1",
          TERM: "dumb",
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8",
        },
      });
      const capture = await captureProcess(
        child,
        bytecode,
        config.timeoutMs,
        config.maxOutputBytes,
      );
      const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
      const diagnostic = sanitizeSingleLine(capture.stderr).slice(0, 4_096);

      if (capture.timedOut) {
        return errorResult(bytecodeBytes, durationMs, "timeout", {
          code: "timeout",
          message: `Panoramix exceeded the ${config.timeoutMs} ms process deadline`,
        });
      }
      if (capture.outputExceeded) {
        return errorResult(bytecodeBytes, durationMs, "error", {
          code: "output_limit",
          message: `Panoramix exceeded the ${config.maxOutputBytes} byte output limit`,
        });
      }
      if (capture.spawnError) {
        return errorResult(bytecodeBytes, durationMs, "error", {
          code: "process_failed",
          message: sanitizeSingleLine(capture.spawnError.message),
        });
      }
      let payload: AdapterPayload | undefined;
      try {
        payload = JSON.parse(capture.stdout) as AdapterPayload;
      } catch {
        // A non-zero process or malformed successful output is handled below.
      }
      if (capture.exitCode !== 0) {
        const adapterMessage =
          typeof payload?.adapterError === "string"
            ? sanitizeSingleLine(payload.adapterError).slice(0, 4_096)
            : null;
        const warnings = payload
          ? parseWarnings(payload, capture.stderr)
          : diagnostic
            ? [diagnostic]
            : [];
        if (adapterMessage && isUnsupportedEngineError(adapterMessage)) {
          return unsupportedResult(bytecodeBytes, durationMs, adapterMessage, warnings);
        }
        return errorResult(
          bytecodeBytes,
          durationMs,
          "error",
          {
            code: "process_failed",
            message:
              adapterMessage ??
              `Panoramix exited with code ${capture.exitCode ?? "null"}${capture.signal ? ` (${capture.signal})` : ""}`,
          },
          warnings,
        );
      }

      if (payload === undefined) {
        return errorResult(
          bytecodeBytes,
          durationMs,
          "error",
          {
            code: "invalid_engine_output",
            message: "Panoramix adapter returned invalid JSON",
          },
          diagnostic ? [diagnostic] : [],
        );
      }

      if (payload.schemaVersion !== DECOMPILER_SCHEMA_VERSION) {
        return errorResult(bytecodeBytes, durationMs, "error", {
          code: "invalid_engine_output",
          message: "Panoramix adapter returned an unsupported schema version",
        });
      }

      if (typeof payload.adapterError === "string") {
        const message = sanitizeSingleLine(payload.adapterError).slice(0, 4_096);
        if (isUnsupportedEngineError(message)) {
          return unsupportedResult(
            bytecodeBytes,
            durationMs,
            message,
            parseWarnings(payload, capture.stderr),
          );
        }
        return errorResult(
          bytecodeBytes,
          durationMs,
          "error",
          {
            code: "process_failed",
            message,
          },
          parseWarnings(payload, capture.stderr),
        );
      }

      const contract =
        typeof payload.contract === "object" && payload.contract !== null
          ? (payload.contract as AdapterContract)
          : {};
      const code = readString(payload.text);
      const functions = parseFunctions(contract);
      const problems = parseProblems(contract);
      const warnings = parseWarnings(payload, capture.stderr);
      const noCode = code?.toLowerCase().includes("no code found for this contract") ?? false;

      if (noCode) {
        return {
          schemaVersion: DECOMPILER_SCHEMA_VERSION,
          status: "unsupported",
          engine: PANORAMIX_ENGINE,
          bytecodeBytes,
          durationMs,
          code,
          functions,
          problems,
          warnings,
        };
      }

      if (!code && functions.length === 0 && problems.length === 0) {
        return errorResult(bytecodeBytes, durationMs, "error", {
          code: "invalid_engine_output",
          message: "Panoramix adapter returned no decompilation evidence",
        });
      }

      const result: DecompilationResponse = {
        schemaVersion: DECOMPILER_SCHEMA_VERSION,
        status: problems.length > 0 ? "partial" : "complete",
        engine: PANORAMIX_ENGINE,
        bytecodeBytes,
        durationMs,
        code,
        functions,
        problems,
        warnings,
      };
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > config.maxOutputBytes) {
        return errorResult(bytecodeBytes, durationMs, "error", {
          code: "output_limit",
          message: `decompilation response exceeds the ${config.maxOutputBytes} byte output limit`,
        });
      }
      return result;
    },
  };
}
