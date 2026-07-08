import { expect, test } from "@playwright/test";
import { TRACE_API, TRACE_WEB, WETH, anyRecentTxHash } from "./helpers.js";

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

test.describe("trace-web", () => {
  test("serves the trace UI through nginx", async ({ page }) => {
    await page.goto(TRACE_WEB);
    await expect(page.locator("h1")).toHaveText("MEV Trace Explorer");
    await expect(page.locator("input")).toBeVisible();
  });

  test("shows a validation error for garbage input", async ({ page }) => {
    await page.goto(TRACE_WEB);
    await page.locator("input").fill("garbage");
    await page.getByRole("button", { name: "Load" }).click();
    await expect(page.locator(".error")).toContainText("Enter a transaction hash");
  });

  test("renders WETH contract sources end-to-end", async ({ page }) => {
    await page.goto(TRACE_WEB);
    await page.locator("input").fill(`eth:${WETH}`);
    await page.getByRole("button", { name: "Load" }).click();
    await expect(page.locator("h2")).toContainText("WETH9", { timeout: 15_000 });
    await expect(page.locator("pre.source")).toContainText("contract WETH9");
  });

  test("renders a live execution trace when the RPC node is up", async ({ page }) => {
    const txHash = await anyRecentTxHash();
    test.skip(txHash === null, "external RPC node not reachable");

    const graphRes = await fetch(`${TRACE_API}/api/traces/${txHash}/graph`);
    expect(graphRes.ok).toBe(true);
    const graph = await graphRes.json();
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.nodes[0].id).toBe("root");

    await page.goto(TRACE_WEB);
    await page.locator("input").fill(txHash as string);
    await page.getByRole("button", { name: "Load" }).click();
    await expect(page.locator("h2")).toContainText("Trace", { timeout: 15_000 });
    await expect(page.locator("ul.tree")).toBeVisible();
  });
});
