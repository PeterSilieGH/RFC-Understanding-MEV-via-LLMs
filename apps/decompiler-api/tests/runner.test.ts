import type { ChildProcessWithoutNullStreams, spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { DecompilerConfig } from "../src/config.js";
import { createPanoramixRunner } from "../src/runner.js";

function config(overrides: Partial<DecompilerConfig> = {}): DecompilerConfig {
  return {
    socketPath: "/tmp/test-decompiler.sock",
    timeoutMs: 1_000,
    maxBytecodeBytes: 24_576,
    maxOutputBytes: 4 * 1024 * 1024,
    maxConcurrency: 1,
    pythonExecutable: "/opt/panoramix/bin/python",
    adapterPath: "/adapter.py",
    cacheHome: "/tmp/test-decompiler-cache",
    ...overrides,
  };
}

type SpawnProcess = typeof nodeSpawn;

function adapterPayload(bytecode: string): { stdout: string; stderr?: string; exitCode?: number } {
  if (bytecode === "0x6002") return { stdout: "x".repeat(8_192) };
  if (bytecode === "0x6003") return { stdout: "not json" };
  if (bytecode === "0x6004") {
    return {
      stdout: JSON.stringify({
        schemaVersion: 1,
        text: "# no secrets inherited",
        contract: { functions: [], problems: {} },
      }),
    };
  }
  if (bytecode === "0x6005") {
    return {
      stdout: JSON.stringify({
        schemaVersion: 1,
        adapterError: "KeyError: unsupported opcode 0xaa",
        warnings: [],
      }),
      exitCode: 2,
    };
  }
  if (bytecode === "0x00") {
    return {
      stdout: JSON.stringify({
        schemaVersion: 1,
        text: "\u001b[90m# No code found for this contract.\u001b[0m",
        contract: {},
        warnings: [],
      }),
    };
  }
  return {
    stdout: JSON.stringify({
      schemaVersion: 1,
      text: "\u001b[32mdef transfer(address _to, uint256 _value):\u001b[0m\n  stop\u0000",
      contract: {
        functions: [
          {
            hash: "a9059cbb",
            name: "transfer(address,uint256)",
            abi_name: "transfer(address,uint256)",
            payable: false,
            const: null,
            print: "\u001b[32mdef transfer(address _to, uint256 _value):\u001b[0m\n  stop",
          },
        ],
        problems: { "0xdeadbeef": "unknown_deadbeef()" },
      },
      warnings: ["\u001b[31mpartial result\u001b[0m"],
    }),
    stderr: "\u001b[33mrecoverable diagnostic\u001b[0m\u0001",
  };
}

function createFakeSpawn(): {
  spawnProcess: SpawnProcess;
  environment: () => NodeJS.ProcessEnv | undefined;
} {
  let childEnvironment: NodeJS.ProcessEnv | undefined;
  const spawnProcess = ((_command: unknown, _args: unknown, options: unknown) => {
    childEnvironment = (options as { env?: NodeJS.ProcessEnv }).env;
    const child = new EventEmitter() as ChildProcessWithoutNullStreams;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let input = "";
    let closed = false;
    const close = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (closed) return;
      closed = true;
      queueMicrotask(() => child.emit("close", exitCode, signal));
    };
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk: string) => {
      input += chunk;
    });
    stdin.on("finish", () => {
      const bytecode = input.trim();
      if (bytecode === "0x6001") return;
      const output = adapterPayload(bytecode);
      if (output.stderr) stderr.write(output.stderr);
      stdout.write(output.stdout);
      stdout.end();
      stderr.end();
      close(output.exitCode ?? 0, null);
    });
    Object.assign(child, {
      stdin,
      stdout,
      stderr,
      pid: undefined,
      kill: (signal: NodeJS.Signals) => {
        close(null, signal);
        return true;
      },
    });
    return child;
  }) as SpawnProcess;
  return { spawnProcess, environment: () => childEnvironment };
}

describe("Panoramix runner", () => {
  it("returns sanitized structured partial evidence", async () => {
    const { spawnProcess } = createFakeSpawn();
    const result = await createPanoramixRunner(config(), spawnProcess).decompile("0x6000", 2);
    expect(result.status).toBe("partial");
    expect(result.code).toBe("def transfer(address _to, uint256 _value):\n  stop");
    expect(result.functions).toEqual([
      {
        selector: "0xa9059cbb",
        name: "transfer(address,uint256)",
        signature: "transfer(address,uint256)",
        payable: false,
        constant: false,
        code: "def transfer(address _to, uint256 _value):\n  stop",
      },
    ]);
    expect(result.problems).toEqual([
      {
        selector: "0xdeadbeef",
        name: "unknown_deadbeef()",
        message: "Panoramix could not decompile unknown_deadbeef()",
      },
    ]);
    expect(result.warnings).toEqual(["partial result", "recoverable diagnostic"]);
  });

  it("classifies a no-code result as unsupported", async () => {
    const { spawnProcess } = createFakeSpawn();
    const result = await createPanoramixRunner(config(), spawnProcess).decompile("0x00", 1);
    expect(result.status).toBe("unsupported");
    expect(result.code).not.toContain("\u001b");
  });

  it("kills a process at the external deadline", async () => {
    const { spawnProcess } = createFakeSpawn();
    const result = await createPanoramixRunner(config({ timeoutMs: 50 }), spawnProcess).decompile(
      "0x6001",
      2,
    );
    expect(result).toMatchObject({ status: "timeout", error: { code: "timeout" } });
  });

  it("kills a process that exceeds the output cap", async () => {
    const { spawnProcess } = createFakeSpawn();
    const result = await createPanoramixRunner(
      config({ maxOutputBytes: 128 }),
      spawnProcess,
    ).decompile("0x6002", 2);
    expect(result).toMatchObject({ status: "error", error: { code: "output_limit" } });
  });

  it("rejects malformed adapter output", async () => {
    const { spawnProcess } = createFakeSpawn();
    const result = await createPanoramixRunner(config(), spawnProcess).decompile("0x6003", 2);
    expect(result).toMatchObject({
      status: "error",
      error: { code: "invalid_engine_output" },
    });
  });

  it("does not inherit RPC or API key environment variables", async () => {
    const fake = createFakeSpawn();
    const result = await createPanoramixRunner(config(), fake.spawnProcess).decompile("0x6004", 2);
    expect(result.status).toBe("complete");
    expect(result.error).toBeUndefined();
    expect(Object.keys(fake.environment() ?? {})).not.toEqual(
      expect.arrayContaining(["RPC_URL", "ETHERSCAN_API_KEY", "WEB3_PROVIDER_URI"]),
    );
  });

  it("classifies unsupported opcodes without crashing the worker", async () => {
    const { spawnProcess } = createFakeSpawn();
    const result = await createPanoramixRunner(config(), spawnProcess).decompile("0x6005", 2);
    expect(result).toMatchObject({
      status: "unsupported",
      problems: [{ message: "KeyError: unsupported opcode 0xaa" }],
    });
  });
});
