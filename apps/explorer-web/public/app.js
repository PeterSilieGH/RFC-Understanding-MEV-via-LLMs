const themeToggle = document.getElementById("themeToggle");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const currentBlockEl = document.getElementById("currentBlock");
const liveToggleBtn = document.getElementById("liveToggleBtn");
const onlyMevToggle = document.getElementById("onlyMevToggle");
const eurToggle = document.getElementById("eurToggle");
const legendEl = document.getElementById("legend");
const statsEl = document.getElementById("stats");
const resultEl = document.getElementById("result");
const toastEl = document.getElementById("toast");
const loadingOverlay = document.getElementById("loadingOverlay");
const loadingText = document.getElementById("loadingText");
const rpcDot = document.getElementById("rpcDot");
const rpcText = document.getElementById("rpcText");
const tickerEl = document.getElementById("ticker");
const incomeChartEl = document.getElementById("incomeChart");
const incomeLegendEl = document.getElementById("incomeLegend");
const timelineEl = document.getElementById("timeline");
const timelineTrackEl = document.getElementById("timelineTrack");
const timelineCoverageEl = document.getElementById("timelineCoverage");
const timelineIntervalEl = document.getElementById("timelineInterval");
const timelineHandleEl = document.getElementById("timelineHandle");
const timelineStartEl = document.getElementById("timelineStart");
const timelineEndEl = document.getElementById("timelineEnd");
const timelineStatusEl = document.getElementById("timelineStatus");
const addressInput = document.getElementById("addressInput");
const addressSearchBtn = document.getElementById("addressSearchBtn");
const addressResultsEl = document.getElementById("addressResults");
const leaderboardResultsEl = document.getElementById("leaderboardResults");
const heatmapResultsEl = document.getElementById("heatmapResults");
const builderResultsEl = document.getElementById("builderResults");
const relayResultsEl = document.getElementById("relayResults");
const topSearchersResultsEl = document.getElementById("topSearchersResults");
const mempoolStatsResultsEl = document.getElementById("mempoolStatsResults");

const MEV_INFO = {
  arbitrage: {
    label: "Arbitrage",
    short: "Profited from a price gap between pools",
    explain:
      "This transaction bought and sold the same asset across multiple liquidity pools in one atomic transaction, pocketing the price difference. This is generally considered \"clean\" MEV — it doesn't directly harm another trader, it just corrects mispriced pools.",
  },
  sandwich_frontrun: {
    label: "Sandwich · Front-run",
    short: "Bought right before a victim's trade",
    explain:
      "The attacker placed this trade immediately before a victim's swap, anticipating that the victim's trade would push the price up. They profit on the back-run that follows.",
  },
  sandwich_backrun: {
    label: "Sandwich · Back-run",
    short: "Sold right after a victim's trade",
    explain:
      "This is the second half of a sandwich attack: right after a victim's swap moved the price, the attacker closes their position here and locks in the profit.",
  },
  sandwiched_victim: {
    label: "Sandwiched (victim)",
    short: "Got worse pricing because of a sandwich",
    explain:
      "An attacker traded immediately before and after this transaction, capturing the price impact that should have stayed with this trader. This is the kind of MEV that directly costs ordinary users money.",
  },
  liquidation: {
    label: "Liquidation",
    short: "Repaid someone's bad debt for a reward",
    explain:
      "A borrower's collateral fell below the required threshold on a lending protocol, and this transaction repaid their debt in exchange for a discounted slice of their collateral.",
  },
  nft_trade: {
    label: "NFT Trade",
    short: "An NFT changed hands",
    explain: "An NFT was bought or sold in this transaction.",
  },
  punk_snipe: {
    label: "Punk Snipe",
    short: "Bought a CryptoPunk below its listed price",
    explain: "A CryptoPunk was bought, often faster than a human could react to the listing.",
  },
  jit_liquidity_add: {
    label: "JIT Liquidity · Add",
    short: "Added a large LP position right before a swap",
    explain:
      "This transaction minted a concentrated Uniswap V3 position. The same address removed it again later in this very block, with a trade in between — the signature of \"just-in-time\" liquidity: capturing a swap's fee while only exposing capital for seconds.",
  },
  jit_liquidity_remove: {
    label: "JIT Liquidity · Remove",
    short: "Removed an LP position added earlier in this block",
    explain:
      "This transaction withdrew a Uniswap V3 position that the same address had only just minted earlier in this block, after a trade passed through the pool — collecting the fee, then exiting.",
  },
  non_atomic_arbitrage_open: {
    label: "Arbitrage · Open",
    short: "First leg of an arbitrage spread across two transactions",
    explain:
      "This transaction bought an asset on one pool. The same address sold it back at a profit in a separate transaction later in this block — a round trip split across two transactions instead of one atomic one, which most arbitrage detectors (including standard mev-inspect-py) miss entirely since they only look for swap cycles within a single transaction.",
  },
  non_atomic_arbitrage_close: {
    label: "Arbitrage · Close",
    short: "Second leg of an arbitrage spread across two transactions",
    explain:
      "This transaction closes out a round trip that the same address opened in an earlier transaction in this block, locking in the profit across two separate atomic trades.",
  },
  liquidation_sandwich_setup: {
    label: "Liquidation Sandwich · Setup",
    short: "Swap by the liquidator right before their own liquidation",
    explain:
      "The address that performs a liquidation later in this block first swaps here — a pattern consistent with pushing a position underwater (moving the price an oracle or AMM-based health check reads) before liquidating it for a discount. A rare, specialized strategy with very little existing detection coverage in MEV research.",
  },
  liquidation_sandwich_liquidate: {
    label: "Liquidation Sandwich · Liquidate",
    short: "Liquidation preceded by the liquidator's own swap",
    explain:
      "This liquidation was preceded by a swap from the same liquidator address earlier in the block, suggesting the position may have been pushed underwater on purpose rather than becoming liquidatable on its own.",
  },
  liquidation_sandwich_reverse: {
    label: "Liquidation Sandwich · Reverse",
    short: "Liquidator unwinds their setup trade after liquidating",
    explain:
      "After liquidating, the same address trades back here — consistent with unwinding the price-moving swap placed before the liquidation to limit their own exposure to it.",
  },
  liquidation_race_won: {
    label: "Liquidation Race · Won",
    short: "Won a competitive liquidation over at least one other bidder",
    explain:
      "More than one address tried to liquidate the same borrower position in this block. This transaction is the one that actually went through — the others reverted, having spent gas for nothing in the race to get there first.",
  },
  liquidation_race_lost: {
    label: "Liquidation Race · Lost",
    short: "Lost a competitive liquidation, reverted",
    explain:
      "This transaction tried to liquidate the same borrower position as another transaction in this block, but lost the race — another searcher's liquidation landed first, so this one reverted and only paid gas.",
  },
  nft_flip_buy: {
    label: "NFT Flip · Buy",
    short: "Bought an NFT that gets resold in this same block",
    explain:
      "This transaction bought an NFT that the same address resells later in this very block — the NFT-market equivalent of atomic arbitrage.",
  },
  nft_flip_sell: {
    label: "NFT Flip · Sell",
    short: "Resold an NFT bought earlier in this same block",
    explain:
      "This transaction resells an NFT that the same address bought earlier in this block, locking in a profit on the round trip.",
  },
};

const MEMPOOL_INFO = {
  public: {
    label: "Public",
    short: "Seen in our node's public mempool before inclusion",
    explain:
      "This transaction was broadcast to the public peer-to-peer network and observed sitting in our node's mempool before being included.",
  },
  private: {
    label: "Private",
    short: "Never appeared in our node's public mempool",
    explain:
      "This transaction never showed up in our node's mempool, even though we were actively watching at the time it was included. Most likely it was sent directly to a block builder (e.g. via a private RPC / Flashbots Protect) rather than broadcast publicly.",
  },
  caching: {
    label: "Caching",
    short: "Mempool watcher is still warming up",
    explain:
      "The explorer's mempool watcher started less than 2 minutes before this block was mined. This transaction may simply have entered the mempool before we began watching, so we don't call it private — check back once the cache has filled up.",
  },
  unknown: {
    label: "Not tracked",
    short: "Outside our mempool tracking window",
    explain:
      "We only keep mempool sightings for the last 2 minutes, and only since this explorer started watching. This block is outside that window, so we can't tell whether this transaction was public or private.",
  },
};

