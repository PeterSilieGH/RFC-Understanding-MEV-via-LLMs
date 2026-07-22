import { describe, expect, it } from "vitest";
import { loadDecompilerConfig } from "../src/config.js";

describe("loadDecompilerConfig", () => {
  it("loads only bounded service configuration", () => {
    const config = loadDecompilerConfig({
      DECOMPILER_API_SOCKET: "/tmp/test-decompiler.sock",
      DECOMPILER_TIMEOUT_MS: "1234",
      DECOMPILER_MAX_BYTECODE_BYTES: "100",
      DECOMPILER_MAX_OUTPUT_BYTES: "2048",
      DECOMPILER_MAX_CONCURRENCY: "2",
      RPC_URL: "must-not-be-used",
      ETHERSCAN_API_KEY: "must-not-be-used",
    });
    expect(config).toMatchObject({
      socketPath: "/tmp/test-decompiler.sock",
      timeoutMs: 1234,
      maxBytecodeBytes: 100,
      maxOutputBytes: 2048,
      maxConcurrency: 2,
    });
    expect(config).not.toHaveProperty("RPC_URL");
    expect(config).not.toHaveProperty("ETHERSCAN_API_KEY");
  });

  it("rejects unsafe bounds and non-socket paths", () => {
    expect(() => loadDecompilerConfig({ DECOMPILER_TIMEOUT_MS: "0" })).toThrow();
    expect(() => loadDecompilerConfig({ DECOMPILER_MAX_BYTECODE_BYTES: "24577" })).toThrow();
    expect(() => loadDecompilerConfig({ DECOMPILER_API_SOCKET: "/tmp/decompiler" })).toThrow();
    expect(() => loadDecompilerConfig({ DECOMPILER_API_SOCKET: "decompiler.sock" })).toThrow();
  });
});
