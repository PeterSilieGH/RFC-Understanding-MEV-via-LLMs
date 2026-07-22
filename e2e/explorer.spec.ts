import { expect, test } from "@playwright/test";
import {
  EXPLORER_API,
  EXPLORER_WEB,
  anyArbitrageBlock,
  anyArbitrageurAddress,
  anyMultiTokenArbitrageBlock,
  anySandwichBlock,
  anySwapTxHash,
  latestInspectedBlock,
  multiTokenArbitrageBlocks,
} from "./helpers.js";

test.describe("explorer-api", () => {
  test("mempool status responds", async ({ request }) => {
    const res = await request.get(`${EXPLORER_API}/api/mempool-status`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty("trackedHashes");
    expect(body).toHaveProperty("healthy");
  });

  test("mempool stats respond", async ({ request }) => {
    const res = await request.get(`${EXPLORER_API}/api/mempool-stats`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(body.summary).toHaveProperty("publicCount");
    expect(body.summary).toHaveProperty("privateCount");
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

  test("rejects an invalid tx hash on the per-tx MEV endpoint", async ({ request }) => {
    const res = await request.get(`${EXPLORER_API}/api/mev/tx/0x1234`);
    expect(res.status()).toBe(400);
  });

  test("serves per-tx MEV facts with trace addresses (M4)", async ({ request }) => {
    const txHash = anySwapTxHash();
    test.skip(txHash === null, "no decoded swaps in the shared postgres");

    const res = await request.get(`${EXPLORER_API}/api/mev/tx/${txHash}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.inspected).toBe(true);
    expect(body.transaction.hash).toBe(txHash);
    expect(Array.isArray(body.transaction.mev)).toBe(true);
    expect(body.transaction.swaps.length).toBeGreaterThan(0);
    expect(Array.isArray(body.transaction.swaps[0].traceAddress)).toBe(true);
  });

  // wp-explorer-redesign E6: backfill queue + coverage/activity endpoints

  test("backfill status has the queue shape", async ({ request }) => {
    const res = await request.get(`${EXPLORER_API}/api/backfill`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.running).toBe("boolean");
    for (const key of ["fromBlock", "targetBlock", "cursor", "inspected", "skipped", "failed"]) {
      expect(body).toHaveProperty(key);
    }
    expect(Array.isArray(body.errors)).toBe(true);
  });

  test("backfill rejects an invalid fromBlock", async ({ request }) => {
    const res = await request.post(`${EXPLORER_API}/api/backfill`, {
      data: { fromBlock: "not-a-number" },
    });
    expect(res.status()).toBe(400);
  });

  test("backfill round-trip over an already-inspected block", async ({ request }) => {
    const block = latestInspectedBlock();
    test.skip(block === null, "no inspected blocks in the shared postgres");
    const running = await (await request.get(`${EXPLORER_API}/api/backfill`)).json();
    test.skip(running.running, "a backfill is already running - not clobbering it");

    // a single already-inspected block: completes near-instantly via skip
    const res = await request.post(`${EXPLORER_API}/api/backfill`, {
      data: { fromBlock: block, toBlock: block },
    });
    expect(res.ok()).toBe(true);
    await expect
      .poll(
        async () => (await (await request.get(`${EXPLORER_API}/api/backfill`)).json()).running,
        {
          timeout: 15_000,
        },
      )
      .toBe(false);
    const done = await (await request.get(`${EXPLORER_API}/api/backfill`)).json();
    expect(done.fromBlock).toBe(block);
    expect(done.skipped + done.inspected).toBe(1);
    expect(done.failed).toBe(0);
  });

  test("analyzed-ranges compresses coverage and covers inspected blocks", async ({ request }) => {
    const block = latestInspectedBlock();
    test.skip(block === null, "no inspected blocks in the shared postgres");

    const res = await request.get(
      `${EXPLORER_API}/api/analyzed-ranges?from=${block - 50}&to=${block}`,
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.ranges)).toBe(true);
    expect(body.ranges.length).toBeGreaterThan(0);
    for (const r of body.ranges) {
      expect(Number.isInteger(r.start)).toBe(true);
      expect(r.end).toBeGreaterThanOrEqual(r.start);
    }
    expect(
      body.ranges.some((r: { start: number; end: number }) => r.start <= block && block <= r.end),
    ).toBe(true);

    const bad = await request.get(`${EXPLORER_API}/api/analyzed-ranges?from=5&to=1`);
    expect(bad.status()).toBe(400);
  });

  test("mev-activity aggregates per-block counts", async ({ request }) => {
    const block = latestInspectedBlock();
    test.skip(block === null, "no inspected blocks in the shared postgres");

    const res = await request.get(
      `${EXPLORER_API}/api/mev-activity?from=${block - 5000}&to=${block}`,
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.blocks)).toBe(true);
    for (const b of body.blocks.slice(0, 5)) {
      expect(b.total).toBe(b.arbitrages + b.sandwiches + b.liquidations);
    }
  });

  // wp-explorer-v2 X9/X10 (ADR-011): value-over-time series + fill worker status

  test("mev-value returns bucketed per-type extracted value (X9)", async ({ request }) => {
    const block = latestInspectedBlock();
    test.skip(block === null, "no inspected blocks in the shared postgres");

    const res = await request.get(
      `${EXPLORER_API}/api/mev-value?from=${block - 10000}&to=${block}`,
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Number.isInteger(body.bucketSize)).toBe(true);
    expect(body.bucketSize).toBeGreaterThan(0);
    expect(Array.isArray(body.buckets)).toBe(true);
    for (const b of body.buckets.slice(0, 5)) {
      for (const key of [
        "bucket",
        "inspectedBlocks",
        "arbitrageEth",
        "sandwichEth",
        "liquidationEth",
        "arbitrageCount",
        "sandwichCount",
        "liquidationCount",
      ]) {
        expect(b).toHaveProperty(key);
      }
      // arbitrageEth is a finite ETH figure but NOT necessarily non-negative: a
      // cyclic arbitrage the detector records can be a losing round-trip (its own
      // profit_amount = end − start goes negative, e.g. a sandwiched/failed arb),
      // so a bucket dominated by such arbs nets negative extracted value. This
      // held for the old WETH-profit sum too and is preserved by the ADR-014
      // multi-token aggregate (which equals the detector's sign on WETH-only arbs).
      expect(Number.isFinite(b.arbitrageEth)).toBe(true);
      // every returned bucket contains at least one inspected block (gaps are
      // omitted, not valued at 0)
      expect(b.inspectedBlocks).toBeGreaterThan(0);
    }
  });

  test("mev-value rejects an inverted range and a non-positive bucket", async ({ request }) => {
    expect((await request.get(`${EXPLORER_API}/api/mev-value?from=10&to=1`)).status()).toBe(400);
    expect(
      (await request.get(`${EXPLORER_API}/api/mev-value?from=1&to=10&bucket=0`)).status(),
    ).toBe(400);
  });

  // ADR-014: an arbitrage is valued by the ETH-priced net delta across EVERY
  // token its route moved, not just the single stored profit token.
  test("block view aggregates a multi-token arbitrage's value with pricing provenance (ADR-014)", async ({
    request,
  }) => {
    const candidates = multiTokenArbitrageBlocks();
    test.skip(candidates.length === 0, "no multi-token arbitrages in the shared postgres");

    interface Arb {
      ethValue: number | null;
      pricedBreakdown: { ethValue: number; method: string; symbol: string }[];
      unpricedTokens: string[];
      type: string;
    }

    // Walk recent multi-token-delta blocks until one still carries a >1-priced-
    // token arbitrage after valuation (some second legs are legitimately value-
    // dust-dropped), asserting the ADR-014 invariants on every arb seen.
    let provedMultiToken = false;
    for (const block of candidates) {
      const res = await request.get(`${EXPLORER_API}/api/block/${block}`);
      expect(res.ok()).toBe(true);
      const { transactions } = (await res.json()) as { transactions: { mev: Arb[] }[] };
      const arbs = transactions.flatMap((tx) => tx.mev).filter((m) => m.type === "arbitrage");

      for (const m of arbs) {
        expect(Array.isArray(m.pricedBreakdown)).toBe(true);
        expect(Array.isArray(m.unpricedTokens)).toBe(true);
        for (const item of m.pricedBreakdown) {
          // pricing method is one of the three documented provenances
          expect(["onchain", "feed", "unpriced"]).toContain(item.method);
        }
        if (m.ethValue !== null) {
          // the aggregate equals the sum of the priced (non-unpriced) legs
          const summed = m.pricedBreakdown
            .filter((b) => b.method !== "unpriced")
            .reduce((acc, b) => acc + b.ethValue, 0);
          expect(m.ethValue).toBeCloseTo(summed, 9);
        }
      }

      if (arbs.some((m) => m.pricedBreakdown.filter((b) => b.method !== "unpriced").length >= 2)) {
        provedMultiToken = true;
        break;
      }
    }

    // the whole point of ADR-014: at least one real arb aggregates >1 priced
    // token, which the single-token detector's profit figure would miss
    expect(provedMultiToken, "expected a >1-priced-token arbitrage in a recent block").toBe(true);
  });

  test("fill worker exposes its coverage status (X10)", async ({ request }) => {
    const res = await request.get(`${EXPLORER_API}/api/fill`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.running).toBe("boolean");
    expect(typeof body.caughtUp).toBe("boolean");
    expect(Number.isInteger(body.floor)).toBe(true);
    for (const key of ["cursor", "head", "inspected", "failed", "lastError", "startedAt"]) {
      expect(body).toHaveProperty(key);
    }
  });
});

test.describe("explorer-web", () => {
  test("serves the explorer UI through nginx", async ({ page }) => {
    await page.goto(EXPLORER_WEB);
    await expect(page).toHaveTitle("MEV Block Explorer");
    // X5/X8: the h1/#currentBlock caption is gone; the header now carries the
    // Block/Address search group. The prev/next block buttons were removed.
    await expect(page.locator("#searchInput")).toBeVisible();
    await expect(page.locator("#modeToggle")).toBeVisible();
    await expect(page.locator("#prevBtn")).toHaveCount(0);
    await expect(page.locator("#nextBtn")).toHaveCount(0);
    await expect(page.locator("#liveToggleBtn")).toBeVisible();
  });

  test("loads an inspected block end-to-end through the /api proxy", async ({ page }) => {
    const block = latestInspectedBlock();
    test.skip(block === null, "no inspected blocks in the shared postgres");

    // the number input is gone - ?block=N deep links are the precise
    // navigation path (they also switch follow-latest off)
    const blockResponse = page.waitForResponse(
      (res) => res.url().includes(`/api/block/${block}`) && res.ok(),
    );
    await page.goto(`${EXPLORER_WEB}/?block=${block}`);
    await blockResponse;

    await expect(page.locator("#liveToggleBtn")).not.toHaveClass(/active/);
    // X5/X8: the loaded block is reflected in the header search box (block mode)
    await expect(page.locator("#searchInput")).toHaveValue(String(block));
    await expect(page.locator("body")).toContainText(String(block));

    // every transaction row deep-links into the DiscoUI trace view (M4)
    const traceLink = page.locator("a.trace-link").first();
    await expect(traceLink).toBeVisible();
    await expect(traceLink).toHaveAttribute("href", /:8082\/ui\/trace\/0x[0-9a-f]{64}$/);
  });

  // wp-explorer-redesign E1-E5 + E7

  test("header has three zones with the search group + icon toggles (E1/E2/X7/X8)", async ({
    page,
  }) => {
    await page.goto(EXPLORER_WEB);
    const subtitle = page.locator(".header-top .subtitle");
    // X8: the centered h1 caption is replaced by the Block/Address search group
    const searchGroup = page.locator(".header-top .search-group");
    const liveToggle = page.locator(".header-top-right #liveToggleBtn");
    const mevToggle = page.locator(".header-top-right #onlyMevToggle");
    await expect(subtitle).toContainText("DSN MEV Detection Bot");
    await expect(page.locator("#modeToggle")).toHaveText("Block"); // block mode default
    await expect(liveToggle).toHaveAttribute("title", /follow latest block/i);
    await expect(liveToggle).toHaveClass(/active/); // follows by default
    await expect(mevToggle).toHaveAttribute("title", /only transactions with detected MEV/i);
    // X7: the MEV filter is a filter-funnel icon (svg), not a text glyph
    await expect(mevToggle.locator("svg")).toBeVisible();

    // subtitle left of the search group, search group left of the toggle group;
    // follow-latest left of MEV-only left of EUR
    const [s, g, l, m, e] = await Promise.all(
      [subtitle, searchGroup, liveToggle, mevToggle, page.locator("#eurToggle")].map((loc) =>
        loc.boundingBox().then((b) => b?.x ?? -1),
      ),
    );
    expect(s).toBeLessThan(g);
    expect(g).toBeLessThan(l);
    expect(l).toBeLessThan(m);
    expect(m).toBeLessThan(e);
  });

  test("header Block/Address toggle drives block + address search (X8)", async ({ page }) => {
    const block = latestInspectedBlock();
    test.skip(block === null, "no inspected blocks in the shared postgres");

    await page.goto(EXPLORER_WEB);
    // block mode: type a number, hit go, the block loads (follow-latest turns off)
    const blockResponse = page.waitForResponse(
      (res) => res.url().includes(`/api/block/${block}`) && res.ok(),
    );
    await page.locator("#searchInput").fill(String(block));
    await page.locator("#searchGoBtn").click();
    await blockResponse;
    await expect(page.locator("#liveToggleBtn")).not.toHaveClass(/active/);

    // flip to address mode: placeholder + label change, and a search renders the
    // address's transactions in the same #result table (with a Block column),
    // not a separate bottom-bar panel (which was removed)
    await page.locator("#modeToggle").click();
    await expect(page.locator("#modeToggle")).toHaveText("Address");
    await expect(page.locator("#searchInput")).toHaveAttribute("placeholder", /0x/);
    await expect(page.locator("#panel-address")).toHaveCount(0);

    // an address known to have MEV activity in the inspected corpus
    const actor = anyArbitrageurAddress();
    test.skip(actor === null, "no arbitrageur addresses in the shared postgres");
    const addrResponse = page.waitForResponse(
      (res) => res.url().includes(`/api/address/${actor}`) && res.ok(),
    );
    await page.locator("#searchInput").fill(actor!);
    await page.locator("#searchGoBtn").click();
    await addrResponse;

    // the result table gains a Block column and rows link to their block
    await expect(page.locator("#result table thead")).toContainText("Block");
    await expect(page.locator("#result a.block-link").first()).toBeVisible();
    await expect(page.locator("#result tbody tr[data-tx]").first()).toBeVisible();
  });

  test("stats bar, income tab, MEV-only filter, toast under header (E2-E5)", async ({ page }) => {
    const block = latestInspectedBlock();
    test.skip(block === null, "no inspected blocks in the shared postgres");

    const blockResponse = page.waitForResponse(
      (res) => res.url().includes(`/api/block/${block}`) && res.ok(),
    );
    await page.goto(`${EXPLORER_WEB}/?block=${block}`);
    await blockResponse;

    // X4: ETH figures are labelled "Ξ" (Xi) in the table header (EUR toggle off)
    await expect(page.locator("#result thead")).toContainText("Builder Tip (Ξ)");

    // E4 (amended): transactions first, then private, three blue MEV cards,
    // no fee/tip/bid cards
    const cardLabels = page.locator("#stats .stat-card .stat-label");
    await expect(cardLabels.first()).toHaveText("Transactions");
    await expect(cardLabels.nth(1)).toHaveText(/private tx/i);
    await expect(page.locator("#stats .stat-card.accent-blue")).toHaveCount(3);
    await expect(page.locator("#stats")).not.toContainText(/fees|tips|bid/i);

    // E5 (amended): the income chart is a bottom-bar tab ("Transaction Prices")
    // next to the visibility tab, with the builder identity in its legend and
    // the price-per-gas cards moved in beside the chart
    await page.locator(".explore-tab[data-tab=income]").click();
    await expect(page.locator("#panel-income")).toBeVisible();
    expect(await page.locator("#incomeChart rect").count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator("#incomeLegend .legend-builder")).toContainText("Builder:");
    // price-per-gas relocated here from Transaction Visibility
    await expect(page.locator("#pricePerGas")).toContainText(/price per gas — public/i);
    await expect(page.locator("#pricePerGas")).toContainText(/price per gas — private/i);
    // Transaction Visibility no longer shows the price-per-gas summary cards
    // (its intro paragraph still explains the concept — scope to the cards)
    await page.locator(".explore-tab[data-tab=mempool]").click();
    await expect(page.locator("#mempoolStatsResults")).not.toContainText(/price per gas/i);

    // E2: the icon toggle filters the table to MEV-only rows
    const rows = page.locator("#result tbody tr:not(.detail-row)");
    const before = await rows.count();
    await page.locator("#onlyMevToggle").click();
    await expect(page.locator("#onlyMevToggle")).toHaveClass(/active/);
    expect(await rows.count()).toBeLessThanOrEqual(before);
    await page.locator("#onlyMevToggle").click();

    // E3: toasts anchor under the header, not the viewport corner
    await page.locator("#liveToggleBtn").click(); // "Following the latest block."
    const toast = page.locator("#toast.show");
    await expect(toast).toBeVisible({ timeout: 15_000 });
    const [toastBox, headerBox] = await Promise.all([
      toast.boundingBox(),
      page.locator("header").boundingBox(),
    ]);
    expect(toastBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
  });

  test("bottom bar: 1-block tabs left, multi-block + wiki right", async ({ page }) => {
    const block = latestInspectedBlock();
    test.skip(block === null, "no inspected blocks in the shared postgres");

    const blockResponse = page.waitForResponse(
      (res) => res.url().includes(`/api/block/${block}`) && res.ok(),
    );
    await page.goto(`${EXPLORER_WEB}/?block=${block}`);
    await blockResponse;

    // Transaction Visibility is the leftmost tab and the default panel, scoped
    // to the loaded block
    const tabs = page.locator(".explore-tab");
    await expect(tabs.first()).toHaveText("Transaction Visibility");
    await expect(tabs.first()).toHaveAttribute("data-tab", "mempool");
    await expect(tabs.first()).toHaveClass(/active/);
    await expect(page.locator("#panel-mempool")).toBeVisible();
    await expect(page.locator("#mempoolStatsResults")).toContainText(`#${block}`);
    // the per-tx order-flow strip has one cell per transaction
    const txCount = await page.locator("#result tbody tr:not(.detail-row)").count();
    await expect(page.locator("#mempoolStatsResults .mp-cell")).toHaveCount(txCount);

    // Transaction Prices sits directly right of it; the spacer pushes the
    // multi-block tabs (leaderboard first, the address panel having been removed)
    // to the right edge
    await expect(tabs.nth(1)).toHaveText("Transaction Prices");
    await expect(page.locator(".explore-tab[data-tab=address]")).toHaveCount(0);
    const [mempoolBox, leaderboardBox, spacer] = await Promise.all([
      tabs.first().boundingBox(),
      page.locator(".explore-tab[data-tab=leaderboard]").boundingBox(),
      page.locator(".explore-tabs-spacer").boundingBox(),
    ]);
    expect(spacer!.width).toBeGreaterThan(50);
    expect(leaderboardBox!.x).toBeGreaterThan(mempoolBox!.x + mempoolBox!.width + spacer!.width);

    // the Wiki tab (rightmost) shows the MEV-type legend
    await page.locator(".explore-tab[data-tab=wiki]").click();
    await expect(page.locator("#panel-wiki")).toBeVisible();
    await expect(page.locator("#legend")).toContainText("MEV types");
    await expect(page.locator("#legend")).toContainText("Mempool visibility");
  });

  test("timeline is a value line-graph from the floor with the interval slider (X9)", async ({
    page,
  }) => {
    await page.goto(EXPLORER_WEB);
    const timeline = page.locator("#timeline");
    // the timeline unhides once the RPC head is known
    await expect(timeline).toBeVisible({ timeout: 30_000 });

    // X9: the analysis handle + coverage track are gone; a value graph and the
    // 100-block interval slider remain
    await expect(page.locator("#timelineHandle")).toHaveCount(0);
    await expect(page.locator("#timelineGraph")).toBeVisible();
    await expect(page.locator("#timelineInterval")).toBeVisible();

    // the window starts at the inspection floor (block 11,000,000) and ends at head
    await expect(page.locator("#timelineStart")).toHaveText("#11000000");
    await expect(page.locator("#timelineEnd")).toHaveText(/head/);

    // three color-coded series in the legend (arbitrage / sandwich / liquidation)
    // plus the value-extracted unit caption
    const legend = page.locator("#timelineLegend");
    await expect(legend).toContainText("Arbitrage");
    await expect(legend).toContainText("Sandwich");
    await expect(legend).toContainText("Liquidation");
    await expect(legend.locator(".tl-legend-item")).toHaveCount(3);
    await expect(legend.locator(".tl-legend-unit")).toContainText(/value extracted/i);

    // amend: the peak moved from the legend to the y-axis; unit and value agree
    await expect(legend).not.toContainText(/peak/i);
    await expect(page.locator("#timelineYAxis")).toContainText(/Ξ|EUR/, { timeout: 15_000 });
  });

  test("per-tx total P/L annotation, priced via CoinGecko (amend)", async ({ page }) => {
    const block = anyArbitrageBlock();
    test.skip(block === null, "no arbitrages in the shared postgres");

    // prices are fetched for every block now (not just EUR mode) to drive P/L
    const priceResponse = page.waitForResponse(
      (res) => res.url().includes("/api/eur-prices") && res.ok(),
    );
    await page.goto(`${EXPLORER_WEB}/?block=${block}`);
    await priceResponse;

    // where every leg's token is priceable the Detected MEV cell shows a single
    // signed total P/L (in "Ξ" by default) instead of a per-token amount; the
    // EUR toggle re-denominates it. Soft: illiquid legs legitimately fall back.
    const pnl = page.locator("#result .pnl");
    if ((await pnl.count()) > 0) {
      await expect(pnl.first()).toHaveText(/[+-][\d.]+ Ξ/);
      await page.locator("#eurToggle").click();
      await expect(pnl.first()).toHaveText(/[+-][\d.]+ (EUR|€)/);
    }
  });

  test("hovering a trace button highlights related incident legs (amend)", async ({ page }) => {
    const block = anySandwichBlock();
    test.skip(block === null, "no sandwiches in the shared postgres");

    const blockResponse = page.waitForResponse(
      (res) => res.url().includes(`/api/block/${block}`) && res.ok(),
    );
    await page.goto(`${EXPLORER_WEB}/?block=${block}`);
    await blockResponse;

    // a sandwich is a multi-tx incident: its legs share a data-incident id, and
    // the carrier leg's trace button lights up the sibling rows on hover
    const incidentRows = page.locator("#result tr[data-incident]");
    await expect(incidentRows.first()).toBeVisible();
    const traceBtn = page.locator("#result a.trace-link[data-incident]").first();
    await expect(traceBtn).toBeVisible();
    await traceBtn.hover();
    await expect(page.locator("#result tr.incident-hi").first()).toBeVisible();
  });

  // ADR-014: the expanded arbitrage detail shows the aggregate all-token value,
  // the per-token delta table, and a pricing-method provenance badge.
  test("arbitrage detail shows aggregate value + per-token deltas with method badges (ADR-014)", async ({
    page,
  }) => {
    const block = anyMultiTokenArbitrageBlock() ?? anyArbitrageBlock();
    test.skip(block === null, "no arbitrages in the shared postgres");

    const blockResponse = page.waitForResponse(
      (res) => res.url().includes(`/api/block/${block}`) && res.ok(),
    );
    await page.goto(`${EXPLORER_WEB}/?block=${block}`);
    await blockResponse;

    // find the (collapsed) detail row carrying an arbitrage, then expand its tx
    const arbDetail = page.locator("tr.detail-row:has(.detail-block .badge.arbitrage)").first();
    await expect(arbDetail).toHaveCount(1);
    const txHash = await arbDetail.getAttribute("data-detail-for");
    await page.locator(`#result tr[data-tx="${txHash}"]`).click();

    const detail = page
      .locator(`tr[data-detail-for="${txHash}"] .detail-block:has(.badge.arbitrage)`)
      .first();
    await expect(detail).toContainText("Aggregate value (all tokens)");
    // the aggregate is rendered in the ETH unit by default (Ξ) or EUR
    await expect(detail).toContainText(/Ξ|€|EUR/);
    // the per-token delta table with at least one row and a provenance badge
    await expect(detail.locator(".arb-breakdown .arb-delta-row").first()).toBeVisible();
    const badge = detail.locator(".price-method").first();
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/onchain|feed|unpriced/);
  });

  // ADR-014 / task G: the Wiki tab documents how the arbitrage value is priced,
  // with a badge per pricing method.
  test("wiki tab explains arbitrage pricing with the three method badges (ADR-014)", async ({
    page,
  }) => {
    const block = latestInspectedBlock();
    test.skip(block === null, "no inspected blocks in the shared postgres");

    await page.goto(`${EXPLORER_WEB}/?block=${block}`);
    await page.locator(".explore-tab[data-tab=wiki]").click();
    const legend = page.locator("#legend");
    await expect(legend).toContainText("How arbitrage value is priced");
    await expect(legend.locator(".price-method-onchain")).toContainText("onchain");
    await expect(legend.locator(".price-method-feed")).toContainText("feed");
    await expect(legend.locator(".price-method-unpriced")).toContainText("unpriced");
  });
});