let state = {
  blockNumber: null,
  transactions: [],
  builder: null,
  bid: null,
  expanded: new Set(),
  onlyMev: false,
  live: true,
  showEur: false,
  eurPrices: {},
  history: [], // [{blockNumber, builder, txCount, mevCount, privateCount, trackedCount}]
  // block timeline (E7)
  timelineHead: null, // newest block the timeline window ends at
  analysisBlock: null, // analysis-slider position (backfill start)
  intervalEnd: null, // right edge of the 100-block interval slider
  coverage: [], // analyzed ranges within the window [{start, end}]
  intervalActivity: new Map(), // blockNumber -> total MEV count (interval)
  tickerMode: "history", // "history" (follow-latest) | "interval"
};

const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

const MAX_HISTORY = 24;
let liveTimer = null;

function showToast(message, type = "") {
  // anchored right under the top bar (E3)
  const header = document.querySelector("header");
  if (header) toastEl.style.top = `${Math.round(header.getBoundingClientRect().bottom) + 8}px`;
  toastEl.textContent = message;
  toastEl.className = `toast show ${type}`;
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.remove("show"), 4000);
}

function setLoading(isLoading, text) {
  loadingOverlay.classList.toggle("hidden", !isLoading);
  if (text) loadingText.textContent = text;
  resultEl.classList.toggle("hidden", isLoading);
  statsEl.classList.toggle("hidden", isLoading);
}

