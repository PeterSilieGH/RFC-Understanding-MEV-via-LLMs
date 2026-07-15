# Work package: MEV Block Explorer — header, stats visualization, background backfill

Prepared 2026-07-15 from user direction (quoted inline). Pure explorer work
(`apps/explorer-web` + `apps/explorer-api`); independent of the trace
workspace track (wp-trace-workspace.md).

## Current-state anchors

- Header: `index.html` `<header>` → `.header-top` (h1 "MEV Block Explorer"
  left, `.header-top-right` with EUR + theme box-toggles), `.subtitle`
  ("[Beta] DSN MEV Detection Bot, powered by AnDerSoN") below.
- "Only show MEV transactions" is a checkbox (`#onlyMevToggle`) in the
  block-nav row.
- Notifications: `#toast`, `position: fixed` top-right (`style.css:233`).
- Stats bar: 8 `.stat-card`s (reordered 2026-07-15; fees/tips/bid are cards
  5–8). Builder identity + fee recipient render in a separate strip below
  the ticker.
- Block selection: number input + Load / Jump to latest / Follow latest;
  `#ticker` shows recently viewed blocks only. Inspection is strictly
  on-demand per viewed block (`inspectBlockIfNeeded`, deduped in-memory).

## Tasks

### E1 — Header rearrangement (S)

> "move '[Beta] DSN MEV Detection Bot, powered by AnDerSoN' into the left of
> the top bar currently containing 'MEV Block Explorer', and move 'MEV Block
> Explorer' into the middle"

`.header-top` becomes a three-zone bar: beta/DSN line left, `<h1>` centered,
existing toggle group right. Drop the standalone `.subtitle` row.

### E2 — MEV-only box-toggle in the top bar (S)

> "Move only show MEV transactions toggle into the top bar, left of the euro
> toggle. use the same box toggle as for euro-ether and light-dark mode. use
> icons and have a discription on hover."

Replace `#onlyMevToggle` checkbox with an icon box-toggle (same `.icon-btn`
pattern as EUR/theme) placed left of the EUR toggle; `title` hover text
("Show only transactions with detected MEV"). State + filtering logic
unchanged.

### E3 — Notifications under the top bar (XS)

> "Make notifications only pop up under the top bar."

`#toast` anchors below the header (fixed, top = header height, right-aligned
or centered under it) instead of the viewport corner. All existing
toast classes/behavior unchanged.

### E4 — Stats bar v2 (S)

> "move watched / private left of total txs and remove watched from the box.
> make the arbs, sandwitch and liquidations tab blue and move them into
> seperate boxes."

- Private-tx card becomes the **first** card (left of Transactions) and
  shows only the private count (watched/tracked stays the internal
  denominator and the "caching" guard-rail behavior is preserved; the label
  communicates tracking state).
- The combined `arbs/sandwiches/liquidations` card splits back into three
  cards, value color **blue** (`--blue`).
- Fees/tips/bid cards are removed from the bar — they move into E5's chart.

### E5 — Stat-visualization column: fees/tips/bid stacked bar chart (M)

> "remove fees, tips and bid from the top bar. instead, put a barchart with
> animated transitions and legend that displays share of private and public
> fees and builder tips stacked on top of each other in one bar and builder
> bid in another. move 'Builder: … Fee recipient: …' into the legend of the
> barchart. color-code reasonably. create a column for this, which we will
> add more stat visualizations to later"

- New layout element: a **visualization column** beside the block view
  (extensible container; this chart is its first tenant).
- One SVG bar chart, two bars:
  - **Block income** (stacked): public priority fees / private priority
    fees / builder tips (public+private tips as two stacked segments if the
    split is meaningful, else one "tips" segment — decide on real data).
  - **Builder bid** (single segment) — same scale, so profit/loss is the
    visible height difference; keep the green/red profitability coloring.
- Animated transitions on block change (CSS transition on rect
  height/y — the SVG persists across renders instead of being rebuilt).
