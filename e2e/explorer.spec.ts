import { expect, test } from "@playwright/test";
import { EXPLORER_API, EXPLORER_WEB, latestInspectedBlock } from "./helpers.js";

test.describe("explorer-api", () => {
  test("mempool status responds", async ({ request }) => {
    const res = await request.get(`${EXPLORER_API}/api/mempool-status`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty("trackedHashes");
    expect(body).toHaveProperty("healthy");
  });

  test("leaderboard aggregates from the shared postgres", async ({ request }) => {
    const res = await request.get(`${EXPLORER_API}/api/leaderboard`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.arbitrageurs)).toBe(true);
    expect(Array.isArray(body.sandwichers)).toBe(true);
    expect(Array.isArray(body.liquidators)).toBe(true);
  });

  test("relay stats respond", async ({ request }) => {
    const res = await request.get(`${EXPLORER_API}/api/relay-stats`);
    expect(res.ok()).toBe(true);
    expect(Array.isArray((await res.json()).relays)).toBe(true);
  });

  test("rejects an invalid block number", async ({ request }) => {
    const res = await request.get(`${EXPLORER_API}/api/block/not-a-number`);
    expect(res.status()).toBe(400);
  });

  test("serves MEV data for an already-inspected block", async ({ request }) => {
    const block = latestInspectedBlock();
    test.skip(block === null, "no inspected blocks in the shared postgres");
    const res = await request.get(`${EXPLORER_API}/api/block/${block}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.blockNumber).toBe(block);
    expect(body.alreadyInspected).toBe(true);
    expect(Array.isArray(body.transactions)).toBe(true);
    expect(body.transactions.length).toBeGreaterThan(0);
    for (const tx of body.transactions) {
      expect(tx).toHaveProperty("hash");
      expect(tx).toHaveProperty("mev");
    }
  });
});

test.describe("explorer-web", () => {
  test("serves the explorer UI through nginx", async ({ page }) => {
    await page.goto(EXPLORER_WEB);
    await expect(page).toHaveTitle("MEV Block Explorer");
    await expect(page.locator("h1")).toHaveText("MEV Block Explorer");
    await expect(page.locator("#blockInput")).toBeVisible();
    await expect(page.locator("#loadBtn")).toBeVisible();
  });

  test("loads an inspected block end-to-end through the /api proxy", async ({ page }) => {
    const block = latestInspectedBlock();
    test.skip(block === null, "no inspected blocks in the shared postgres");

    await page.goto(EXPLORER_WEB);
    // stop live-follow so our manual block load isn't raced by auto-refresh;
    // the raw checkbox is visually hidden behind the styled switch, so
    // toggle through its label
    const live = page.locator("#liveToggle");
    if (await live.isChecked()) await page.locator("label.toggle", { has: live }).click();

    const blockResponse = page.waitForResponse(
      (res) => res.url().includes(`/api/block/${block}`) && res.ok(),
    );
    await page.locator("#blockInput").fill(String(block));
    await page.locator("#loadBtn").click();
    await blockResponse;

    await expect(page.locator("body")).toContainText(String(block));
  });
});