function shortAddr(addr) {
  if (!addr) return "–";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function shortHash(hash) {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function fmtNumber(v) {
  return Math.abs(v) >= 1000 ? v.toFixed(2) : v.toPrecision(4);
}

function fmtAmount(amount) {
  if (!amount) return "";
  if (state.showEur && amount.tokenAddress) {
    const price = state.eurPrices[amount.tokenAddress.toLowerCase()];
    if (price != null) return `${fmtNumber(amount.value * price)} €`;
  }
  return `${fmtNumber(amount.value)} ${amount.symbol}`;
}

// For plain ETH amounts that don't go through fmtAmount (gas/tip/fee
// figures computed client-side, with no token-address-bearing amount object).
function fmtEth(value, decimals = 4) {
  if (value == null) return "–";
  if (state.showEur) {
    const price = state.eurPrices[WETH_ADDRESS];
    if (price != null) return `${(value * price).toFixed(2)} €`;
  }
  return value.toFixed(decimals);
}

function animateCount(el, target, formatFn = (v) => Math.round(v)) {
  const start = 0;
  const duration = 500;
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min(1, (now - startTime) / duration);
    const value = start + (target - start) * progress;
    el.textContent = formatFn(value);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function shortBuilder(name) {
  if (!name) return "Unknown builder";
  return name.length > 22 ? `${name.slice(0, 20)}…` : name;
}

const RELAY_SHORT_NAMES = {
  "aestus.live": "Aestus",
  "agnostic-relay.net": "Agnostic",
  "bloxroute.max-profit.blxrbdn.com": "Bloxroute",
  "bloxroute.regulated.blxrbdn.com": "Bloxroute",
  "boost-relay.flashbots.net": "Flashbots",
  "titanrelay.xyz": "Titan Relay",
  "relay-analytics.ultrasound.money": "Ultra Sound",
  "relay.ethgas.com": "Ethgas",
};

function shortRelay(hostname) {
  if (!hostname) return hostname;
  const clean = hostname.replace(/^https?:\/\//, "");
  return RELAY_SHORT_NAMES[clean] || clean;
}

function pushHistory(blockNumber, transactions, builder, bid) {
  const mevCount = transactions.filter((t) => t.mev.length > 0).length;
  const privateCount = transactions.filter((t) => t.mempool?.status === "private").length;
  // definite verdicts only - "caching" (watcher warming up) proves nothing
  const trackedCount = transactions.filter(
    (t) => t.mempool?.status === "public" || t.mempool?.status === "private",
  ).length;
  const { builderBidEth, bidPct } = computeFeeTotals(transactions, bid);

  state.history = state.history.filter((h) => h.blockNumber !== blockNumber);
  state.history.push({
    blockNumber,
    builder: builder?.builder || null,
    txCount: transactions.length,
    mevCount,
    privateCount,
    trackedCount,
    bidEth: builderBidEth || 0,
    bidPct,
  });
  state.history.sort((a, b) => a.blockNumber - b.blockNumber);
  if (state.history.length > MAX_HISTORY) {
    state.history = state.history.slice(state.history.length - MAX_HISTORY);
  }
}

function renderTicker() {
  if (state.tickerMode === "interval") {
    renderIntervalTicker();
    return;
  }
  if (state.history.length === 0) {
    tickerEl.classList.add("hidden");
    return;
  }
  tickerEl.classList.remove("hidden");
  tickerEl.innerHTML = state.history
    .map((h) => {
      const extreme = h.bidPct != null && h.bidPct > EXTREME_BID_PCT;
      return `
      <div class="ticker-item ${h.blockNumber === state.blockNumber ? "active" : ""} ${extreme ? "hot" : ""}" data-block="${h.blockNumber}">
        <div class="t-block">#${h.blockNumber}</div>
        <div class="t-builder">${shortBuilder(h.builder)}</div>
        <div class="t-row">
          <span class="t-pill mev">${h.mevCount} MEV</span>
          ${h.trackedCount > 0 ? `<span class="t-pill priv">${h.privateCount} priv</span>` : ""}
          ${extreme ? `<span class="t-pill hot">+${h.bidPct.toFixed(0)}% bid</span>` : ""}
        </div>
      </div>
    `;
    })
    .join("");

  tickerEl.querySelectorAll(".ticker-item").forEach((el) => {
    el.addEventListener("click", () => loadBlock(Number(el.dataset.block)));
  });
  tickerEl.scrollLeft = tickerEl.scrollWidth;
}

// ---- Block timeline (E7): analysis slider + 100-block interval slider -----
// The track spans the newest TIMELINE_SPAN blocks up to the chain head.
// Dragging the analysis handle left starts a background backfill from that
// height (E6); the track fills green rightward as Postgres reports coverage.
// The interval slider scopes the ticker strip to 100 blocks; on change the
// interval's highest-MEV block is focused.

const TIMELINE_SPAN = 5000;
const INTERVAL_SIZE = 100;
const BACKFILL_POLL_MS = 3000;

function timelineWindow() {
  const end = state.timelineHead;
  return { start: Math.max(0, end - TIMELINE_SPAN + 1), end };
}

function blockToFrac(block) {
  const { start, end } = timelineWindow();
  return Math.min(1, Math.max(0, (block - start) / Math.max(1, end - start)));
}

function fracToBlock(frac) {
  const { start, end } = timelineWindow();
  return Math.round(start + Math.min(1, Math.max(0, frac)) * (end - start));
}

function renderTimeline() {
  if (state.timelineHead == null) return;
  timelineEl.classList.remove("hidden");
  const { start, end } = timelineWindow();
  timelineStartEl.textContent = `#${start}`;
  timelineEndEl.textContent = `#${end} (head)`;

  timelineHandleEl.style.left = `${blockToFrac(state.analysisBlock) * 100}%`;
  const intervalStartFrac = blockToFrac(state.intervalEnd - INTERVAL_SIZE + 1);
  const intervalEndFrac = blockToFrac(state.intervalEnd);
  timelineIntervalEl.style.left = `${intervalStartFrac * 100}%`;
  timelineIntervalEl.style.width = `${Math.max(0.5, (intervalEndFrac - intervalStartFrac) * 100)}%`;

  timelineCoverageEl.innerHTML = state.coverage
    .filter((r) => r.end >= start && r.start <= end)
    .map((r) => {
      const a = blockToFrac(Math.max(r.start, start));
      const b = blockToFrac(Math.min(r.end, end));
      return `<div class="cov" style="left:${a * 100}%;width:${Math.max(0.15, (b - a) * 100)}%"></div>`;
    })
    .join("");
}

async function refreshCoverage() {
  if (state.timelineHead == null) return;
  const { start, end } = timelineWindow();
  try {
    const res = await fetch(`/api/analyzed-ranges?from=${start}&to=${end}`);
    const data = await res.json();
    state.coverage = data.ranges || [];
    renderTimeline();
    if (state.tickerMode === "interval") renderIntervalTicker();
  } catch {
    /* coverage is cosmetic - never break the page over it */
  }
}

let backfillPollTimer = null;
function pollBackfill() {
  if (backfillPollTimer) return;
  backfillPollTimer = setInterval(async () => {
    try {
      const res = await fetch("/api/backfill");
      const status = await res.json();
      if (status.running) {
        timelineStatusEl.className = "timeline-status active";
        timelineStatusEl.textContent = `backfilling… #${status.cursor} of #${status.targetBlock} (${status.inspected} inspected, ${status.skipped} cached${status.failed ? `, ${status.failed} failed` : ""})`;
        await refreshCoverage();
      } else {
        clearInterval(backfillPollTimer);
        backfillPollTimer = null;
        timelineStatusEl.className = "timeline-status";
        timelineStatusEl.textContent = status.startedAt
          ? `backfill done (${status.inspected} inspected, ${status.skipped} cached${status.failed ? `, ${status.failed} failed` : ""})`
          : "";
        await refreshCoverage();
      }
    } catch {
      /* keep polling */
    }
  }, BACKFILL_POLL_MS);
}

async function startBackfillFrom(block) {
  try {
    const res = await fetch("/api/backfill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromBlock: block }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "backfill failed to start");
    showToast(`Backfilling analysis from block ${block} to the head.`, "success");
    pollBackfill();
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

function trackFrac(clientX) {
  const rect = timelineTrackEl.getBoundingClientRect();
  return (clientX - rect.left) / rect.width;
}

// analysis slider: drag, then backfill from the released position
timelineHandleEl.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  timelineHandleEl.setPointerCapture(e.pointerId);
  const move = (ev) => {
    state.analysisBlock = fracToBlock(trackFrac(ev.clientX));
    renderTimeline();
  };
  const up = () => {
    timelineHandleEl.removeEventListener("pointermove", move);
    timelineHandleEl.removeEventListener("pointerup", up);
    if (state.analysisBlock < state.timelineHead) {
      setLive(false);
      startBackfillFrom(state.analysisBlock);
    }
  };
  timelineHandleEl.addEventListener("pointermove", move);
  timelineHandleEl.addEventListener("pointerup", up);
});

// interval slider: drag the 100-block window, then focus its hottest block
timelineIntervalEl.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  timelineIntervalEl.setPointerCapture(e.pointerId);
  const move = (ev) => {
    state.intervalEnd = Math.max(
      timelineWindow().start + INTERVAL_SIZE - 1,
      fracToBlock(trackFrac(ev.clientX)),
    );
    renderTimeline();
  };
  const up = () => {
    timelineIntervalEl.removeEventListener("pointermove", move);
    timelineIntervalEl.removeEventListener("pointerup", up);
    applyInterval();
  };
  timelineIntervalEl.addEventListener("pointermove", move);
  timelineIntervalEl.addEventListener("pointerup", up);
});

async function applyInterval() {
  const to = state.intervalEnd;
  const from = to - INTERVAL_SIZE + 1;
  state.tickerMode = "interval";
  setLive(false);

  try {
    const res = await fetch(`/api/mev-activity?from=${from}&to=${to}`);
    const data = await res.json();
    state.intervalActivity = new Map((data.blocks || []).map((b) => [b.blockNumber, b.total]));
  } catch {
    state.intervalActivity = new Map();
  }
  await refreshCoverage();
  renderIntervalTicker();

  // focus the interval's highest-MEV block; ties -> newest; none -> newest
  let best = to;
  let bestCount = 0;
  for (const [block, total] of state.intervalActivity) {
    if (total > bestCount || (total === bestCount && total > 0 && block > best)) {
      best = block;
      bestCount = total;
    }
  }
  loadBlock(best);
}

function isAnalyzed(block) {
  return state.coverage.some((r) => block >= r.start && block <= r.end);
}

function renderIntervalTicker() {
  const to = state.intervalEnd;
  const from = to - INTERVAL_SIZE + 1;
  tickerEl.classList.remove("hidden");
  const items = [];
  for (let block = from; block <= to; block++) {
    const analyzed = isAnalyzed(block);
    const activity = state.intervalActivity.get(block) || 0;
    items.push(`
      <div class="ticker-item ${block === state.blockNumber ? "active" : ""} ${analyzed ? "analyzed" : ""}" data-block="${block}" title="${analyzed ? "analyzed" : "not analyzed yet"}">
        <div class="t-block">#${block}</div>
        <div class="t-row">
          ${activity > 0 ? `<span class="t-pill mev">${activity} MEV</span>` : `<span class="t-pill">${analyzed ? "0 MEV" : "—"}</span>`}
        </div>
      </div>
    `);
  }
  tickerEl.innerHTML = items.join("");
  tickerEl.querySelectorAll(".ticker-item").forEach((el) => {
    el.addEventListener("click", () => loadBlock(Number(el.dataset.block)));
  });
  const active = tickerEl.querySelector(".ticker-item.active");
  if (active) active.scrollIntoView({ block: "nearest", inline: "center" });
}

// The legend stays limited to the well-known/textbook MEV types - badges
// for the advanced ones (JIT liquidity, non-atomic arbitrage, liquidation
// sandwich/race, NFT flips) still render in the table using MEV_INFO, they
// just don't bloat this overview popup.
const LEGEND_MEV_TYPES = [
  "arbitrage",
  "sandwich_frontrun",
  "sandwich_backrun",
  "sandwiched_victim",
  "liquidation",
  "nft_trade",
  "punk_snipe",
];

function buildLegend() {
  const mevItems = LEGEND_MEV_TYPES.map(
    (type) => `
      <div class="legend-item">
        <span class="badge ${type}">${MEV_INFO[type].label}</span>
        <p><strong>${MEV_INFO[type].short}.</strong> ${MEV_INFO[type].explain}</p>
      </div>
    `
  ).join("");

  const mempoolItems = Object.entries(MEMPOOL_INFO)
    .map(
      ([status, info]) => `
      <div class="legend-item">
        <span class="badge mp-${status}">${info.label}</span>
        <p><strong>${info.short}.</strong> ${info.explain}</p>
      </div>
    `
    )
    .join("");

  legendEl.innerHTML = `
    <div class="legend-section-title">MEV types</div>
    <p class="legend-intro">This MEV explorer was built for the DeSys and RFC lecture and makes no claim to cover MEV attacks exhaustively. We only detect simple MEV attacks here. :)</p>
    ${mevItems}
    <div class="legend-section-title">Mempool visibility</div>
    ${mempoolItems}
  `;
}

// Threshold above which a block's direct builder payment is considered
// disproportionate to the priority fees it collected, worth calling out.
const EXTREME_BID_PCT = 110;

function sumPriorityFeeWei(transactions) {
  return transactions.reduce((sum, tx) => {
    if (tx.gasPriceWei == null || tx.baseFeePerGasWei == null || tx.gasUsed == null) return sum;
    const priorityPerGas = Math.max(0, Number(tx.gasPriceWei) - Number(tx.baseFeePerGasWei));
    return sum + priorityPerGas * Number(tx.gasUsed);
  }, 0);
}

function pctDiff(value, base) {
  return base > 0 && value != null ? ((value - base) / base) * 100 : null;
}

function computeFeeTotals(transactions, bid) {
  const priorityFeeEth = sumPriorityFeeWei(transactions) / 1e18;
  const publicTransactions = transactions.filter((tx) => tx.mempool?.status === "public");
  const priorityFeePublicEth = sumPriorityFeeWei(publicTransactions) / 1e18;
  const builderBidEth = bid?.valueWei != null ? Number(bid.valueWei) / 1e18 : null;
  // The "vs public tx only" comparison is the meaningful one - private order
  // flow often pays little to no priority fee (it pays the builder directly
  // instead), so including it would understate or overstate how the bid
  // relates to the actual public fee market. The "vs all tx" figure is shown
  // alongside it purely for reference.
  const bidPct = pctDiff(builderBidEth, priorityFeePublicEth);
  const bidPctOfAll = pctDiff(builderBidEth, priorityFeeEth);
  return { priorityFeeEth, priorityFeePublicEth, builderBidEth, bidPct, bidPctOfAll };
}

function renderStats(transactions) {
  const count = (type) =>
    transactions.reduce((n, tx) => n + tx.mev.filter((m) => m.type === type).length, 0);

  const arbitrages = count("arbitrage");
  const sandwiches = count("sandwich_frontrun");
  const liquidations = count("liquidation");
  const swaps = transactions.reduce((n, tx) => n + tx.swaps.length, 0);
  const privateTx = transactions.filter((t) => t.mempool?.status === "private").length;
  // definite verdicts only - "caching" (watcher warming up) proves nothing
  const trackedTx = transactions.filter(
    (t) => t.mempool?.status === "public" || t.mempool?.status === "private",
  ).length;
  const cachingTx = transactions.filter((t) => t.mempool?.status === "caching").length;

  // E4 (amended): transactions first, then private; fees/tips/bid live in
  // the income chart tab (E5)
  const cards = [
    { label: "Transactions", value: transactions.length, accent: "total" },
    cachingTx > 0
      ? {
          // watcher warming up: absence of sightings proves nothing yet
          label: "Private tx",
          value: 0,
          accent: "mev",
          raw: "caching",
        }
      : trackedTx > 0
        ? { label: "Private tx", value: privateTx, accent: "private" }
        : { label: "Private tx (not tracked)", value: 0, accent: "total", raw: "n/a" },
    { label: "DEX swaps", value: swaps, accent: "total" },
    { label: "Arbitrages", value: arbitrages, accent: "blue" },
    { label: "Sandwiches", value: sandwiches, accent: "blue" },
    { label: "Liquidations", value: liquidations, accent: "blue" },
  ];

  statsEl.innerHTML = cards
    .map(
      (c, i) => `
      <div class="stat-card accent-${c.accent}" style="animation-delay:${i * 40}ms">
        <div class="stat-value" id="stat-${i}">${c.raw ? c.raw : "0"}</div>
        <div class="stat-label">${c.label}</div>
        ${c.sub ? `<div class="stat-sub">${c.sub}</div>` : ""}
      </div>
    `
    )
    .join("");

  cards.forEach((c, i) => {
    if (c.raw) return;
    animateCount(document.getElementById(`stat-${i}`), c.value, c.format || ((v) => Math.round(v)));
  });
}

// ---- Stat-visualization column (E5): block income vs builder bid ----------
// One persistent SVG; rects transition (CSS) between blocks instead of the
// chart being rebuilt, so block changes animate.

const INCOME_SEGMENTS = [
  { key: "feesPublic", label: "Priority fees — public", color: "var(--green)" },
  { key: "feesPrivate", label: "Priority fees — private", color: "var(--red)" },
  { key: "feesOther", label: "Priority fees — untracked", color: "var(--muted)" },
  { key: "tipsPublic", label: "Builder tips — public", color: "var(--teal)" },
  { key: "tipsPrivate", label: "Builder tips — private", color: "var(--orange)" },
  { key: "tipsOther", label: "Builder tips — untracked", color: "var(--pink)" },
];

const CHART = { width: 260, top: 14, axisY: 158, barWidth: 62, incomeX: 40, bidX: 158 };

function computeIncomeBreakdown(transactions, bid) {
  const byStatus = (status) => transactions.filter((tx) => tx.mempool?.status === status);
  const fees = (txs) => sumPriorityFeeWei(txs) / 1e18;
  const tips = (txs) => txs.reduce((s, tx) => s + (tx.coinbaseTransferEth || 0), 0);

  const feesPublic = fees(byStatus("public"));
  const feesPrivate = fees(byStatus("private"));
  const feesOther = Math.max(0, fees(transactions) - feesPublic - feesPrivate);
  const tipsPublic = tips(byStatus("public"));
  const tipsPrivate = tips(byStatus("private"));
  const tipsOther = Math.max(0, tips(transactions) - tipsPublic - tipsPrivate);

  // the builder's block income is all priority fees plus all coinbase tips;
  // the bid is what it pays the proposer for the slot
  const income = fees(transactions) + tips(transactions);
  const bidEth = bid?.valueWei != null ? Number(bid.valueWei) / 1e18 : null;
  return { feesPublic, feesPrivate, feesOther, tipsPublic, tipsPrivate, tipsOther, income, bidEth };
}

let chartInitialized = false;
function initIncomeChart() {
  if (chartInitialized) return;
  chartInitialized = true;
  const ns = "http://www.w3.org/2000/svg";
  const make = (tag, attrs) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };

  for (const segment of INCOME_SEGMENTS) {
    const rect = make("rect", {
      id: `seg-${segment.key}`,
      x: CHART.incomeX,
      width: CHART.barWidth,
      y: CHART.axisY,
      height: 0,
      fill: segment.color,
    });
    incomeChartEl.appendChild(rect);
  }
  incomeChartEl.appendChild(
    make("rect", {
      id: "seg-bid",
      x: CHART.bidX,
      width: CHART.barWidth,
      y: CHART.axisY,
      height: 0,
      fill: "var(--green)",
    }),
  );
  incomeChartEl.appendChild(
    make("line", {
      x1: 8, x2: CHART.width - 8, y1: CHART.axisY, y2: CHART.axisY,
      stroke: "var(--border)", "stroke-width": 1,
    }),
  );
  const incomeTotal = make("text", {
    id: "total-income", class: "viz-bar-total",
    x: CHART.incomeX + CHART.barWidth / 2, y: CHART.top - 3, "text-anchor": "middle",
  });
  const bidTotal = make("text", {
    id: "total-bid", class: "viz-bar-total",
    x: CHART.bidX + CHART.barWidth / 2, y: CHART.top - 3, "text-anchor": "middle",
  });
  const incomeLabel = make("text", {
    class: "viz-bar-label",
    x: CHART.incomeX + CHART.barWidth / 2, y: CHART.axisY + 14, "text-anchor": "middle",
  });
  incomeLabel.textContent = "block income";
  const bidLabel = make("text", {
    class: "viz-bar-label",
    x: CHART.bidX + CHART.barWidth / 2, y: CHART.axisY + 14, "text-anchor": "middle",
  });
  bidLabel.textContent = "builder bid";
  for (const el of [incomeTotal, bidTotal, incomeLabel, bidLabel]) incomeChartEl.appendChild(el);
}

function renderIncomeChart(transactions, bid) {
  initIncomeChart();

  const b = computeIncomeBreakdown(transactions, bid);
  const scaleMax = Math.max(b.income, b.bidEth ?? 0, 1e-9);
  const px = (eth) => (eth / scaleMax) * (CHART.axisY - CHART.top - 16);

  let y = CHART.axisY;
  for (const segment of INCOME_SEGMENTS) {
    const h = px(b[segment.key]);
    y -= h;
    const rect = document.getElementById(`seg-${segment.key}`);
    rect.setAttribute("y", y);
    rect.setAttribute("height", h);
  }

  const bidRect = document.getElementById("seg-bid");
  const bidH = b.bidEth != null ? px(b.bidEth) : 0;
  bidRect.setAttribute("y", CHART.axisY - bidH);
  bidRect.setAttribute("height", bidH);
  const bidProfitable = b.bidEth != null && b.bidEth <= b.income;
  bidRect.setAttribute("fill", bidProfitable ? "var(--green)" : "var(--red)");

  document.getElementById("total-income").textContent = fmtEth(b.income);
  document.getElementById("total-bid").textContent = b.bidEth != null ? fmtEth(b.bidEth) : "n/a";

  const money = state.showEur ? "EUR" : "ETH";
  const segmentRows = INCOME_SEGMENTS.filter((segment) => b[segment.key] > 0)
    .map(
      (segment) => `
        <div class="legend-row">
          <span class="legend-swatch" style="background:${segment.color}"></span>
          <span class="legend-name">${segment.label}</span>
          <span class="legend-value">${fmtEth(b[segment.key])} ${money}</span>
        </div>`,
    )
    .join("");
  const bidRow =
    b.bidEth != null
      ? `
        <div class="legend-row">
          <span class="legend-swatch" style="background:${bidProfitable ? "var(--green)" : "var(--red)"}"></span>
          <span class="legend-name">Builder bid${bid?.relay ? ` — via ${shortRelay(bid.relay)}` : ""}</span>
          <span class="legend-value ${bidProfitable ? "profit" : "loss"}">${fmtEth(b.bidEth)} ${money}${
            b.income > 0 ? ` (${((b.bidEth / b.income) * 100).toFixed(1)}%)` : ""
          }</span>
        </div>`
      : `
        <div class="legend-row">
          <span class="legend-swatch" style="background:var(--muted)"></span>
          <span class="legend-name">Builder bid</span>
          <span class="legend-value">n/a</span>
        </div>`;
  const builderName = state.builder?.builder;
  incomeLegendEl.innerHTML = `
    ${segmentRows}
    ${bidRow}
    <div class="legend-builder" title="Decoded from the block's extraData field">
      Builder: ${builderName ? builderName : "unknown (no graffiti)"}<br/>
      Fee recipient: ${addrLink(state.builder?.feeRecipient)}
    </div>
  `;
}

function renderMevDetail(m) {
  const info = MEV_INFO[m.type] || { label: m.type, explain: "" };
  const rows = [];

  switch (m.type) {
    case "arbitrage":
      rows.push(kv("Account", addrLink(m.accountAddress)));
      if (m.profit) rows.push(kv("Profit", profitSpan(m.profit)));
      if (m.protocols?.length) rows.push(kv("Protocols", m.protocols.join(", ")));
      if (m.error) rows.push(kv("Note", `reverted (${m.error})`));
      break;
    case "sandwich_frontrun":
    case "sandwich_backrun":
      rows.push(kv("Attacker", addrLink(m.sandwicherAddress)));
      if (m.profit) rows.push(kv("Profit", profitSpan(m.profit)));
      if (m.victimTxHashes?.length)
        rows.push(kv("Victim tx", m.victimTxHashes.map((h) => txLink(h)).join(", ")));
      break;
    case "sandwiched_victim":
      rows.push(kv("Attacker", addrLink(m.sandwicherAddress)));
      break;
    case "liquidation":
      rows.push(kv("Protocol", m.protocol || "unknown"));
      rows.push(kv("Borrower", addrLink(m.liquidatedUser)));
      rows.push(kv("Liquidator", addrLink(m.liquidatorUser)));
      if (m.debtPurchase) rows.push(kv("Debt repaid", fmtAmount(m.debtPurchase)));
      if (m.received) rows.push(kv("Collateral received", profitSpan(m.received)));
      break;
    case "nft_trade":
      rows.push(kv("Protocol", m.protocol || "unknown"));
      rows.push(kv("Seller", addrLink(m.sellerAddress)));
      rows.push(kv("Buyer", addrLink(m.buyerAddress)));
      if (m.payment) rows.push(kv("Price", fmtAmount(m.payment)));
      break;
    case "punk_snipe":
      rows.push(kv("Punk", `#${m.punkIndex}`));
      break;
    case "jit_liquidity_add":
    case "jit_liquidity_remove":
      rows.push(kv("Provider", addrLink(m.sender)));
      rows.push(kv("Pool", m.pairLabel));
      rows.push(
        kv(
          m.type === "jit_liquidity_add" ? "Removed in" : "Added in",
          txLink(m.counterpartTxHash)
        )
      );
      rows.push(kv("Swaps in between", m.swapsBetween));
      break;
    case "non_atomic_arbitrage_open":
    case "non_atomic_arbitrage_close":
      rows.push(kv("Account", addrLink(m.accountAddress)));
      if (m.profit) rows.push(kv("Profit", profitSpan(m.profit)));
      rows.push(
        kv(
          m.type === "non_atomic_arbitrage_open" ? "Closed in" : "Opened in",
          txLink(m.counterpartTxHash)
        )
      );
      break;
    case "liquidation_sandwich_setup":
      rows.push(kv("Liquidator", addrLink(m.liquidatorAddress)));
      rows.push(kv("Liquidation tx", txLink(m.counterpartTxHash)));
      break;
    case "liquidation_sandwich_liquidate":
      rows.push(kv("Liquidator", addrLink(m.liquidatorAddress)));
      rows.push(kv("Setup swap tx", txLink(m.counterpartTxHash)));
      if (m.reverseTxHash) rows.push(kv("Reverse swap tx", txLink(m.reverseTxHash)));
      break;
    case "liquidation_sandwich_reverse":
      rows.push(kv("Liquidator", addrLink(m.liquidatorAddress)));
      rows.push(kv("Liquidation tx", txLink(m.counterpartTxHash)));
      break;
    case "liquidation_race_won":
      rows.push(kv("Borrower", addrLink(m.borrowerAddress)));
      rows.push(
        kv(
          m.loserTxHashes.length === 1 ? "Lost competing tx" : "Lost competing txs",
          m.loserTxHashes.map((h) => txLink(h)).join(", ")
        )
      );
      break;
    case "liquidation_race_lost":
      rows.push(kv("Borrower", addrLink(m.borrowerAddress)));
      rows.push(kv("Winner", addrLink(m.winnerAddress)));
      rows.push(kv("Winning tx", txLink(m.winnerTxHash)));
      break;
    case "nft_flip_buy":
    case "nft_flip_sell":
      rows.push(kv("Flipper", addrLink(m.flipperAddress)));
      rows.push(kv("Collection", addrLink(m.collectionAddress)));
      rows.push(kv("Token ID", `#${m.tokenId}`));
      if (m.profit) rows.push(kv("Profit", profitSpan(m.profit)));
      rows.push(
        kv(m.type === "nft_flip_buy" ? "Resold in" : "Bought in", txLink(m.counterpartTxHash))
      );
      break;
    default:
      break;
  }

  return `
    <div class="detail-block">
      <h4><span class="badge ${m.type}">${info.label}</span></h4>
      <p class="explainer">${info.explain}</p>
      ${rows.join("")}
    </div>
  `;
}

function kv(key, value) {
  return `<div class="kv-row"><span class="k">${key}</span><span>${value}</span></div>`;
}

function addrLink(addr) {
  if (!addr) return "–";
  return `<a class="addr mono" href="https://etherscan.io/address/${addr}" target="_blank" rel="noopener">${shortAddr(addr)}</a>`;
}

function txLink(hash) {
  return `<a class="addr mono" href="https://etherscan.io/tx/${hash}" target="_blank" rel="noopener">${shortHash(hash)}</a>`;
}

// Deep link into the DiscoUI trace view (apps/disco), which renders the
// transaction's execution trace annotated with the MEV facts shown here.
// The port comes from /env.js (nginx-injected) with the compose default.
function traceLink(hash, legCount) {
  const port = (window.__ENV && window.__ENV.discoWebPort) || 8082;
  const url = `http://${window.location.hostname}:${port}/ui/trace/${hash}`;
  const label = legCount > 1 ? `trace (${legCount} tx)` : "trace";
  const title =
    legCount > 1
      ? `Open all ${legCount} transactions of this incident as one DiscoUI workspace`
      : "Open the execution trace in DiscoUI";
  return `<a class="trace-link" href="${url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="${title}">${label}</a>`;
}

// Mirror of trace-api's incident resolution (workspace.ts): the legs of a
// multi-transaction MEV incident (sandwich front-run/victims/back-run,
// two-legged arbitrage, …) all resolve to the same canonical id (the
// lexicographically smallest leg hash), so DiscoUI analyzes them in one
// virtual project - and the table shows one trace link per incident.
const INCIDENT_LEG_FIELDS = [
  "counterpartTxHash",
  "frontrunTxHash",
  "backrunTxHash",
  "winnerTxHash",
  "reverseTxHash",
];
const INCIDENT_LEG_LIST_FIELDS = ["victimTxHashes", "loserTxHashes"];

function incidentLegs(tx) {
  const legs = new Set([tx.hash.toLowerCase()]);
  for (const m of tx.mev) {
    for (const field of INCIDENT_LEG_FIELDS) {
      if (typeof m[field] === "string") legs.add(m[field].toLowerCase());
    }
    for (const field of INCIDENT_LEG_LIST_FIELDS) {
      for (const h of m[field] || []) legs.add(h.toLowerCase());
    }
  }
  return [...legs].sort();
}

function profitSpan(amount) {
  const isLoss = amount.value < 0;
  return `<span class="${isLoss ? "loss" : "profit"}">${fmtAmount(amount)}</span>`;
}

function fmtDuration(seconds) {
  if (seconds == null) return "<1s";
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function renderMempoolBadge(mempool) {
  const info = MEMPOOL_INFO[mempool?.status] || MEMPOOL_INFO.unknown;
  const text =
    mempool?.status === "public"
      ? `${info.label} · ${fmtDuration(mempool.secondsInMempool)}`
      : info.label;
  return `<span class="badge mp-${mempool?.status || "unknown"}" title="${info.short}">${text}</span>`;
}

function renderSwapChips(swaps) {
  if (!swaps.length) return "";
  return swaps
    .map((s) => {
      const inStr = s.tokenIn ? fmtAmount(s.tokenIn) : "?";
      const outStr = s.tokenOut ? fmtAmount(s.tokenOut) : "?";
      return `<span class="swap-chip">${s.protocol || "swap"}: ${inStr} <span class="arrow">→</span> ${outStr}</span>`;
    })
    .join("");
}

function renderTable() {
  const visible = state.onlyMev
    ? state.transactions.filter((t) => t.mev.length > 0)
    : state.transactions;

  if (visible.length === 0) {
    resultEl.innerHTML = `<div class="empty-state">No transactions match the current filter.</div>`;
    return;
  }

  // one trace link per incident: the first rendered leg carries it
  const incidentLinkCarrier = new Map();
  for (const tx of visible) {
    const legs = incidentLegs(tx);
    if (legs.length > 1 && !incidentLinkCarrier.has(legs[0])) {
      incidentLinkCarrier.set(legs[0], tx.hash);
    }
  }

  const rows = visible
    .map((tx) => {
      const badges = tx.mev.length
        ? tx.mev
            .map((m) => {
              const info = MEV_INFO[m.type] || { label: m.type, short: "" };
              const amount = m.profit || m.received;
              const profitText = amount
                ? ` <span class="${amount.value < 0 ? "loss" : "profit"}">${fmtAmount(amount)}</span>`
                : "";
              return `<span class="badge ${m.type}" title="${info.short}">${info.label}</span>${profitText}`;
            })
            .join("")
        : `<span class="badge none">no attacks detected</span>`;

      const legs = incidentLegs(tx);
      const traceLinkHtml =
        legs.length === 1
          ? traceLink(tx.hash)
          : incidentLinkCarrier.get(legs[0]) === tx.hash
            ? traceLink(legs[0], legs.length)
            : `<span class="trace-link-ref" title="Part of a multi-transaction incident - the trace link on its first transaction opens all ${legs.length} legs together">↳ incident</span>`;

      const isExpanded = state.expanded.has(tx.hash);
      const hasDetail = tx.mev.length > 0 || tx.swaps.length > 0;

      const detailHtml = hasDetail
        ? `
          <tr class="detail-row ${isExpanded ? "" : "hidden"}" data-detail-for="${tx.hash}">
            <td colspan="8">
              ${tx.mev.map(renderMevDetail).join("")}
              ${
                tx.swaps.length
                  ? `<div class="detail-block"><h4>DEX swaps in this transaction (${tx.swaps.length})</h4>${renderSwapChips(tx.swaps)}</div>`
                  : ""
              }
            </td>
          </tr>`
        : "";

      return `
        <tr class="${tx.mev.length ? "has-mev" : ""} ${isExpanded ? "expanded" : ""}" data-tx="${tx.hash}" data-has-detail="${hasDetail}">
          <td class="mono">${hasDetail ? '<span class="expand-arrow">▶</span>' : ""}<a class="addr" href="https://etherscan.io/tx/${tx.hash}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${shortHash(tx.hash)}</a> ${traceLinkHtml}</td>
          <td class="mono">${addrLink(tx.from)}</td>
          <td class="mono">${addrLink(tx.to)}</td>
          <td class="mono">${tx.gasUsed ?? "–"}</td>
          <td class="mono">${tx.gasPriceGwei ? tx.gasPriceGwei.toFixed(2) : "–"}</td>
          <td class="mono">${tx.coinbaseTransferEth ? fmtEth(tx.coinbaseTransferEth, 5) : "0"}</td>
          <td>${renderMempoolBadge(tx.mempool)}</td>
          <td>${badges}</td>
        </tr>
        ${detailHtml}
      `;
    })
    .join("");

  resultEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Tx Hash</th>
          <th>From</th>
          <th>To</th>
          <th>Gas Used</th>
          <th>Gas Price (gwei)</th>
          <th>Builder Tip (${state.showEur ? "EUR" : "ETH"})</th>
          <th>Mempool</th>
          <th>Detected MEV</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  resultEl.querySelectorAll("tr[data-tx]").forEach((row) => {
    if (row.dataset.hasDetail !== "true") return;
    row.addEventListener("click", () => {
      const hash = row.dataset.tx;
      if (state.expanded.has(hash)) state.expanded.delete(hash);
      else state.expanded.add(hash);
      renderTable();
    });
  });
}

async function loadBlock(blockNumber, { silent = false } = {}) {
  if (!silent) setLoading(true, `Inspecting block ${blockNumber}…`);

  try {
    const res = await fetch(`/api/block/${blockNumber}`);
    let data;
    try {
      data = await res.json();
    } catch {
      // a proxy timeout answers with an HTML error page, not JSON
      throw new Error(
        res.status === 504
          ? "Block inspection timed out — is the RPC node healthy?"
          : `Unexpected ${res.status} response from the API`
      );
    }
    if (!res.ok) throw new Error(data.error || "Failed to load block");

    state.blockNumber = data.blockNumber;
    state.transactions = data.transactions;
    state.builder = data.builder;
    state.bid = data.bid;
    state.expanded.clear();
    currentBlockEl.textContent = `#${data.blockNumber}`;

    pushHistory(data.blockNumber, data.transactions, data.builder, data.bid);

    await refreshEurPrices();

    renderStats(state.transactions);
    renderIncomeChart(state.transactions, state.bid);
    renderMempoolBlock();
    renderTable();
    renderTicker();
    renderTimeline();

    showToast(
      data.alreadyInspected
        ? `Block ${data.blockNumber} loaded from cache.`
        : `Block ${data.blockNumber} freshly inspected.`,
      "success"
    );
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  } finally {
    if (!silent) setLoading(false);
  }
}

async function fetchLatestBlockNumber() {
  const res = await fetch("/api/latest");
  if (!res.ok) throw new Error("RPC unreachable");
  const data = await res.json();
  return data.blockNumber;
}

async function pollRpcStatus() {
  try {
    const latest = await fetchLatestBlockNumber();
    rpcDot.className = "dot online";
    rpcText.textContent = `mainnet · head #${latest}`;

    // timeline window ends at the head; in follow-latest mode both sliders
    // stay pinned right (current behavior preserved, E7)
    const firstHead = state.timelineHead == null;
    state.timelineHead = latest;
    if (firstHead || state.live) {
      state.analysisBlock = latest;
      state.intervalEnd = latest;
    }
    renderTimeline();
    if (firstHead) refreshCoverage();

    if (state.live && latest !== state.blockNumber) {
      loadBlock(latest, { silent: true });
    }
  } catch {
    rpcDot.className = "dot offline";
    rpcText.textContent = "RPC unreachable";
  }
}

prevBtn.addEventListener("click", () => {
  if (state.blockNumber != null) loadBlock(state.blockNumber - 1);
});
nextBtn.addEventListener("click", () => {
  if (state.blockNumber != null) loadBlock(state.blockNumber + 1);
});

// follow-latest is an icon box-toggle in the top bar (same pattern as the
// MEV-only/EUR/theme toggles); re-enabling pins both timeline sliders right
// and restores the recently-viewed ticker (E7)
function setLive(on) {
  state.live = on;
  liveToggleBtn.classList.toggle("active", on);
  if (on) {
    state.tickerMode = "history";
    if (state.timelineHead != null) {
      state.analysisBlock = state.timelineHead;
      state.intervalEnd = state.timelineHead;
    }
    renderTimeline();
    renderTicker();
  }
}

liveToggleBtn.addEventListener("click", () => {
  setLive(!state.live);
  showToast(state.live ? "Following the latest block." : "Stopped following.", "");
});

// E2: icon box-toggle in the top bar (same pattern as the EUR/theme toggles)
onlyMevToggle.addEventListener("click", () => {
  state.onlyMev = !state.onlyMev;
  onlyMevToggle.classList.toggle("active", state.onlyMev);
  renderTable();
});

function collectTokenAddresses() {
  const addresses = new Set([WETH_ADDRESS]);
  for (const tx of state.transactions) {
    for (const swap of tx.swaps) {
      if (swap.tokenIn?.tokenAddress) addresses.add(swap.tokenIn.tokenAddress.toLowerCase());
      if (swap.tokenOut?.tokenAddress) addresses.add(swap.tokenOut.tokenAddress.toLowerCase());
    }
    for (const m of tx.mev) {
      for (const field of ["profit", "received", "payment", "debtPurchase"]) {
        if (m[field]?.tokenAddress) addresses.add(m[field].tokenAddress.toLowerCase());
      }
    }
  }
  return [...addresses];
}

async function refreshEurPrices() {
  if (!state.showEur) return;
  try {
    const res = await fetch(`/api/eur-prices?tokens=${collectTokenAddresses().join(",")}`);
    const data = await res.json();
    state.eurPrices = data.prices || {};
  } catch {
    state.eurPrices = {};
  }
}

function rerenderAfterCurrencyChange() {
  renderStats(state.transactions);
  if (state.blockNumber != null) renderIncomeChart(state.transactions, state.bid);
  renderTable();
}

eurToggle.addEventListener("click", async () => {
  state.showEur = !state.showEur;
  eurToggle.textContent = state.showEur ? "€" : "Ξ";
  eurToggle.classList.toggle("active", state.showEur);
  if (state.showEur) {
    showToast("Fetching EUR prices…", "");
    await refreshEurPrices();
  }
  rerenderAfterCurrencyChange();
});

const ACTIVITY_LABELS = {
  arbitrage: "Arbitrage",
  sandwich: "Sandwich (as attacker)",
  liquidation_performed: "Liquidation performed",
  liquidation_suffered: "Liquidation suffered",
  nft_trade: "NFT trade",
};

function renderAddressResults(address, items) {
  if (items.length === 0) {
    addressResultsEl.innerHTML = `<div class="empty-state">No MEV activity found for this address in any inspected block yet. Note: only blocks this explorer has actually inspected are searchable — try inspecting more blocks first.</div>`;
    return;
  }

  addressResultsEl.innerHTML = items
    .map((item) => {
      const amount = item.profit || item.payment;
      const amountHtml = amount ? profitSpan(amount) : "";
      return `
        <div class="activity-row">
          <span class="badge ${item.type === "sandwich" ? "sandwich_frontrun" : item.type === "arbitrage" ? "arbitrage" : item.type.startsWith("liquidation") ? "liquidation" : "nft_trade"}">${ACTIVITY_LABELS[item.type] || item.type}</span>
          <span>Block ${item.blockNumber}</span>
          ${txLink(item.transactionHash)}
          ${amountHtml}
          ${item.protocol ? `<span class="mono">${item.protocol}</span>` : ""}
        </div>
      `;
    })
    .join("");
}

async function searchAddress() {
  const address = addressInput.value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    showToast("Enter a valid 0x… address.", "error");
    return;
  }
  addressResultsEl.innerHTML = `<div class="empty-state">Searching…</div>`;
  try {
    const res = await fetch(`/api/address/${address}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Search failed");
    renderAddressResults(address, data.items);
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

function renderLeaderboard(data) {
  const cols = [
    { key: "arbitrageurs", title: "Top arbitrageurs" },
    { key: "sandwichers", title: "Top sandwich attackers" },
    { key: "liquidators", title: "Top liquidators" },
  ];

  leaderboardResultsEl.innerHTML = cols
    .map((c) => {
      const rows = data[c.key] || [];
      const rowsHtml = rows.length
        ? rows
            .map(
              (r, i) => `
            <div class="leaderboard-row">
              <span><span class="rank">#${i + 1}</span>${addrLink(r.address)}</span>
              <span class="count">${r.count}</span>
            </div>
          `
            )
            .join("")
        : `<p class="explore-hint">No data yet.</p>`;
      return `<div class="leaderboard-col"><h4>${c.title}</h4>${rowsHtml}</div>`;
    })
    .join("");
}

function renderTopSearchers(searchers) {
  if (!searchers.length) {
    topSearchersResultsEl.innerHTML = `<p class="explore-hint">No data yet.</p>`;
    return;
  }
  topSearchersResultsEl.innerHTML = searchers
    .map((s, i) => {
      const tags = [
        s.arbitrage ? `<span class="badge arbitrage">Arb ${s.arbitrage}</span>` : "",
        s.sandwich ? `<span class="badge sandwich_frontrun">Sandwich ${s.sandwich}</span>` : "",
        s.liquidation ? `<span class="badge liquidation">Liq ${s.liquidation}</span>` : "",
      ].join("");
      const profit = s.profitEur != null ? `${fmtNumber(s.profitEur)} €` : "n/a";
      return `
        <div class="searcher-row">
          <span><span class="rank">#${i + 1}</span>${addrLink(s.address)}</span>
          <span class="searcher-tags">${tags}</span>
          <span class="searcher-actions">${s.total} actions</span>
          <span class="count">${profit}</span>
        </div>`;
    })
    .join("");
}

async function loadLeaderboard() {
  leaderboardResultsEl.innerHTML = `<div class="empty-state">Loading…</div>`;
  topSearchersResultsEl.innerHTML = `<div class="empty-state">Loading…</div>`;
  try {
    const res = await fetch("/api/leaderboard");
    const data = await res.json();
    renderLeaderboard(data);
  } catch {
    leaderboardResultsEl.innerHTML = `<div class="empty-state">Failed to load leaderboard.</div>`;
  }
  try {
    const res = await fetch("/api/top-searchers");
    const data = await res.json();
    renderTopSearchers(data.searchers || []);
  } catch {
    topSearchersResultsEl.innerHTML = `<div class="empty-state">Failed to load.</div>`;
  }
}

function renderHeatmap(pools) {
  if (pools.length === 0) {
    heatmapResultsEl.innerHTML = `<div class="empty-state">No sandwiches detected in inspected blocks yet.</div>`;
    return;
  }
  const max = Math.max(...pools.map((p) => p.count));
  heatmapResultsEl.innerHTML = pools
    .map((p) => {
      const label = p.pair ? `${p.pair.tokenA}/${p.pair.tokenB} (${p.pair.protocol})` : shortAddr(p.address);
      return `
        <div class="heatmap-row">
          <span class="heatmap-label mono">${label}</span>
          <div class="heatmap-bar-track"><div class="heatmap-bar-fill" style="width:${(p.count / max) * 100}%"></div></div>
          <span class="heatmap-count">${p.count}</span>
        </div>
      `;
    })
    .join("");
}

async function loadHeatmap() {
  heatmapResultsEl.innerHTML = `<div class="empty-state">Loading…</div>`;
  try {
    const res = await fetch("/api/pool-heatmap");
    const data = await res.json();
    renderHeatmap(data.pools);
  } catch {
    heatmapResultsEl.innerHTML = `<div class="empty-state">Failed to load.</div>`;
  }
}

const PIE_COLORS = ["#7fae7f", "#7aa3c4", "#c79a5b", "#b884a0", "#c4b46a", "#c47a7a", "#9aa0ab", "#5e6166"];

function polarPoint(cx, cy, r, angle) {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function pieSlicePath(cx, cy, r, startAngle, endAngle) {
  const [x1, y1] = polarPoint(cx, cy, r, startAngle);
  const [x2, y2] = polarPoint(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  // a full circle (one builder = 100%) needs a tiny gap, or M..A..A..Z draws nothing
  if (endAngle - startAngle >= Math.PI * 2 - 0.001) {
    return `M${cx},${cy - r} A${r},${r} 0 1 1 ${cx - 0.01},${cy - r} Z`;
  }
  return `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${largeArc} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
}

function groupSmallSlices(items, minFraction = 0.01) {
  const total = items.reduce((sum, b) => sum + b.count, 0);
  if (total === 0) return items;
  const big = items.filter((b) => b.count / total >= minFraction);
  const small = items.filter((b) => b.count / total < minFraction);
  if (small.length === 0) return items;
  const restCount = small.reduce((sum, b) => sum + b.count, 0);
  return [...big, { name: `Other (${small.length} below 1%)`, count: restCount }];
}

function renderPieChart(containerEl, rawItems, totalSuffix) {
  if (!rawItems.length) {
    containerEl.innerHTML = `<div class="empty-state">No data yet.</div>`;
    return;
  }
  const items = groupSmallSlices(rawItems);

  const total = items.reduce((sum, b) => sum + b.count, 0);
  const r = 90;
  const cx = r;
  const cy = r;
  let angle = -Math.PI / 2;

  const slices = items
    .map((b, i) => {
      const fraction = b.count / total;
      const startAngle = angle;
      const endAngle = angle + fraction * Math.PI * 2;
      angle = endAngle;
      const color = PIE_COLORS[i % PIE_COLORS.length];
      return `<path d="${pieSlicePath(cx, cy, r, startAngle, endAngle)}" fill="${color}" stroke="${"var(--bg)"}" stroke-width="1.5"><title>${b.name}: ${b.count} (${(fraction * 100).toFixed(1)}%)</title></path>`;
    })
    .join("");

  const legend = items
    .map(
      (b, i) => `
      <div class="legend-row">
        <span class="legend-swatch" style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></span>
        <span class="legend-name">${b.name}</span>
        <span class="legend-count">${b.count} <span class="legend-pct">(${((b.count / total) * 100).toFixed(1)}%)</span></span>
      </div>`
    )
    .join("");

  containerEl.innerHTML = `
    <div class="pie-wrap">
      <svg viewBox="0 0 ${r * 2} ${r * 2}" width="220" height="220">${slices}</svg>
      <div class="legend-list">${legend}</div>
    </div>
    <p class="explore-hint">${total} ${totalSuffix}</p>
  `;
}

function renderBuilderStats(builders) {
  renderPieChart(
    builderResultsEl,
    builders.map((b) => ({ name: b.builder, count: b.count })),
    "blocks total."
  );
}

function renderRelayStats(relays) {
  renderPieChart(
    relayResultsEl,
    relays.map((r) => ({ name: r.relay, count: r.count })),
    "blocks with a known relay."
  );
}

async function loadBuilderStats() {
  builderResultsEl.innerHTML = `<div class="empty-state">Loading…</div>`;
  relayResultsEl.innerHTML = `<div class="empty-state">Loading…</div>`;
  try {
    const res = await fetch("/api/builder-stats");
    const data = await res.json();
    renderBuilderStats(data.builders || []);
  } catch {
    builderResultsEl.innerHTML = `<div class="empty-state">Failed to load.</div>`;
  }
  try {
    const res = await fetch("/api/relay-stats");
    const data = await res.json();
    renderRelayStats(data.relays || []);
  } catch {
    relayResultsEl.innerHTML = `<div class="empty-state">Failed to load.</div>`;
  }
}

// ---- Mempool tab: single-block order-flow analysis --------------------
// (amendment to E4/E8: the old cross-block aggregate moved out in favor of
// a detailed look at the block currently loaded; /api/mempool-stats still
// exists for programmatic use)

// The private premium: how much more private order flow paid per gas than
// public flow (in %).
function mpPrivatePremiumPct(stat) {
  if (stat.avgTipPublicGwei == null || stat.avgTipPublicGwei <= 0) return null;
  if (stat.avgTipPrivateGwei == null) return null;
  return ((stat.avgTipPrivateGwei - stat.avgTipPublicGwei) / stat.avgTipPublicGwei) * 100;
}

function fmtPct(v) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;
}

// Effective builder payment per gas in gwei for a set of transactions:
// priority fees plus direct coinbase transfers, spread over the gas used.
function mpEffectiveGwei(txs) {
  const gas = txs.reduce((s, tx) => s + (Number(tx.gasUsed) || 0), 0);
  if (gas === 0) return null;
  const paidWei =
    sumPriorityFeeWei(txs) + txs.reduce((s, tx) => s + (tx.coinbaseTransferEth || 0), 0) * 1e18;
  return paidWei / gas / 1e9;
}

const MP_STATUS_META = {
  public: { cls: "public", color: "var(--green)", label: "public" },
  private: { cls: "private", color: "var(--red)", label: "private" },
  caching: { cls: "caching", color: "var(--orange)", label: "caching (watcher warming up)" },
  unknown: { cls: "unknown", color: "var(--muted)", label: "not tracked" },
};

function renderMempoolBlock() {
  if (state.blockNumber == null) {
    mempoolStatsResultsEl.innerHTML = `<div class="empty-state">Load a block to see its order-flow breakdown.</div>`;
    return;
  }

  const txs = state.transactions;
  const byStatus = (status) => txs.filter((tx) => (tx.mempool?.status || "unknown") === status);
  const publicTxs = byStatus("public");
  const privateTxs = byStatus("private");
  const cachingTxs = byStatus("caching");
  const tracked = publicTxs.length + privateTxs.length;

  if (txs.length === 0) {
    mempoolStatsResultsEl.innerHTML = `<div class="empty-state">Block ${state.blockNumber} has no transactions.</div>`;
    return;
  }

  const avgTipPublicGwei = mpEffectiveGwei(publicTxs);
  const avgTipPrivateGwei = mpEffectiveGwei(privateTxs);
  const premiumPct = mpPrivatePremiumPct({ avgTipPublicGwei, avgTipPrivateGwei });
  const fmtGwei = (v) => (v != null ? `${v.toFixed(2)} gwei` : "n/a");

  const cards = [
    { value: `${tracked} of ${txs.length}`, label: `tx with a mempool verdict (#${state.blockNumber})` },
    {
      value: tracked > 0 ? `${((privateTxs.length / tracked) * 100).toFixed(1)}%` : "n/a",
      label: `private share (${privateTxs.length} of ${tracked} tracked)`,
    },
    { value: fmtGwei(avgTipPublicGwei), label: "price per gas — public" },
    { value: fmtGwei(avgTipPrivateGwei), label: "price per gas — private" },
  ];
  if (premiumPct != null) {
    cards.push({
      value: fmtPct(premiumPct),
      label: "private premium vs public",
      cls: premiumPct >= 0 ? "profit" : "loss",
    });
  }

  const summaryHtml = cards
    .map(
      (c) => `
      <div class="mp-summary-card">
        <div class="mp-summary-value ${c.cls || ""}">${c.value}</div>
        <div class="mp-summary-label">${c.label}</div>
      </div>`,
    )
    .join("");

  // one cell per transaction in block order - private bundles cluster
  // visibly (top-of-block MEV, direct-to-builder flow)
  const strip = txs
    .map((tx, i) => {
      const meta = MP_STATUS_META[tx.mempool?.status] || MP_STATUS_META.unknown;
      const mev = tx.mev.length > 0 ? ` · ${tx.mev.map((m) => (MEV_INFO[m.type] || { label: m.type }).label).join(", ")}` : "";
      return `<span class="mp-cell ${meta.cls}${tx.mev.length > 0 ? " has-mev" : ""}" title="#${i} ${shortHash(tx.hash)} — ${meta.label}${mev}"></span>`;
    })
    .join("");

  const legendHtml = `
    <div class="mp-chart-legend">
      ${Object.values(MP_STATUS_META)
        .map((m) => `<span><span class="legend-swatch" style="background:${m.color}"></span> ${m.label}</span>`)
        .join("")}
      <span><span class="legend-swatch mp-cell-mev-swatch"></span> detected MEV</span>
    </div>`;

  const cachingNote =
    cachingTxs.length > 0
      ? `<div class="explore-hint">${cachingTxs.length} transaction${cachingTxs.length === 1 ? "" : "s"} still counted as "caching" — the watcher started less than 2 minutes before this block, so their absence from the mempool proves nothing yet.</div>`
      : "";

  mempoolStatsResultsEl.innerHTML = `
    <div class="mp-summary">${summaryHtml}</div>
    <div class="mp-chart-title">Order flow in block position order (hover a cell for the transaction)</div>
    <div class="mp-strip">${strip}</div>
    ${legendHtml}
    ${cachingNote}
  `;
}

const loadedTabs = new Set();
document.querySelectorAll(".explore-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".explore-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".explore-panel").forEach((p) => p.classList.add("hidden"));
    tab.classList.add("active");
    document.getElementById(`panel-${tab.dataset.tab}`).classList.remove("hidden");

    // the mempool tab reflects the currently loaded block, so re-render on
    // every visit; the multi-block tabs load once per session
    if (tab.dataset.tab === "mempool") {
      renderMempoolBlock();
      return;
    }
    if (!loadedTabs.has(tab.dataset.tab)) {
      loadedTabs.add(tab.dataset.tab);
      if (tab.dataset.tab === "leaderboard") loadLeaderboard();
      if (tab.dataset.tab === "heatmap") loadHeatmap();
      if (tab.dataset.tab === "builders") loadBuilderStats();
    }
  });
});

