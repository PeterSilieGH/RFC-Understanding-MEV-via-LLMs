import { describe, expect, it } from "vitest";
import { DebugTraceCache } from "../src/provider.js";

const TRACE = {
  type: "CALL",
  from: "0x0000000000000000000000000000000000000001",
  to: "0x0000000000000000000000000000000000000002",
  input: "0x",
  output: "0x",
  value: "0x0",
  gas: "0x100",
  gasUsed: "0x10",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("debug trace in-flight coalescing", () => {
  it("shares one cold provider request and caches the successful result", async () => {
    const gate = deferred<unknown>();
    let calls = 0;
    const cache = new DebugTraceCache(
      {
        send: async () => {
          calls++;
          return gate.promise;
        },
      },
      1000,
    );

    const first = cache.get(`0x${"1".repeat(64)}`);
    const second = cache.get(`0x${"1".repeat(64)}`);
    expect(calls).toBe(1);
    expect(cache.stats()).toEqual({ completed: 0, inFlight: 1 });
    gate.resolve(TRACE);
    expect(await first).toEqual(await second);
    await cache.get(`0x${"1".repeat(64)}`);
    expect(calls).toBe(1);
    expect(cache.stats()).toEqual({ completed: 1, inFlight: 0 });
  });

  it("does not poison the cache when the shared request rejects", async () => {
    let calls = 0;
    const cache = new DebugTraceCache({
      send: async () => {
        calls++;
        if (calls === 1) throw new Error("temporary failure");
        return TRACE;
      },
    });
    const hash = `0x${"2".repeat(64)}`;

    const results = await Promise.allSettled([cache.get(hash), cache.get(hash)]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(calls).toBe(1);
    expect(cache.stats()).toEqual({ completed: 0, inFlight: 0 });

    await expect(cache.get(hash)).resolves.toMatchObject({ type: "CALL" });
    expect(calls).toBe(2);
  });
});
