import { expect, test } from "@playwright/test";
import { anyRecentTxHash } from "./helpers.js";

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

  test("offers the trace panel in the panel switcher", async ({ page, request }) => {
    const projects = await (await request.get(`${DISCO_API}/api/projects`)).json();
    const project = projects[0]?.name;
    expect(project).toBeTruthy();

    await page.goto(`${DISCO_WEB}/ui/p/${project}`);
    // default layout: list | values | nodes - switch the values panel to trace
    const switcher = page.getByRole("combobox", { name: "Panel" }).nth(1);
    await switcher.click({ timeout: 20_000 });
    await page.getByRole("option", { name: "trace" }).click();

    await expect(page.getByPlaceholder("Transaction hash (0x…)")).toBeVisible();
  });

  test("renders a live trace graph in the trace panel", async ({ page, request }) => {
    const txHash = await anyRecentTxHash();
    test.skip(txHash === null, "external RPC node not reachable");

    const projects = await (await request.get(`${DISCO_API}/api/projects`)).json();
    const project = projects[0]?.name;

    await page.goto(`${DISCO_WEB}/ui/p/${project}`);
    const switcher = page.getByRole("combobox", { name: "Panel" }).nth(1);
    await switcher.click({ timeout: 20_000 });
    await page.getByRole("option", { name: "trace" }).click();

    await page.getByPlaceholder("Transaction hash (0x…)").fill(txHash as string);
    await page.getByRole("button", { name: "Trace" }).click();

    // the root call renders as a node (name starts with the call type)
    await expect(page.getByText(/^CALL 0x/).first()).toBeVisible({ timeout: 20_000 });
  });
});