- Legend below the chart: color swatches per segment plus the builder
  identity line ("Builder: Titan (titanbuilder.xyz) · Fee recipient:
  0x…") moved out of the current builder strip.
- EUR/ETH toggle applies to the axis/labels.

### E6 — Backend: background backfill + coverage/summary endpoints (M/L)

> "Have the explorer run in the background from a given adresse." (read:
> from a given block height — the analysis slider's position)

explorer-api gains a background inspection queue:

- `POST /api/backfill {fromBlock}` — walk from `fromBlock` **rightward**
  (ascending to head), inspecting via the existing `inspectBlockIfNeeded`
  dedupe, strictly sequential (concurrency 1) and pausable; "as fast as
  reasonably possible" = one block at a time, skip-on-error with retry
  budget, and back off when the RPC node degrades (reuse the health
  signals; never starve live views).
- `GET /api/backfill` — queue status (running, cursor, target, errors).
- `GET /api/analyzed-ranges?from&to` — compressed list of inspected block
  ranges (query mev-inspect's `blocks` table) to paint the timeline
  white/green.
- `GET /api/mev-activity?from&to` — per-block MEV counts for an interval
  (cheap aggregate over existing tables) to pick the interval's hottest
  block and (later) drive more visualizations.

### E7 — Block timeline: analysis slider + interval slider (L)

> "a slider that is on the very right by default (the newest block) and can
> be drawn to the left to backfill analysis … the line … shall indicated by
> color which blocks have been analyzed so far (white = not analyzed, green
> = analyzed, so the line shall turn green from the analysis slider
> rightwards as blocks get analyzed). have a second slider on that line,
> that selects and interval of 100 blocks, which will be displayed in the
> block selector scrollbar. By default, focus the block with the hightest
> MEV activity from that 100 block interval."

Replaces the plain number-input navigation as the primary selector (input
stays as a precise fallback):

- A horizontal timeline (SVG/canvas) spanning a window up to the chain
  head; **analysis slider** defaults to the far right (newest block),
  dragging left issues `POST /api/backfill` from that height; the track
  fills green from the slider rightward as `analyzed-ranges` reports
  coverage (poll while backfill runs).
- A second **interval slider** on the same track selects a 100-block
  interval; the existing `#ticker` strip becomes the "block selector
  scrollbar" showing that interval's blocks (analyzed state visible).
- On interval change, auto-focus the block with the highest MEV activity
  in the interval (from `/api/mev-activity`); ties → newest. "Follow
  latest" mode pins both sliders right and keeps current behavior.

### E8 — e2e + docs (S)

e2e: backfill endpoint round-trip (small range), analyzed-ranges shape,
timeline renders and green fill advances, MEV-only/box-toggle behavior,
toast position. Update README/CLAUDE.md explorer paragraph.

## Order & dependencies

E1–E4 are independent quick wins. E5 depends on E4 (cards removed → chart
takes over). E7 depends on E6. Suggested order: E1 → E2 → E3 → E4 → E5 →
E6 → E7 → E8.

## Acceptance

- Header: beta line left, title centered, toggle group (MEV-only, EUR,
  theme) right; hover descriptions on all three toggles; toasts appear
  directly under the header.
- Stats bar starts with the private-tx card, then transactions, DEX swaps,
  and three blue MEV-type cards; no fee/tip/bid cards.
- The visualization column shows the stacked income bar vs the bid bar with
  legend incl. builder + fee recipient, animating between blocks, EUR-aware.
- Dragging the analysis slider left backfills; the track turns green
  rightward from the slider as inspection progresses and survives page
  reloads (coverage comes from Postgres, not client state); the interval
  slider scopes the ticker to 100 blocks and focus lands on the interval's
  highest-MEV block.

## Risks

- **Backfill vs node health** — a long backfill is exactly the sustained
  load that has degraded the node before. Mitigations: concurrency 1,
  reuse of the inspect dedupe + timeout, health-aware backoff, queue is
  pausable/cancelable, and the status endpoint makes progress observable.
  Backfill must never preempt interactive block views.
- **Interpretation** — "from a given adresse" is read as "from a given
  block height (slider position)"; "remove watched from the box" is read
  as "show only the private count". Flag at review if either is wrong.
- **Timeline scale** — 25M+ blocks don't fit one linear track; the timeline
  shows a bounded window (e.g. newest N thousand blocks, zoomable later)
  — the interval slider's 100-block granularity sets the useful zoom.
