const themeToggle = document.getElementById("themeToggle");
const modeToggle = document.getElementById("modeToggle");
const searchInput = document.getElementById("searchInput");
const searchGoBtn = document.getElementById("searchGoBtn");
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
const pricePerGasEl = document.getElementById("pricePerGas");
const timelineEl = document.getElementById("timeline");
const timelineTrackEl = document.getElementById("timelineTrack");
const timelineGraphEl = document.getElementById("timelineGraph");
const timelineIntervalEl = document.getElementById("timelineInterval");
const timelineLegendEl = document.getElementById("timelineLegend");
const timelineYAxisEl = document.getElementById("timelineYAxis");
const timelineStartEl = document.getElementById("timelineStart");
const timelineEndEl = document.getElementById("timelineEnd");
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
  // value timeline (X9)
  timelineHead: null, // newest block the timeline window ends at (head)
  intervalEnd: null, // right edge of the 100-block interval slider
  coverage: [], // analyzed ranges within the current interval [{start, end}]
  intervalActivity: new Map(), // blockNumber -> total MEV count (interval)
  tickerMode: "history", // "history" (follow-latest) | "interval"
  valueSeries: [], // per-bucket extracted value [{bucket, arbitrageEth, …}]
  valueBucketSize: 1, // blocks per value-series bucket
  valueMax: 0, // max ETH across all series (graph scale)
  mode: "block", // "block" | "address" — header search mode (X8)
  view: "block", // "block" | "address" — what the #result table currently shows
  addressTransactions: [], // synthetic tx rows for an address search result
  addressQuery: null, // the address currently shown in the result table
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

// Always the token's own units + symbol, ignoring the EUR toggle. Used for
// value flows that are intrinsically token→token (swap legs): pricing both
// sides in € erases which tokens moved and makes an exchange look like a loss.
function fmtTokenAmount(amount) {
  if (!amount) return "";
  return `${fmtNumber(amount.value)} ${amount.symbol}`;
}

// True when `amount` is currently being shown as a CoinGecko-converted € figure
// (EUR toggle on and the token has a feed price) — i.e. the number is external-
// feed-derived, not native/on-chain, and should be labeled as such.
function isEurConverted(amount) {
  return !!(
    state.showEur &&
    amount &&
    amount.tokenAddress &&
    state.eurPrices[amount.tokenAddress.toLowerCase()] != null
  );
}

// Provenance tag for CoinGecko-feed-derived figures (the EUR conversions),
// styled like ADR-014's pricing badges so "how the price was derived" is
// visible wherever a € value is shown, not just for arbitrage.
const FEED_TITLE =
  "Converted at the current CoinGecko price — an external feed, approximate and not block-exact";
function feedTag() {
  return `<span class="price-method price-method-feed" title="${FEED_TITLE}">feed</span>`;
}

// The approximate € value routed through a swap (its notional size), from
// whichever leg the feed can price. Only meaningful in EUR mode; null otherwise
// or when neither token is priceable.
function swapEurNotional(s) {
  if (!state.showEur) return null;
  for (const leg of [s.tokenIn, s.tokenOut]) {
    if (leg && leg.tokenAddress) {
      const price = state.eurPrices[leg.tokenAddress.toLowerCase()];
      if (price != null) return leg.value * price;
    }
  }
  return null;
}

// X4: the unit label shown for native-currency figures. In Ethereum (ETH)
// mode we display "Ξ" (Greek capital Xi, the ETH symbol); the EUR toggle
// overrides it. Value math is unchanged — this is purely the label.
function ethUnit() {
  return state.showEur ? "EUR" : "Ξ";
}

// The WETH→EUR rate we price everything else against; null until CoinGecko has
// answered (also the divisor that turns an EUR figure back into ETH/"xhi").
function wethEurPrice() {
  return state.eurPrices[WETH_ADDRESS] ?? null;
}

// Convert an ETH-denominated value into the currently displayed unit, returning
// value AND unit together so the two can never disagree. EUR is only claimed
// when the WETH price is actually known — otherwise we fall back to "Ξ" (ETH),
// fixing the mismatch where the label said EUR but the number was still ETH.
function displayValue(ethValue) {
  if (state.showEur) {
    const price = wethEurPrice();
    if (price != null) return { value: ethValue * price, unit: "EUR" };
  }
  return { value: ethValue, unit: "Ξ" };
}

// An ETH-denominated value rendered through the EUR/ETH toggle with its unit
// label attached (ADR-014 aggregate arbitrage value + per-token breakdown).
function fmtEthValue(ethValue) {
  if (ethValue == null) return "–";
  const dv = displayValue(ethValue);
  return `${fmtNumber(dv.value)} ${dv.unit === "EUR" ? "€" : "Ξ"}`;
}

// ADR-014 §2: how a token's ETH price was obtained, shown as a badge so the
// figure's provenance is distinguishable.
const PRICE_METHOD_TITLE = {
  onchain: "Priced from this block's own swap rates, chained to WETH (block-exact)",
  feed: "Priced from the CoinGecko feed (no in-block path to WETH)",
  unpriced: "No price available — this token's delta is excluded from the total",
};