addressSearchBtn.addEventListener("click", searchAddress);
addressInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchAddress();
});

function applyTheme(theme) {
  if (theme === "light") {
    document.documentElement.dataset.theme = "light";
  } else {
    delete document.documentElement.dataset.theme;
  }
  themeToggle.title = theme === "light" ? "Switch to dark mode" : "Switch to light mode";
  themeToggle.classList.toggle("active", theme === "light");
}

themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  localStorage.setItem("theme", next);
  applyTheme(next);
});

applyTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");

buildLegend();
pollRpcStatus();
liveTimer = setInterval(pollRpcStatus, 12000);

// resume progress display if a backfill is already running (E6 queue state
// lives in the API; coverage lives in Postgres - both survive reloads)
fetch("/api/backfill")
  .then((res) => res.json())
  .then((status) => {
    if (status.running) pollBackfill();
  })
  .catch(() => {});

// ?block=N deep links (e.g. from the trace view's "inspect this block" hint);
// with the number input gone this is also the precise-navigation fallback,
// so a deep link must not be yanked away by follow-latest
const initialBlockParam = Number(new URLSearchParams(window.location.search).get("block"));
if (Number.isInteger(initialBlockParam) && initialBlockParam > 0) {
  setLive(false);
  loadBlock(initialBlockParam);
} else {
  fetchLatestBlockNumber()
    .then((latest) => loadBlock(latest))
    .catch(() => showToast("Could not reach the RPC node.", "error"));
}
