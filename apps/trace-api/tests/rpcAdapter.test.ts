import { describe, expect, it } from "vitest";
import { DiscoveryRpcAdapter, isLogRangeError } from "../src/rpcAdapter.js";

describe("discovery RPC adapter", () => {
  it.each([
    "Log response size exceeded. Use a 2K block range",
    "query returned more than 10000 results",
    "query timeout exceeded. Consider reducing your block range",
    "eth_getLogs block range too large",
    "requested range exceed maximum block range of 100000",
    "query exceeds max block range 100000",
  ])("recognizes log range failures: %s", (message) => {
    expect(isLogRangeError({ message })).toBe(true);
  });

  it("does not mistake unrelated provider failures for pagination", () => {
    expect(isLogRangeError({ message: "execution reverted" })).toBe(false);
  });

  it("splits rejected log ranges, bounds old history, and deduplicates pages", async () => {
    const ranges: [number, number][] = [];
    const adapter = new DiscoveryRpcAdapter(
      async (method, params) => {
        if (method === "eth_blockNumber") return "0x64";
        const filter = params[0] as { fromBlock: string; toBlock: string };
        const from = Number.parseInt(filter.fromBlock, 16);
        const to = Number.parseInt(filter.toBlock, 16);
        ranges.push([from, to]);
        if (to - from >= 2) throw new Error("query exceeds max block range 2");
        return [
          { blockHash: "0xb", transactionHash: "0xt", logIndex: "0x0", from, to },
        ];
      },
      { maxLogBlocks: 10, logPageSize: 10 },
    );

    const result = await adapter.send("eth_getLogs", [
      { fromBlock: "0x0", toBlock: "0x64", address: "0xabc" },
    ]);
    // head 100 with a ten-block window starts at 91; every attempted range is bounded.
    expect(ranges.every(([from]) => from >= 91)).toBe(true);
    expect(ranges.some(([from, to]) => from !== to)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it("coalesces and persists only snapshot-tagged code reads", async () => {
    let calls = 0;
    const adapter = new DiscoveryRpcAdapter(
      async () => {
        calls++;
        return "0x6000";
      },
      { maxLogBlocks: 10, logPageSize: 10 },
    );
    const params = ["0x0000000000000000000000000000000000000001", "0x10"];
    await Promise.all([
      adapter.send("eth_getCode", params),
      adapter.send("eth_getCode", params),
    ]);
    await adapter.send("eth_getCode", params);
    expect(calls).toBe(1);
    expect(adapter.stats()).toEqual({ immutable: 1, inFlight: 0 });

    await adapter.send("eth_getCode", [params[0], "latest"]);
    await adapter.send("eth_getCode", [params[0], "latest"]);
    expect(calls).toBe(3);
  });
});