// The per-token net delta table for an arbitrage: what the searcher actually
// netted across every token, each priced into the display unit, with a badge
// naming the pricing method (ADR-014 §4).
function arbBreakdown(m) {
  const rows = (m.pricedBreakdown || []).map((item) => {
    const sign = item.delta >= 0 ? "+" : "";
    const value = item.method === "unpriced" ? "—" : fmtEthValue(item.ethValue);
    const sym = item.symbol || `${item.token.slice(0, 6)}…`;
    return `<div class="arb-delta-row">
      <span class="arb-delta-token ${item.delta >= 0 ? "profit" : "loss"}">${sign}${fmtNumber(item.delta)} ${sym}</span>
      <span class="arb-delta-value">${value}</span>
      <span class="price-method price-method-${item.method}" title="${PRICE_METHOD_TITLE[item.method]}">${item.method}</span>
    </div>`;
  });
  return `<div class="arb-breakdown">${rows.join("")}</div>`;
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

// ---- Value timeline (X9, ADR-011 §2) --------------------------------------
// A value-over-time line graph spanning [INSPECT_FLOOR_BLOCK … head]: three
// color-coded series (arbitrage / sandwich / liquidation) plot the ETH value
// extracted per block bucket. The analysis slider + backfill button are gone
// (coverage is driven by the continuous fixed-range worker, X10); only the
// 100-block interval slider remains, scoping the ticker strip and focusing the
// interval's highest-value block.

const INSPECT_FLOOR_BLOCK = 11_000_000;
const INTERVAL_SIZE = 100;
const VALUE_POLL_MS = 30_000;

// Colors mirror the Wiki's MEV-type code so the timeline reads the same as the
// legend: arbitrage = green, sandwich = yellow, liquidation = blue.
const VALUE_SERIES = [
  { key: "arbitrage", label: "Arbitrage", color: "var(--green, #7fae7f)" },
  { key: "sandwich", label: "Sandwich", color: "var(--yellow, #c4b46a)" },
  { key: "liquidation", label: "Liquidation", color: "var(--blue, #7aa3c4)" },
];

function timelineWindow() {
  return { start: INSPECT_FLOOR_BLOCK, end: state.timelineHead };
}

function blockToFrac(block) {
  const { start, end } = timelineWindow();
  return Math.min(1, Math.max(0, (block - start) / Math.max(1, end - start)));
}

function fracToBlock(frac) {
  const { start, end } = timelineWindow();
  return Math.round(start + Math.min(1, Math.max(0, frac)) * (end - start));
}

// Fetch the whole-corpus value series once per head advance (buckets are cheap
// server-side aggregates; the series is mostly zero until coverage fills in).
async function refreshValueSeries() {
  if (state.timelineHead == null) return;
  const { start, end } = timelineWindow();
  try {
    const res = await fetch(`/api/mev-value?from=${start}&to=${end}`);
    const data = await res.json();
    state.valueSeries = data.buckets || [];
    state.valueBucketSize = data.bucketSize || 1;
    state.valueMax = state.valueSeries.reduce(
      (m, b) => Math.max(m, b.arbitrageEth, b.sandwichEth, b.liquidationEth),
      0,
    );
    renderTimeline();
  } catch {
    /* the graph is cosmetic — never break the page over it */
  }
}

const GRAPH_W = 1000;
const GRAPH_H = 120;

function drawValueGraph() {
  const buckets = state.valueSeries;
  const max = state.valueMax || 0;
  const size = state.valueBucketSize || 1;
  const half = size / 2;
  // Log scale: extracted value spans several orders of magnitude across buckets,
  // so a linear axis flattens everything but the peaks. log1p keeps zero-value
  // buckets pinned to the baseline (log1p(0) === 0) without a special case.
  const logMax = Math.log1p(max);
  const yFor = (v) =>
    logMax > 0 ? GRAPH_H - 4 - (Math.log1p(Math.max(0, v)) / logMax) * (GRAPH_H - 12) : GRAPH_H - 4;
  const xFor = (bucket) => (blockToFrac(bucket + half) * GRAPH_W).toFixed(1);

  // The server only returns buckets that contain inspected blocks, so any jump
  // larger than one bucket is an un-inspected gap: break the line there instead
  // of drawing a segment across blocks we never looked at. Contiguous runs
  // become separate polylines; a lone inspected bucket gets a dot so it shows.
  const polylines = VALUE_SERIES.map((s) => {
    const segments = [];
    let run = [];
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (i > 0 && b.bucket - buckets[i - 1].bucket !== size) {
        if (run.length) segments.push(run);
        run = [];
      }
      run.push(`${xFor(b.bucket)},${yFor(b[`${s.key}Eth`]).toFixed(1)}`);
    }
    if (run.length) segments.push(run);
    return segments
      .map((pts) =>
        pts.length === 1
          ? `<circle cx="${pts[0].split(",")[0]}" cy="${pts[0].split(",")[1]}" r="1.6" fill="${s.color}" vector-effect="non-scaling-stroke" />`
          : `<polyline points="${pts.join(" ")}" fill="none" stroke="${s.color}" stroke-width="1.6" vector-effect="non-scaling-stroke" />`,
      )
      .join("");
  }).join("");

  timelineGraphEl.innerHTML = `<line x1="0" y1="${GRAPH_H - 4}" x2="${GRAPH_W}" y2="${GRAPH_H - 4}" stroke="var(--border)" stroke-width="1" vector-effect="non-scaling-stroke"/>${polylines}`;

  // Unit and peak come from one source so they always agree (fixes the
  // EUR-label-with-xhi-value mismatch). The peak now annotates the y-axis
  // (top of the graph) rather than being printed under the timeline.
  const { value: peak, unit } = displayValue(max);
  if (timelineYAxisEl) {
    timelineYAxisEl.innerHTML =
      max > 0
        ? `<span class="tl-yaxis-peak">${fmtNumber(peak)} ${unit}</span><span class="tl-yaxis-zero">0</span>`
        : "";
  }

  timelineLegendEl.innerHTML =
    VALUE_SERIES.map(
      (s) =>
        `<span class="tl-legend-item"><span class="legend-swatch" style="background:${s.color}"></span>${s.label}</span>`,
    ).join("") + `<span class="tl-legend-unit">value extracted (${unit}, log scale)</span>`;
}

