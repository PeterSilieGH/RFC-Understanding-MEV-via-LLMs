import { expect, test } from "@playwright/test";
import { anyRecentTxHash, anySandwichFrontrunTxHash, anySwapTxHash } from "./helpers.js";

const DISCO_WEB = `http://localhost:${process.env.DISCO_WEB_PORT || 8082}`;
const DISCO_API = `http://localhost:${process.env.DISCO_API_PORT || 2021}`;

test.describe("disco-api (l2b ui from the submodule)", () => {
  test("health responds", async ({ request }) => {
    const res = await request.get(`${DISCO_API}/health`);
    expect(res.ok()).toBe(true);
  });

  test("lists discovery projects", async ({ request }) => {
    const res = await request.get(`${DISCO_API}/api/projects`);
    expect(res.ok()).toBe(true);
    const projects = await res.json();
    expect(Array.isArray(projects)).toBe(true);
    expect(projects.length).toBeGreaterThan(0);
  });

  test("runs writable (non-readonly endpoints are attached)", async ({ request }) => {
    // /api/config/health only exists when l2b ui runs without --readonly,
    // which is what enables project creation and reading sources from disk
    const res = await request.get(`${DISCO_API}/api/config/health`);
    expect(res.ok()).toBe(true);
  });

  test("does not host its own UI (API only)", async ({ request }) => {
    const res = await request.get(`${DISCO_API}/ui`);
    expect(res.ok()).toBe(false);
  });
});

test.describe("disco-web (cloned DiscoUI + trace panel)", () => {
  test("serves the project list through nginx", async ({ page, request }) => {
    await page.goto(`${DISCO_WEB}/ui`);
    // the home page renders once /api/projects arrives through the proxy
    const projects = await (await request.get(`${DISCO_API}/api/projects`)).json();
    const first = projects[0]?.name;
    expect(first).toBeTruthy();
    await expect(page.getByText(first, { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("the panel switcher has no separate trace tab (nodes absorbs it, ADR-008)", async ({
    page,
    request,
  }) => {
    const projects = await (await request.get(`${DISCO_API}/api/projects`)).json();
    const project = projects[0]?.name;
    expect(project).toBeTruthy();

    await page.goto(`${DISCO_WEB}/ui/p/${project}`);
    const switcher = page.getByRole("combobox", { name: "Panel" }).nth(1);
    await switcher.click({ timeout: 20_000 });
    await expect(page.getByRole("option", { name: "nodes" })).toBeVisible();
    await expect(page.getByRole("option", { name: "trace" })).toHaveCount(0);
  });

  test("renders a live trace graph from the manual /ui/trace form", async ({ page }) => {
    const txHash = await anyRecentTxHash();
    test.skip(txHash === null, "external RPC node not reachable");

    await page.goto(`${DISCO_WEB}/ui/trace`);
    await page.getByPlaceholder("Transaction hash (0x…)").fill(txHash as string);
    await page.getByRole("button", { name: "Trace" }).click();

    // the root call renders as a node (name starts with the call type)
    await expect(page.getByText(/^CALL 0x/).first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("trace deep links + MEV enrichment (M4)", () => {
  test("standalone /ui/trace/:txHash page pre-loads the transaction", async ({ page }) => {
    const txHash = anySwapTxHash();
    test.skip(txHash === null, "no decoded swaps in the shared postgres");

    await page.goto(`${DISCO_WEB}/ui/trace/${txHash}`);
    await expect(page.getByPlaceholder("Transaction hash (0x…)")).toHaveValue(txHash as string);
    // MEV facts come from explorer-api through the /api/mev proxy; a tx with
    // decoded swaps shows the swap-count chip regardless of RPC availability
    await expect(page.getByText(/decoded swap/)).toBeVisible({ timeout: 30_000 });
  });

  test("a sandwich leg is labeled with jumps to its other legs", async ({ page }) => {
    const txHash = anySandwichFrontrunTxHash();
    test.skip(txHash === null, "no sandwiches in the shared postgres");

    await page.goto(`${DISCO_WEB}/ui/trace/${txHash}`);
    await expect(page.getByText(/sandwich front-run/i).first()).toBeVisible({
      timeout: 30_000,
    });
    // the back-run leg is one click away
    await expect(page.getByRole("button", { name: /back-run: 0x/ }).first()).toBeVisible();
  });
});

test.describe("trace workspace (ADR-008)", () => {
  test("a sandwich deep link docks the workspace around its synthetic project", async ({
    page,
  }) => {
    // first open runs a bounded discovery (~1 min); the default 30s test
    // timeout would cut the waitForURL below short
    test.setTimeout(300_000);
    const txHash = anySandwichFrontrunTxHash();
    test.skip(txHash === null, "no sandwiches in the shared postgres");

    await page.goto(`${DISCO_WEB}/ui/trace/${txHash}`);
    await page.waitForURL(/\/ui\/trace\/0x[0-9a-f]{64}\/trace-[0-9a-f]{8}$/, {
      timeout: 240_000,
    });
    // docked default layout: list | nodes (= the trace graph) | values
    const headers = page.getByRole("combobox", { name: "Panel" });
    await expect(headers.nth(0)).toHaveText(/list/, { timeout: 30_000 });
    await expect(headers.nth(1)).toHaveText(/nodes/);
    await expect(headers.nth(2)).toHaveText(/values/);
    // the nodes panel renders the execution trace, not the dependency graph
    await expect(page.getByText(/^CALL /).first()).toBeVisible({ timeout: 30_000 });

    // the List shows the incident folders (Initial + one folder per leg)
    await expect(page.getByText("Initial").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/^Front-run 0x/).first()).toBeVisible();
    await expect(page.getByText(/^Back-run 0x/).first()).toBeVisible();

    // selecting a List entry drives the shared selection: Values leaves its
    // "select a contract" empty state
    await page.locator("li li").first().click();
    await expect(page.getByText(/Select a contract/i)).toHaveCount(0, { timeout: 15_000 });

    // repeat open serves the synthetic project from disk - the redirect must
    // be near-instant, no second discovery run
    await page.goto(`${DISCO_WEB}/ui/trace/${txHash}`);
    await page.waitForURL(/\/ui\/trace\/0x[0-9a-f]{64}\/trace-[0-9a-f]{8}$/, {
      timeout: 15_000,
    });
  });

  test("synthetic trace-* projects are hidden from the home list", async ({ page, request }) => {
    const projects = await (await request.get(`${DISCO_API}/api/projects`)).json();
    const synthetic = projects.filter((p: { name: string }) => p.name.startsWith("trace-"));
    test.skip(synthetic.length === 0, "no synthetic trace projects on disk yet");

    await page.goto(`${DISCO_WEB}/ui`);
    // regular projects render...
    const regular = projects.find((p: { name: string }) => !p.name.startsWith("trace-"));
    await expect(page.getByText(regular.name, { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
    // ...synthetic ones do not
    await expect(page.getByText(synthetic[0].name, { exact: false })).toHaveCount(0);
  });
});
