import { expect, test } from "@playwright/test";
import { TRACE_API, WETH, anyRecentTxHash } from "./helpers.js";

test.describe("trace-api", () => {
  test("health responds", async ({ request }) => {
    const res = await request.get(`${TRACE_API}/health`);
    expect(res.ok()).toBe(true);
    expect(await res.text()).toBe("OK");
  });

  test("rejects an invalid transaction hash", async ({ request }) => {
    const res = await request.get(`${TRACE_API}/api/traces/0x1234/graph`);
    expect(res.status()).toBe(400);
  });

  test("rejects an invalid address", async ({ request }) => {
    const res = await request.get(`${TRACE_API}/api/contracts/bogus/code`);
    expect(res.status()).toBe(400);
  });

  test("serves WETH sources via Etherscan, accepting eth:-prefixed addresses", async ({
    request,
  }) => {
    const res = await request.get(`${TRACE_API}/api/contracts/eth:${WETH}/code`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.address).toBe(WETH);
    expect(body.entryName).toBe("WETH9");
    expect(body.sources[0].code).toContain("contract WETH9");
  });

  test("serves WETH metadata", async ({ request }) => {
    const res = await request.get(`${TRACE_API}/api/contracts/${WETH}/meta`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.name).toBe("WETH9");
    expect(body.abiEntryCount).toBeGreaterThan(0);
  });
});

test.describe("trace graph endpoint", () => {
  test("returns a rooted graph for a live transaction", async ({ request }) => {
    const txHash = await anyRecentTxHash();
    test.skip(txHash === null, "external RPC node not reachable");

    const res = await request.get(`${TRACE_API}/api/traces/${txHash}/graph`);
    expect(res.ok()).toBe(true);
    const graph = await res.json();
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.nodes[0].id).toBe("root");
  });
});