function renderTimeline() {
  if (state.timelineHead == null) return;
  timelineEl.classList.remove("hidden");
  const { start, end } = timelineWindow();
  timelineStartEl.textContent = `#${start}`;
  timelineEndEl.textContent = `#${end} (head)`;

  const intervalStartFrac = blockToFrac(state.intervalEnd - INTERVAL_SIZE + 1);
  const intervalEndFrac = blockToFrac(state.intervalEnd);
  timelineIntervalEl.style.left = `${intervalStartFrac * 100}%`;
  timelineIntervalEl.style.width = `${Math.max(0.5, (intervalEndFrac - intervalStartFrac) * 100)}%`;

  drawValueGraph();
}

// Coverage for the current 100-block interval only (not the 15M-block corpus),
// so the ticker can mark analyzed blocks.
async function refreshIntervalCoverage(from, to) {
  try {
    const res = await fetch(`/api/analyzed-ranges?from=${from}&to=${to}`);
    const data = await res.json();
    state.coverage = data.ranges || [];
  } catch {
    state.coverage = [];
  }
}

function trackFrac(clientX) {
  const rect = timelineTrackEl.getBoundingClientRect();
  return (clientX - rect.left) / rect.width;
}

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
  await refreshIntervalCoverage(from, to);
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
    <div class="legend-section-title">How arbitrage value is priced</div>
    <p class="legend-intro">An arbitrage rarely nets a single token. We value it by the
      <strong>net delta across every token it moved</strong> — the exact route swaps, credited minus
      debited — not just the one "profit token" the detector records. Each token's delta is priced into
      ETH (the EUR/Ξ toggle then converts the total), and the method is shown as a badge so you can tell
      how each figure was derived:</p>
    <div class="legend-item">
      <span class="badge price-method-onchain">onchain</span>
      <p><strong>Block-exact.</strong> Priced from this same block's own swap rates, chained through to
        WETH. No external data, historically faithful — the default whenever the token trades against a
        WETH-reachable pool in the block.</p>
    </div>
    <div class="legend-item">
      <span class="badge price-method-feed">feed</span>
      <p><strong>External fallback.</strong> When a token has no in-block path to WETH, its price comes
        from the CoinGecko feed (token/EUR ÷ WETH/EUR). Approximate and not block-exact.</p>
    </div>
    <div class="legend-item">
      <span class="badge price-method-unpriced">unpriced</span>
      <p><strong>Excluded.</strong> Neither source yields a price; that token's delta is flagged and left
        out of the total rather than silently counted as zero.</p>
    </div>
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

  const money = ethUnit();
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

  renderPricePerGas(transactions);
}

