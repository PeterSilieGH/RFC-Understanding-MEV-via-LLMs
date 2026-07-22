import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import type { DecompilerConfig } from "../src/config.js";
import type { PanoramixRunner } from "../src/runner.js";
import { DecompilerService } from "../src/service.js";
import {
  DECOMPILER_SCHEMA_VERSION,
  type DecompilationResponse,
  PANORAMIX_ENGINE,
} from "../src/types.js";

function config(overrides: Partial<DecompilerConfig> = {}): DecompilerConfig {
  return {
    socketPath: "/tmp/unused.sock",
    timeoutMs: 1_000,
    maxBytecodeBytes: 24_576,
    maxOutputBytes: 4 * 1024 * 1024,
    maxConcurrency: 1,
    pythonExecutable: "/usr/bin/python3",
    adapterPath: "/adapter.py",
    cacheHome: "/tmp/cache",
    ...overrides,
  };
}

function completeResult(bytes: number): DecompilationResponse {
  return {
    schemaVersion: DECOMPILER_SCHEMA_VERSION,
    status: "complete",
    engine: PANORAMIX_ENGINE,
    bytecodeBytes: bytes,
    durationMs: 1,
    code: "def main():\n  stop",
    functions: [],
    problems: [],
    warnings: [],
  };
}

function service(runner: PanoramixRunner): DecompilerService {
  return new DecompilerService(config(), runner, pino({ enabled: false }));
}

describe("decompiler service", () => {
  it("validates and normalizes bytecode before invoking the runner", async () => {
    const decompile = vi.fn(async (_bytecode: string, bytes: number) => completeResult(bytes));
    const reply = await service({ decompile }).decompile({ bytecode: "0x60AA" });
    expect(reply.statusCode).toBe(200);
    expect(reply.body.status).toBe("complete");
    expect(decompile).toHaveBeenCalledWith("0x60aa", 2);
  });

  it("returns typed validation errors", async () => {
    const decompile = vi.fn();
    const reply = await service({ decompile } as unknown as PanoramixRunner).decompile({
      bytecode: "not-bytecode",
    });
    expect(reply).toMatchObject({
      statusCode: 400,
      body: { status: "error", error: { code: "invalid_bytecode" } },
    });
    expect(decompile).not.toHaveBeenCalled();
  });

  it("rejects address and provider fields instead of accepting secret-bearing requests", async () => {
    const decompile = vi.fn();
    const reply = await service({ decompile } as unknown as PanoramixRunner).decompile({
      bytecode: "0x6000",
      address: "0x1234",
      rpcUrl: "secret",
    });
    expect(reply).toMatchObject({
      statusCode: 400,
      body: { status: "error", error: { code: "invalid_request" } },
    });
    expect(decompile).not.toHaveBeenCalled();
  });

  it("rejects excess concurrency instead of building an unbounded queue", async () => {
    let finish!: (result: DecompilationResponse) => void;
    const pending = new Promise<DecompilationResponse>((resolve) => {
      finish = resolve;
    });
    const runner = { decompile: vi.fn(() => pending) };
    const decompiler = service(runner);
    const first = decompiler.decompile({ bytecode: "0x6000" });
    await vi.waitFor(() => expect(runner.decompile).toHaveBeenCalledTimes(1));
    const second = await decompiler.decompile({ bytecode: "0x6001" });
    expect(second).toMatchObject({
      statusCode: 429,
      headers: { "Retry-After": "1" },
      body: { status: "error", error: { code: "busy" } },
    });
    finish(completeResult(2));
    expect((await first).statusCode).toBe(200);
  });

  it("maps bounded engine statuses to explicit HTTP statuses", async () => {
    const timeout = {
      ...completeResult(2),
      status: "timeout" as const,
      error: { code: "timeout" as const, message: "deadline" },
    };
    const reply = await service({ decompile: vi.fn(async () => timeout) }).decompile({
      bytecode: "0x6000",
    });
    expect(reply).toMatchObject({
      statusCode: 504,
      body: { status: "timeout", error: { code: "timeout" } },
    });
  });
});
