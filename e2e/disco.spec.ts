import { expect, test } from "@playwright/test";
import {
  anyArbitrageTxWithTip,
  anyRecentTxHash,
  anySandwichFrontrunTxHash,
  anySwapTxHash,
} from "./helpers.js";

const DISCO_WEB = `http://localhost:${process.env.DISCO_WEB_PORT || 8082}`;
const DISCO_API = `http://localhost:${process.env.DISCO_API_PORT || 2021}`;
const AGENT_API = `http://localhost:${process.env.AGENT_API_PORT || 3100}`;

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

  test("research modes are opt-in and the panel is always named Discovery", async ({
    page,
    request,
  }) => {
    const projects = await (await request.get(`${DISCO_API}/api/projects`)).json();
    const project = projects.find(
      (candidate: { name: string }) => !candidate.name.startsWith("trace-"),
    )?.name;
    expect(project).toBeTruthy();

    const preparations: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/agent/bundles/prepare")) preparations.push(req.url());
    });
    await page.goto(`${DISCO_WEB}/ui/p/${project}`);

    await expect(page.getByRole("button", { name: "MEV Research" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByRole("button", { name: "Vulnerability Research" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    const switcher = page.getByRole("combobox", { name: "Panel" }).nth(2);
    await switcher.click({ timeout: 20_000 });
    await page.getByRole("option", { name: "Discovery" }).click();
    await expect(switcher).toHaveText(/Discovery/);
    await expect(page.getByText(/Select MEV Research or Vulnerability Research/)).toBeVisible();
    await page.waitForTimeout(500);
    expect(preparations).toHaveLength(0);
  });

  test("renders a live trace graph from the manual /ui/trace form", async ({ page }) => {
    const txHash = await anyRecentTxHash();
    test.skip(txHash === null, "external RPC node not reachable");

    await page.goto(`${DISCO_WEB}/ui/trace`);
    await page.getByPlaceholder("Transaction hash (0x…)").fill(txHash as string);
    await page.getByRole("button", { name: "Trace" }).click();

    // nodes are titled by contract (call types live in the color legend)
    await expect(page.getByText(/^0x[0-9a-f]{4}/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("delegatecall")).toBeVisible();
  });
});

test.describe("trace deep links + MEV enrichment (M4)", () => {
  test("standalone /ui/trace/:txHash deep link renders the graph without the manual form", async ({
    page,
  }) => {
    const txHash = anySwapTxHash();
    test.skip(txHash === null, "no decoded swaps in the shared postgres");

    await page.goto(`${DISCO_WEB}/ui/trace/${txHash}`);
    // deep links determine the tx - no input form (wp-trace-polish); the
    // graph and its call-type legend render on the resolve screen and in
    // the workspace alike, so a fast redirect cannot flake this
    await expect(page.getByText("delegatecall")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByPlaceholder("Transaction hash (0x…)")).toHaveCount(0);
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
    // the nodes panel renders the execution trace (call-type color legend)
    // and the TopBar shows the incident identity with the extracted value
    await expect(page.getByText("delegatecall")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/^sandwich ·/)).toBeVisible({ timeout: 30_000 });

    // the List shows the incident folders (Initial + one folder per leg)
    await expect(page.getByText("Initial").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/^Front-run 0x/).first()).toBeVisible();
    await expect(page.getByText(/^Back-run 0x/).first()).toBeVisible();

    // selecting a List entry drives the shared selection: Values leaves its
    // "select a contract" empty state and gains the per-call Trace section
    await page.locator("li li").first().click();
    await expect(page.getByText(/Select a contract/i)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Trace", exact: true })).toBeVisible();

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

// ADR-013: Discovery UX refinements. These drive the same live disco-web stack.
test.describe("ADR-013 Discovery UX refinements", () => {
  async function firstRealProject(request: import("@playwright/test").APIRequestContext) {
    const projects = await (await request.get(`${DISCO_API}/api/projects`)).json();
    return projects.find((c: { name: string }) => !c.name.startsWith("trace-"))?.name as
      | string
      | undefined;
  }

  test("U2: the panel switcher lists Discovery and a separate Preview panel", async ({
    page,
    request,
  }) => {
    const project = await firstRealProject(request);
    expect(project).toBeTruthy();
    await page.goto(`${DISCO_WEB}/ui/p/${project}`);
    const switcher = page.getByRole("combobox", { name: "Panel" }).nth(2);
    await switcher.click({ timeout: 20_000 });
    // preview id → "Discovery" (agentic surfaces); new contracts id → "Preview"
    await expect(page.getByRole("option", { name: "Discovery" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Preview", exact: true })).toBeVisible();
  });

  test("U3/U5: research kinds are hideable tabs and the bundle set is not inner-scrolled", async ({
    page,
    request,
  }) => {
    const project = await firstRealProject(request);
    expect(project).toBeTruthy();
    await page.goto(`${DISCO_WEB}/ui/p/${project}`);

    // dock a Discovery panel
    const switcher = page.getByRole("combobox", { name: "Panel" }).nth(2);
    await switcher.click({ timeout: 20_000 });
    await page.getByRole("option", { name: "Discovery" }).click();
    await expect(switcher).toHaveText(/Discovery/);

    // turn on MEV Research → a "MEV Discovery" tab and its pane (context meter) appear
    await page.getByRole("button", { name: "MEV Research" }).click();
    const tab = page.getByRole("button", { name: "MEV Discovery" });
    await expect(tab).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Context:.*tokens/)).toBeVisible({ timeout: 15_000 });

    // clicking the active tab collapses it (pane content hidden), tab remains
    await tab.click();
    await expect(page.getByText(/Context:.*tokens/)).toHaveCount(0);
    await expect(tab).toBeVisible();

    // clicking again re-opens it
    await tab.click();
    await expect(page.getByText(/Context:.*tokens/)).toBeVisible();
  });

  test("U1: the trace-workspace top bar shows kind + hash with no extracted-value figure", async ({
    page,
  }) => {
    // first open runs a bounded discovery; give it room
    test.setTimeout(300_000);
    const txHash = anyArbitrageTxWithTip();
    test.skip(txHash === null, "no arbitrage with a builder tip in the shared postgres");

    await page.goto(`${DISCO_WEB}/ui/trace/${txHash}`);
    await page.waitForURL(/\/ui\/trace\/0x[0-9a-f]{64}\/trace-[0-9a-f]{8}$/, {
      timeout: 240_000,
    });
    // identity reads "<kind> · 0x1234abcd…" — a kind, a separator, a short hash…
    const identity = page.getByText(/^\w+ · 0x[0-9a-f]{8}…$/);
    await expect(identity).toBeVisible({ timeout: 30_000 });
    // …and NOT the old value figure (no Ξ / ETH amount in the bar identity)
    await expect(identity).not.toContainText("Ξ");
    await expect(identity).not.toContainText("ETH");
  });

  test("U4: the Discovery follow-up submits on Enter and newlines on Shift+Enter", async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const txHash = anyArbitrageTxWithTip();
    test.skip(txHash === null, "no arbitrage with a builder tip in the shared postgres");
    const project = `trace-${(txHash as string).slice(2, 10)}`;
    // the follow-up textarea only renders once a verdict session exists
    const sessionRes = await request.get(
      `${AGENT_API}/api/agent/discovery/session?project=${project}&incident=${txHash}&kind=mev`,
    );
    const session = sessionRes.ok() ? (await sessionRes.json()).session : null;
    test.skip(
      !session || session.turns.length === 0,
      "no persisted mev Discovery verdict for this incident yet",
    );

    await page.goto(`${DISCO_WEB}/ui/trace/${txHash}`);
    await page.waitForURL(/\/ui\/trace\/0x[0-9a-f]{64}\/trace-[0-9a-f]{8}$/, {
      timeout: 240_000,
    });
    const switcher = page.getByRole("combobox", { name: "Panel" }).nth(2);
    await switcher.click({ timeout: 20_000 });
    await page.getByRole("option", { name: "Discovery" }).click();
    await page.getByRole("button", { name: "MEV Research" }).click();

    const box = page.getByPlaceholder(/Enter to send/);
    await expect(box).toBeVisible({ timeout: 30_000 });
    await box.click();
    await box.pressSequentially("alpha");
    await box.press("Shift+Enter"); // newline, must NOT submit
    await box.pressSequentially("beta");
    await expect(box).toHaveValue("alpha\nbeta");
    await box.press("Enter"); // submits → input clears
    await expect(box).toHaveValue("");
  });

  test("ADR-014: Discover hides bundle selection, Reassess restores it, and usage advances", async ({
    page,
    request,
  }) => {
    const projects = await (await request.get(`${DISCO_WEB}/api/projects`)).json();
    const project = projects.find(
      (candidate: { name: string }) => !candidate.name.startsWith("trace-"),
    )?.name as string | undefined;
    expect(project).toBeTruthy();

    const codehash = `0x${"1".repeat(64)}`;
    const bundle = {
      codehash,
      kind: "mev",
      addresses: ["0x0000000000000000000000000000000000000001"],
      role: "Mock Router",
      entryPoints: ["swap"],
      flowSummary: "Routes the incident swap.",
      notes: "Ordering-sensitive test evidence.",
      tokenEstimate: 120,
      provenanceRunId: 1,
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
    };
    let session: Record<string, unknown> | null = null;
    let discoveryCalls = 0;
    let releaseFollowup!: () => void;
    const followupResponse = new Promise<void>((resolve) => {
      releaseFollowup = resolve;
    });

    await page.route("**/api/agent/bundles/prepare", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: [
          JSON.stringify({ type: "progress", phase: "resolved", completed: 0, total: 1 }),
          JSON.stringify({ type: "bundle", bundle }),
          JSON.stringify({ type: "progress", phase: "completed", completed: 1, total: 1 }),
          JSON.stringify({ type: "prepared" }),
          "",
        ].join("\n"),
      });
    });
    await page.route("**/api/agent/discovery/session?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session }),
      });
    });
    await page.route("**/api/agent/discovery", async (route) => {
      discoveryCalls++;
      if (discoveryCalls === 3) await followupResponse;
      const tokens = discoveryCalls === 1 ? 1_200 : discoveryCalls === 2 ? 1_700 : 2_400;
      const priorTurns = (session?.turns as { role: string; text: string }[] | undefined) ?? [];
      const body = route.request().postDataJSON() as { question?: string };
      session = {
        project,
        incident: project,
        kind: "mev",
        bundleFingerprint: "test-fingerprint",
        contextTokens: tokens,
        contextWindow: 8_000,
        turns: [
          ...priorTurns,
          { role: "user", text: body.question ?? (discoveryCalls === 1 ? "Discover" : "Reassess") },
          { role: "assistant", text: `Answer ${discoveryCalls}` },
        ],
        updatedAt: "2026-07-22T00:00:00.000Z",
      };
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: [
          JSON.stringify({ type: "reasoning", text: `Reasoning ${discoveryCalls}` }),
          JSON.stringify({ type: "delta", text: `Answer ${discoveryCalls}` }),
          JSON.stringify({ type: "done", report: `Answer ${discoveryCalls}`, transcript: "" }),
          JSON.stringify({
            type: "usage",
            tokens,
            contextWindow: 8_000,
            percent: (tokens / 8_000) * 100,
          }),
          JSON.stringify({ type: "session", session }),
          "",
        ].join("\n"),
      });
    });

    await page.goto(`${DISCO_WEB}/ui/p/${project}`);
    const switcher = page.getByRole("combobox", { name: "Panel" }).nth(2);
    await switcher.click({ timeout: 20_000 });
    await page.getByRole("option", { name: "Discovery" }).click();
    await page.getByRole("button", { name: "MEV Research" }).click();

    await expect(page.getByText("Mock Router")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Discover", exact: true }).last().click();
    await expect(page.getByRole("button", { name: "Reassess", exact: true })).toBeVisible();
    await expect(page.getByText("Mock Router")).toHaveCount(0);
    await expect(page.getByText(/Context: 1,200 used \/ 6,800 free tokens/)).toBeVisible();

    await page.getByRole("button", { name: "Reassess", exact: true }).click();
    await expect(page.getByText("Mock Router")).toBeVisible();
    await expect(page.getByRole("button", { name: "Discover", exact: true }).last()).toBeVisible();
    expect(discoveryCalls).toBe(1);

    await page.getByRole("button", { name: "Discover", exact: true }).last().click();
    await expect(page.getByText(/Context: 1,700 used \/ 6,300 free tokens/)).toBeVisible();

    const conversation = page.getByTestId("discovery-conversation");
    await expect(conversation).toHaveCSS("flex-grow", "1");
    const followup = page.getByPlaceholder(/Enter to send/);
    await followup.fill("What changed?");
    await followup.press("Enter");
    await expect(followup).toHaveValue("");
    await expect(page.getByRole("status")).toContainText("Follow-up registered");
    await expect(conversation).toContainText("What changed?");
    releaseFollowup();
    await expect(page.getByText(/Context: 2,400 used \/ 5,600 free tokens/)).toBeVisible();
    expect(discoveryCalls).toBe(3);
  });

  test("ADR-014: preparation survives SPA workspace navigation", async ({ page, request }) => {
    const projects = await (await request.get(`${DISCO_WEB}/api/projects`)).json();
    const regular = projects
      .filter((candidate: { name: string }) => !candidate.name.startsWith("trace-"))
      .slice(0, 2) as { name: string }[];
    expect(regular).toHaveLength(2);
    const [first, second] = regular.map((project) => project.name);

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let markFirstFinished!: () => void;
    const firstFinished = new Promise<void>((resolve) => {
      markFirstFinished = resolve;
    });
    const calls = new Map<string, number>();

    await page.route("**/api/agent/discovery/session?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"session":null}',
      });
    });
    await page.route("**/api/agent/bundles/prepare", async (route) => {
      const body = route.request().postDataJSON() as { project: string };
      calls.set(body.project, (calls.get(body.project) ?? 0) + 1);
      if (body.project === first) {
        markFirstStarted();
        await firstGate;
      }
      const bundle = {
        codehash: `0x${(body.project === first ? "2" : "3").repeat(64)}`,
        kind: "mev",
        addresses: ["0x0000000000000000000000000000000000000001"],
        role: `${body.project} Bundle`,
        entryPoints: [],
        flowSummary: "Navigation-stable preparation evidence.",
        notes: "Test bundle.",
        tokenEstimate: 80,
        provenanceRunId: null,
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
      };
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: `${JSON.stringify({ type: "bundle", bundle })}\n${JSON.stringify({ type: "prepared" })}\n`,
      });
      if (body.project === first) markFirstFinished();
    });

    await page.goto(`${DISCO_WEB}/ui/p/${first}`);
    const switcher = page.getByRole("combobox", { name: "Panel" }).nth(2);
    await switcher.click({ timeout: 20_000 });
    await page.getByRole("option", { name: "Discovery" }).click();
    await page.getByRole("button", { name: "MEV Research" }).click();
    await firstStarted;

    await page.locator('a[href="/ui"]').first().click();
    await page.getByRole("link", { name: second, exact: true }).first().click();
    await page.waitForURL(`${DISCO_WEB}/ui/p/${second}`);
    releaseFirst();
    await firstFinished;

    await page.locator('a[href="/ui"]').first().click();
    await page.getByRole("link", { name: first, exact: true }).first().click();
    await page.waitForURL(`${DISCO_WEB}/ui/p/${first}`);
    await expect(page.getByText(`${first} Bundle`)).toBeVisible({ timeout: 15_000 });
    expect(calls.get(first)).toBe(1);
  });

  test("ADR-014: settings expose Analyze and Discover effort controls", async ({
    page,
    request,
  }) => {
    const projects = await (await request.get(`${DISCO_WEB}/api/projects`)).json();
    const project = projects.find(
      (candidate: { name: string }) => !candidate.name.startsWith("trace-"),
    )?.name as string | undefined;
    expect(project).toBeTruthy();
    await page.goto(`${DISCO_WEB}/ui/p/${project}`);

    await page.getByRole("button", { name: "Global app settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Global app settings" });
    await expect(dialog.getByText("Analyze", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Discover", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Analyze effort", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Discover effort", { exact: true })).toBeVisible();

    const selects = dialog.getByRole("combobox");
    await selects.nth(1).click();
    await page.getByRole("option", { name: "High", exact: true }).click();
    await expect(selects.nth(1)).toHaveText("High");
    await selects.nth(3).click();
    await page.getByRole("option", { name: "Extra high", exact: true }).click();
    await expect(selects.nth(3)).toHaveText("Extra high");
  });

  test("ADR-014: Analyze successfully executes a read-only cast query", async ({ page }) => {
    test.setTimeout(300_000);
    const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    await page.goto(`${DISCO_WEB}/ui`);
    const events = await page.evaluate(
      async ({ weth }) => {
        const response = await fetch("/api/agent/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project: "verification-adr014-analyze-cast",
            skill: "analyze-code",
            addresses: [weth],
            question: `Use the read-only cast tool to run balance for ${weth}. Do not answer without calling cast; report the returned balance.`,
            codeContext: `Flattened source code of WETH9 (eth:${weth}) on chain eth:\n\`\`\`\ncontract WETH9 {}\n\`\`\``,
            effort: "off",
          }),
        });
        if (!response.ok || !response.body) throw new Error(`Analyze failed: ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const events: { type: string; detail?: string; report?: string; message?: string }[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) if (line.trim()) events.push(JSON.parse(line));
        }
        if (buffer.trim()) events.push(JSON.parse(buffer));
        return events;
      },
      { weth },
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool",
        detail: "cast balance",
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "tool",
        detail: "cast balance failed",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "done",
        report: expect.any(String),
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "error",
      }),
    );
  });
});