// Effective price paid per gas by public vs private order flow, plus the
// private premium — moved here from Transaction Visibility so all the
// price/gas figures live together on the Transaction Prices tab.
function renderPricePerGas(transactions) {
  if (!pricePerGasEl) return;
  const publicTxs = transactions.filter((tx) => tx.mempool?.status === "public");
  const privateTxs = transactions.filter((tx) => tx.mempool?.status === "private");
  const avgTipPublicGwei = mpEffectiveGwei(publicTxs);
  const avgTipPrivateGwei = mpEffectiveGwei(privateTxs);
  const premiumPct = mpPrivatePremiumPct({ avgTipPublicGwei, avgTipPrivateGwei });
  const fmtGwei = (v) => (v != null ? `${v.toFixed(2)} gwei` : "n/a");

  const cards = [
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

  pricePerGasEl.innerHTML = cards
    .map(
      (c) => `
      <div class="ppg-card">
        <div class="ppg-value ${c.cls || ""}">${c.value}</div>
        <div class="ppg-label">${c.label}</div>
      </div>`,
    )
    .join("");
}

function renderMevDetail(m) {
  const info = MEV_INFO[m.type] || { label: m.type, explain: "" };
  const rows = [];

  switch (m.type) {
    case "arbitrage":
      rows.push(kv("Account", addrLink(m.accountAddress)));
      if (m.profit) rows.push(kv("Profit", profitSpan(m.profit)));
      // ADR-014: the aggregate value across ALL tokens the arb netted, priced
      // into ETH — the single "Profit" above is only the detector's cyclic
      // token, which under-counts multi-token arbs.
      if (m.ethValue != null)
        rows.push(
          kv(
            '<span title="Net value across every token the arbitrage moved, each priced into ETH (ADR-014). \'Profit\' above is only the detector\'s single cyclic token.">Aggregate value (all tokens)</span>',
            `<span class="${m.ethValue < 0 ? "loss" : "profit"}">${fmtEthValue(m.ethValue)}</span>`,
          ),
        );
      if (m.pricedBreakdown?.length) rows.push(kv("Token deltas", arbBreakdown(m)));
      if (m.unpricedTokens?.length)
        rows.push(
          kv(
            "Unpriced",
            `<span class="loss" title="Tokens with a net delta but no on-chain or feed price; excluded from the aggregate">${m.unpricedTokens.length} token(s) excluded</span>`,
          ),
        );
      // X6: the value the arbitrage removed from the mispriced pools — borne by
      // their LPs and the swap(s) that created the imbalance. For an atomic
      // arbitrage this equals the realized profit.
      if (m.victimLoss)
        rows.push(
          kv(
            '<span title="Value extracted from the mispriced pools / LPs (equals the arbitrageur\'s profit for an atomic arbitrage)">Cost to pools (victim loss)</span>',
            `<span class="loss">${fmtAmount(m.victimLoss)}</span>`,
          ),
        );
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
function traceLink(hash, legCount, incidentId) {
  const port = (window.__ENV && window.__ENV.discoWebPort) || 8082;
  const url = `http://${window.location.hostname}:${port}/ui/trace/${hash}`;
  const label = legCount > 1 ? `trace (${legCount} tx)` : "trace";
  const title =
    legCount > 1
      ? `Open all ${legCount} transactions of this incident as one DiscoUI workspace`
      : "Open the execution trace in DiscoUI";
  // data-incident lets hovering this button light up the sibling legs' incident
  // markers so you can see which transactions belong together (sandwiches etc).
  const incidentAttr = incidentId ? ` data-incident="${incidentId}"` : "";
  return `<a class="trace-link"${incidentAttr} href="${url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="${title}">${label}</a>`;
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
  const tag = isEurConverted(amount) ? ` ${feedTag()}` : "";
  return `<span class="${isLoss ? "loss" : "profit"}">${fmtAmount(amount)}</span>${tag}`;
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
      // A swap is a token→token exchange — show the token amounts (with symbols)
      // regardless of the EUR toggle. Pricing BOTH legs in € erased which tokens
      // moved and made every trade look like a loss (86 € → 82 €). In EUR mode we
      // instead append ONE feed-labeled "≈ N €" notional: the value routed through
      // the swap, not a per-leg re-pricing.
      const inStr = s.tokenIn ? fmtTokenAmount(s.tokenIn) : "?";
      const outStr = s.tokenOut ? fmtTokenAmount(s.tokenOut) : "?";
      const notional = swapEurNotional(s);
      const note =
        notional != null
          ? ` <span class="swap-notional" title="${FEED_TITLE}">≈ ${fmtNumber(notional)} €</span>`
          : "";
      return `<span class="swap-chip">${s.protocol || "swap"}: ${inStr} <span class="arrow">→</span> ${outStr}${note}</span>`;
    })
    .join("");
}

// Net token-balance change the actor realized in this transaction, in ETH, at
// current CoinGecko prices — the true P/L even across multiple tokens and when
// the extractor ends the block shifted long one asset and short another. Built
// from the tx's own swaps (tokenOut credited, tokenIn debited), each leg priced
// via the WETH-relative EUR rates. Returns null when any involved token has no
// price (so we never show a P/L that silently omits a leg) or the tx has no
// swaps (e.g. address-view synthetic rows, liquidations) — callers fall back to
// the single-token figure.
function txPnlEth(tx) {
  if (!tx.swaps || tx.swaps.length === 0) return null;
  const weth = wethEurPrice();
  if (weth == null || weth === 0) return null;

  const deltaEur = new Map(); // tokenAddress -> value moved (EUR), signed
  const add = (amount, sign) => {
    if (!amount || !amount.tokenAddress) return false;
    const price = state.eurPrices[amount.tokenAddress.toLowerCase()];
    if (price == null) return false;
    const key = amount.tokenAddress.toLowerCase();
    deltaEur.set(key, (deltaEur.get(key) || 0) + sign * amount.value * price);
    return true;
  };

  for (const s of tx.swaps) {
    if (!add(s.tokenOut, 1)) return null;
    if (!add(s.tokenIn, -1)) return null;
  }
  let eur = 0;
  for (const v of deltaEur.values()) eur += v;
  return eur / weth; // back into ETH so the EUR toggle re-prices consistently
}

// Format a P/L (given in ETH) into the active display unit, signed & colored.
function fmtPnl(ethValue) {
  const { value, unit } = displayValue(ethValue);
  const sign = value >= 0 ? "+" : "";
  const num = unit === "EUR" ? value.toFixed(2) : value.toFixed(4);
  return `${sign}${num} ${unit}`;
}

function mevBadgesHtml(tx) {
  if (!tx.mev.length) return `<span class="badge none">no attacks detected</span>`;

  const badges = tx.mev
    .map((m) => {
      const info = MEV_INFO[m.type] || { label: m.type, short: "" };
      return `<span class="badge ${m.type}" title="${info.short}">${info.label}</span>`;
    })
    .join("");

  // Total P/L across all tokens (X-amend): replaces the per-badge single-token
  // amount when we can price every leg.
  const pnl = txPnlEth(tx);
  if (pnl != null) {
    return `${badges} <span class="pnl ${pnl < 0 ? "loss" : "profit"}" title="Net profit/loss across every token this transaction moved, at current CoinGecko prices">${fmtPnl(pnl)}</span>`;
  }

  // fallback: the detector's single-token profit/received figure
  const amounts = tx.mev
    .map((m) => {
      const amount = m.profit || m.received;
      return amount
        ? ` <span class="${amount.value < 0 ? "loss" : "profit"}">${fmtAmount(amount)}</span>`
        : "";
    })
    .join("");
  return `${badges}${amounts}`;
}

// Shared transaction-table renderer used by both the block view and the address
// search result, so an address's transactions show in the same space and format
// as a block's. `showBlock` prepends a Block column (address results span
// blocks); block-scoped cells (from/to/gas/mempool) fall back to "–" for the
// synthetic address rows that don't carry them.
function renderResultTable(txs, { showBlock = false, emptyMsg, rerender } = {}) {
  if (txs.length === 0) {
    resultEl.innerHTML = `<div class="empty-state">${emptyMsg || "No transactions match the current filter."}</div>`;
    return;
  }

  const colspan = showBlock ? 9 : 8;

  // one trace link per incident: the first rendered leg carries it
  const incidentLinkCarrier = new Map();
  for (const tx of txs) {
    const legs = incidentLegs(tx);
    if (legs.length > 1 && !incidentLinkCarrier.has(legs[0])) {
      incidentLinkCarrier.set(legs[0], tx.hash);
    }
  }

  const rows = txs
    .map((tx) => {
      const legs = incidentLegs(tx);
      const incidentId = legs.length > 1 ? legs[0] : null;
      const traceLinkHtml =
        legs.length === 1
          ? traceLink(tx.hash)
          : incidentLinkCarrier.get(legs[0]) === tx.hash
            ? traceLink(legs[0], legs.length, incidentId)
            : `<span class="trace-link-ref" data-incident="${incidentId}" title="Part of a multi-transaction incident - the trace link on its first transaction opens all ${legs.length} legs together">↳ incident</span>`;

      const isExpanded = state.expanded.has(tx.hash);
      const hasDetail = tx.mev.length > 0 || tx.swaps.length > 0;

      const detailHtml = hasDetail
        ? `
          <tr class="detail-row ${isExpanded ? "" : "hidden"}" data-detail-for="${tx.hash}">
            <td colspan="${colspan}">
              ${tx.mev.map(renderMevDetail).join("")}
              ${
                tx.swaps.length
                  ? `<div class="detail-block"><h4>DEX swaps in this transaction (${tx.swaps.length})</h4>${renderSwapChips(tx.swaps)}</div>`
                  : ""
              }
            </td>
          </tr>`
        : "";

      const blockCell = showBlock
        ? `<td class="mono"><a class="block-link" data-block="${tx.blockNumber}" title="Load block ${tx.blockNumber}">#${tx.blockNumber}</a></td>`
        : "";

      return `
        <tr class="${tx.mev.length ? "has-mev" : ""} ${isExpanded ? "expanded" : ""}" data-tx="${tx.hash}" data-has-detail="${hasDetail}"${incidentId ? ` data-incident="${incidentId}"` : ""}>
          ${blockCell}
          <td class="mono">${hasDetail ? '<span class="expand-arrow">▶</span>' : ""}<a class="addr" href="https://etherscan.io/tx/${tx.hash}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${shortHash(tx.hash)}</a> ${traceLinkHtml}</td>
          <td class="mono">${addrLink(tx.from)}</td>
          <td class="mono">${addrLink(tx.to)}</td>
          <td class="mono">${tx.gasUsed ?? "–"}</td>
          <td class="mono">${tx.gasPriceGwei ? tx.gasPriceGwei.toFixed(2) : "–"}</td>
          <td class="mono">${tx.coinbaseTransferEth ? fmtEth(tx.coinbaseTransferEth, 5) : "0"}</td>
          <td>${renderMempoolBadge(tx.mempool)}</td>
          <td>${mevBadgesHtml(tx)}</td>
        </tr>
        ${detailHtml}
      `;
    })
    .join("");

  resultEl.innerHTML = `
    <table>
      <thead>
        <tr>
          ${showBlock ? "<th>Block</th>" : ""}
          <th>Tx Hash</th>
          <th>From</th>
          <th>To</th>
          <th>Gas Used</th>
          <th>Gas Price (gwei)</th>
          <th>Builder Tip (${ethUnit()})</th>
          <th>Mempool</th>
          <th>Detected MEV</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  resultEl.querySelectorAll("a.block-link").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      loadBlock(Number(el.dataset.block));
    });
  });

  // Hovering the trace button (or an "↳ incident" marker) lights up every
  // transaction of the same incident — the sandwich legs, the two arbitrage
  // legs, etc — so you can see at a glance which rows belong together.
  const setIncidentHighlight = (id, on) => {
    resultEl
      .querySelectorAll(`[data-incident="${id}"]`)
      .forEach((n) => n.classList.toggle("incident-hi", on));
  };
  resultEl.querySelectorAll("[data-incident]").forEach((el) => {
    const id = el.dataset.incident;
    if (!id || id === "null") return;
    el.addEventListener("mouseenter", () => setIncidentHighlight(id, true));
    el.addEventListener("mouseleave", () => setIncidentHighlight(id, false));
  });

  resultEl.querySelectorAll("tr[data-tx]").forEach((row) => {
    if (row.dataset.hasDetail !== "true") return;
    row.addEventListener("click", () => {
      const hash = row.dataset.tx;
      if (state.expanded.has(hash)) state.expanded.delete(hash);
      else state.expanded.add(hash);
      (rerender || renderTable)();
    });
  });
}

function renderTable() {
  const visible = state.onlyMev
    ? state.transactions.filter((t) => t.mev.length > 0)
    : state.transactions;
  renderResultTable(visible, { showBlock: false });
}

// Dispatcher: the #result table is shared between the block view and the
// address-search view, so re-renders (currency/filter toggles, expand) must
// target whichever is active.
function rerenderResult() {
  if (state.view === "address") renderAddressTable();
  else renderTable();
}

async function loadBlock(blockNumber, { silent = false } = {}) {
  if (!silent) setLoading(true, `Inspecting block ${blockNumber}…`);
  state.view = "block";

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
    // X5: the standalone #block-number caption is gone; reflect the loaded
    // block in the header search box when it's in block mode (X8) and unfocused.
    if (state.mode === "block" && document.activeElement !== searchInput) {
      searchInput.value = String(data.blockNumber);
    }
    // X1: remember the last viewed block so a reload restores it (instead of
    // jumping to the head) unless follow-latest is on.
    try {
      localStorage.setItem("lastBlock", String(data.blockNumber));
    } catch {
      /* private mode / storage disabled — non-fatal */
    }

    pushHistory(data.blockNumber, data.transactions, data.builder, data.bid);

    renderStats(state.transactions);
    renderIncomeChart(state.transactions, state.bid);
    renderMempoolBlock();
    renderTable();
    renderTicker();
    renderTimeline();

    // Prices power both the EUR display and the per-tx P/L annotation, so we
    // now fetch them for every block (not just in EUR mode). Do it after the
    // first render so the table isn't blocked on CoinGecko, then re-render the
    // P/L-bearing views once prices land.
    refreshEurPrices().then(() => {
      renderStats(state.transactions);
      renderIncomeChart(state.transactions, state.bid);
      rerenderResult();
      renderTimeline();
    });

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

    // timeline window ends at the head; the interval slider pins right in
    // follow-latest mode (X9 — the analysis slider is gone)
    const firstHead = state.timelineHead == null;
    state.timelineHead = latest;
    if (firstHead || state.live) {
      state.intervalEnd = latest;
    }
    renderTimeline();
    if (firstHead) refreshValueSeries();

    if (state.live && latest !== state.blockNumber) {
      loadBlock(latest, { silent: true });
    }
  } catch {
    rpcDot.className = "dot offline";
    rpcText.textContent = "RPC unreachable";
  }
}

// X8: unified header search with a Block/Address mode toggle. In block mode the
// box loads a block above (replacing the removed #block-number field, X5); in
// address mode it runs the same lookup as the Address-lookup tab and reveals
// it, so one search box drives both. The dedicated tab input still works too.
function updateSearchMode() {
  const isAddress = state.mode === "address";
  modeToggle.textContent = isAddress ? "Address" : "Block";
  modeToggle.dataset.mode = state.mode;
  searchInput.placeholder = isAddress ? "0x… address" : "Block number…";
  searchInput.value =
    !isAddress && state.blockNumber != null ? String(state.blockNumber) : "";
}

function runHeaderSearch() {
  const query = searchInput.value.trim();
  if (!query) return;
  if (state.mode === "block") {
    const block = Number(query);
    if (!Number.isInteger(block) || block < 0) {
      showToast("Enter a valid block number.", "error");
      return;
    }
    setLive(false);
    loadBlock(block);
  } else {
    if (!/^0x[a-fA-F0-9]{40}$/.test(query)) {
      showToast("Enter a valid 0x… address.", "error");
      return;
    }
    // the address lookup no longer lives in a bottom-bar panel — its
    // transactions render in the main result table, same space and format as a
    // block's transactions
    setLive(false);
    searchAddress(query);
  }
}

modeToggle.addEventListener("click", () => {
  state.mode = state.mode === "block" ? "address" : "block";
  updateSearchMode();
  searchInput.focus();
});
searchGoBtn.addEventListener("click", runHeaderSearch);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runHeaderSearch();
});

// follow-latest is an icon box-toggle in the top bar (same pattern as the
// MEV-only/EUR/theme toggles); re-enabling pins the interval slider right and
// restores the recently-viewed ticker (E7/X9)
function setLive(on) {
  state.live = on;
  liveToggleBtn.classList.toggle("active", on);
  // X1: persist follow-latest so a reload restores where you were — head if you
  // were following, otherwise the last block you viewed.
  try {
    localStorage.setItem("live", on ? "1" : "0");
  } catch {
    /* private mode / storage disabled — non-fatal */
  }
  if (on) {
    state.tickerMode = "history";
    if (state.timelineHead != null) {
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
  rerenderResult();
});

function collectTokenAddresses() {
  const addresses = new Set([WETH_ADDRESS]);
  const source =
    state.view === "address" ? state.addressTransactions : state.transactions;
  for (const tx of source) {
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
  // Fetched for every block now (not just in EUR mode): the P/L annotation
  // needs CoinGecko prices even when displaying "xhi". Merge rather than
  // replace so previously-priced tokens survive a partial/failed refresh.
  try {
    const res = await fetch(`/api/eur-prices?tokens=${collectTokenAddresses().join(",")}`);
    const data = await res.json();
    state.eurPrices = { ...state.eurPrices, ...(data.prices || {}) };
  } catch {
    /* keep whatever prices we already have */
  }
}

function rerenderAfterCurrencyChange() {
  renderStats(state.transactions);
  if (state.blockNumber != null) renderIncomeChart(state.transactions, state.bid);
  rerenderResult();
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

// Map one address-activity item (per MEV action, cross-block) onto the same
// `mev[]` entry shape the block-transaction table renders, so an address's
// transactions show in the same format. The searched address plays the actor
// role (arbitrageur / sandwicher / liquidator / trader).
function activityItemToMev(item, address) {
  switch (item.type) {
    case "arbitrage":
      return {
        type: "arbitrage",
        accountAddress: address,
        profit: item.profit,
        protocols: item.protocols || [],
        error: item.error,
      };
    case "sandwich":
      return { type: "sandwich_frontrun", sandwicherAddress: address, profit: item.profit };
    case "liquidation_performed":
      return {
        type: "liquidation",
        protocol: item.protocol,
        liquidatorUser: address,
        liquidatedUser: null,
        received: item.profit,
      };
    case "liquidation_suffered":
      return {
        type: "liquidation",
        protocol: item.protocol,
        liquidatedUser: address,
        liquidatorUser: null,
      };
    case "nft_trade":
      return {
        type: "nft_trade",
        protocol: item.protocol,
        buyerAddress: item.role === "buyer" ? address : null,
        sellerAddress: item.role === "seller" ? address : null,
        payment: item.payment,
      };
    default:
      return { type: item.type };
  }
}

// Group cross-block activity items into synthetic transaction rows. Block-scoped
// fields the address query can't provide (from/to/gas/mempool) stay null and
// render as "–" — the table is otherwise identical to the block view.
function addressItemsToTransactions(items, address) {
  const byHash = new Map();
  for (const item of items) {
    const hash = item.transactionHash;
    if (!hash) continue;
    let tx = byHash.get(hash);
    if (!tx) {
      tx = {
        hash,
        blockNumber: item.blockNumber,
        from: null,
        to: null,
        gasUsed: null,
        gasPriceGwei: null,
        coinbaseTransferEth: null,
        mempool: null,
        swaps: [],
        mev: [],
      };
      byHash.set(hash, tx);
    }
    tx.mev.push(activityItemToMev(item, address));
  }
  return [...byHash.values()].sort((a, b) => b.blockNumber - a.blockNumber);
}

function renderAddressTable() {
  renderResultTable(state.addressTransactions, {
    showBlock: true,
    rerender: renderAddressTable,
    emptyMsg: `No MEV activity found for ${shortAddr(state.addressQuery)} in any inspected block yet. Only blocks this explorer has actually inspected are searchable.`,
  });
}

async function searchAddress(address) {
  const addr = (address || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    showToast("Enter a valid 0x… address.", "error");
    return;
  }
  state.view = "address";
  state.addressQuery = addr;
  state.expanded.clear();
  setLoading(true, `Searching MEV activity for ${shortAddr(addr)}…`);
  try {
    const res = await fetch(`/api/address/${addr}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Search failed");
    state.addressTransactions = addressItemsToTransactions(data.items, addr);
    await refreshEurPrices();
    renderAddressTable();
    showToast(
      `${state.addressTransactions.length} transaction${state.addressTransactions.length === 1 ? "" : "s"} with MEV for ${shortAddr(addr)}.`,
      "success",
    );
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  } finally {
    setLoading(false);
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

  // price-per-gas + private premium moved to the Transaction Prices tab
  // (renderPricePerGas); this tab keeps the visibility breakdown.
  const cards = [
    { value: `${tracked} of ${txs.length}`, label: `tx with a mempool verdict (#${state.blockNumber})` },
    {
      value: tracked > 0 ? `${((privateTxs.length / tracked) * 100).toFixed(1)}%` : "n/a",
      label: `private share (${privateTxs.length} of ${tracked} tracked)`,
    },
  ];

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
// Extracted so the header search (X8, address mode) can reveal a tab too.
function activateTab(name) {
  document
    .querySelectorAll(".explore-tab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document
    .querySelectorAll(".explore-panel")
    .forEach((p) => p.classList.toggle("hidden", p.id !== `panel-${name}`));

  // the mempool tab reflects the currently loaded block, so re-render on
  // every visit; the multi-block tabs load once per session
  if (name === "mempool") {
    renderMempoolBlock();
    return;
  }
  // ADR-017 §4: flags change out-of-band (written from DiscoUI), so re-fetch
  // the list on every visit rather than caching it for the session.
  if (name === "flagged") {
    renderFlagged();
    return;
  }
  if (!loadedTabs.has(name)) {
    loadedTabs.add(name);
    if (name === "leaderboard") loadLeaderboard();
    if (name === "heatmap") loadHeatmap();
    if (name === "builders") loadBuilderStats();
  }
}
document.querySelectorAll(".explore-tab").forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
});

// ADR-017 §4: incidents flagged from the DiscoUI trace workspace. Fetched from
// explorer-api's shared store so they persist and reopen the trace workspace.
function escFlag(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
async function renderFlagged() {
  const el = document.getElementById("flaggedResults");
  if (!el) return;
  el.innerHTML = '<p class="explore-hint">Loading…</p>';
  let flagged;
  try {
    const res = await fetch("/api/flagged");
    if (!res.ok) throw new Error(res.statusText);
    flagged = (await res.json()).flagged;
  } catch (e) {
    el.innerHTML = `<p class="explore-hint">Could not load flagged transactions: ${escFlag(e.message)}</p>`;
    return;
  }
  if (!flagged.length) {
    el.innerHTML =
      '<p class="explore-hint">No flagged transactions yet. Open an incident in DiscoUI and use the Flag button.</p>';
    return;
  }
  el.innerHTML = `<table class="flagged-table"><tbody>${flagged
    .map((f) => {
      const label = escFlag(f.label || "trace");
      const block = f.blockNumber != null ? `block ${f.blockNumber}` : "";
      return `<tr>
        <td>${label}</td>
        <td>${traceLink(f.txHash, 1)}</td>
        <td class="mono"><a class="addr" href="https://etherscan.io/tx/${f.txHash}" target="_blank" rel="noopener">${shortHash(f.txHash)}</a></td>
        <td class="dim">${block}</td>
        <td><button class="flag-remove icon-btn" data-tx="${f.txHash}" title="Remove from Flagged TXs">✕</button></td>
      </tr>`;
    })
    .join("")}</tbody></table>`;
  el.querySelectorAll(".flag-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await fetch(`/api/flagged/${btn.dataset.tx}`, { method: "DELETE" });
      } catch {
        // best-effort; re-render reflects the true server state
      }
      renderFlagged();
    });
  });
}

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
updateSearchMode();
pollRpcStatus();
liveTimer = setInterval(pollRpcStatus, 12000);

// Coverage now fills continuously server-side (X10, ADR-011 §1) — there is no
// per-session backfill queue to resume, so the old /api/backfill poll is gone.

// ?block=N deep links (e.g. from the trace view's "inspect this block" hint);
// with the number input gone this is also the precise-navigation fallback,
// so a deep link must not be yanked away by follow-latest
const initialBlockParam = Number(new URLSearchParams(window.location.search).get("block"));
if (Number.isInteger(initialBlockParam) && initialBlockParam > 0) {
  setLive(false);
  loadBlock(initialBlockParam);
} else {
  // X1: if you weren't following the head last time, restore the block you were
  // on instead of jumping to the head. Following-latest (the default) wins.
  const savedLive = localStorage.getItem("live");
  const lastBlock = Number(localStorage.getItem("lastBlock"));
  if (savedLive === "0" && Number.isInteger(lastBlock) && lastBlock > 0) {
    setLive(false);
    loadBlock(lastBlock);
  } else {
    fetchLatestBlockNumber()
      .then((latest) => loadBlock(latest))
      .catch(() => showToast("Could not reach the RPC node.", "error"));
  }
}
