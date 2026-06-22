# MEV Research Framework — Architecture

## Overview

A modular framework for conducting MEV (Maximal Extractable Value) research on Ethereum, powered by the pi coding harness. Designed for LLM-driven analysis, bot development, and on-chain research.

---

## Module Map

```
mev-research-framework/
├── src/
│   ├── eth/                  # Ethereum data layer
│   │   ├── client.ts         # JSON-RPC client (ethers.js)
│   │   ├── mempool.ts        # Mempool streamer (tx pool subscription)
│   │   ├── state.ts          # State-at-block / simulation
│   │   └── oracle.ts         # Price feeds for profit calc
│   │
│   ├── analysis/             # MEV analysis engine
│   │   ├── detector.ts       # Pattern detection (arbitrage, sandwich, liquidation)
│   │   ├── extractor.ts      # MEV opportunity scoring & extraction logic
│   │   ├── profitability.ts  # Gas & token profit calculations
│   │   └── flashbots.ts      # Flashbots MEV-boost / mev-share integration
│   │
│   ├── data/                 # Data storage & retrieval
│   │   ├── db.ts             # SQLite/PostgreSQL persistence
│   │   ├── blocks.ts         # Block / tx history ingest
│   │   └── export.ts         # CSV / JSON export
│   │
│   ├── simulation/           # Backtesting & simulation
│   │   ├── tenderly.ts       # Tenderly Simulation API
│   │   ├── local.ts          # Local VM (hardhat, evm-dafny)
│   │   └── replay.ts         # Transaction replay
│   │
│   ├── cli/                  # CLI commands
│   │   ├── index.ts          # Main CLI entry point
│   │   ├── cmd/
│   │   │   ├── mempool.ts    # mempool watch command
│   │   │   ├── analyze.ts    # analyze block / tx command
│   │   │   ├── search.ts     # search historical MEV patterns
│   │   │   ├── simulate.ts   # simulation command
│   │   │   └── bundle.ts     # bundle submission command
│   │   └── prompt.ts         # interactive research prompt builder
│   │
│   └── research/              # High-level research workflows
│       ├── arb.ts            # Cross-exchange arbitrage research
│       ├── liquidation.ts    # DeFi liquidation finder
│       ├── sandwich.ts       # Sandwich attack analyzer
│       ├── jitter.ts         # JIT liquidity provision
│       ├── frontrun.ts       # Generic frontrun opportunity finder
│       └── report.ts         # Auto-generated MEV reports
│
├── .pi/                      # pi harness config
│   ├── AGENTS.md             # Framework instructions for pi
│   ├── skills/               # pi skills
│   │   └── mev/
│   │       └── SKILL.md      # MEV research skill
│   ├── prompts/              # pi prompt templates
│   │   ├── analyze-block.md
│   │   ├── find-arbitrage.md
│   │   └── explain-mev.md
│   └── extensions/           # pi extensions (optional)
│
├── scripts/                  # One-off research scripts
├── tests/                    # Unit & integration tests
├── docs/                     # Architecture, guides, papers
├── data/                     # Local SQLite DB, CSV exports
│
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## Core Dependencies

```json
{
  "dependencies": {
    "ethers": "^6",
    "@flashbots/mev-search": "^1.0",
    "axios": "^1.7",
    "sqlite3": "^5",
    "dotenv": "^17",
    "zod": "^3",
    "viem": "^2"
  }
}
```

---

## Key Design Decisions

### 1. Dual RPC Layer
Use both **ethers.js** (for general EVM interaction) and **viem** (for low-level tracing and statediff). This gives us both developer ergonomics and raw trace access.

### 2. Simulated MEV vs. Historical
The framework separates:
- **Live mode**: watch mempool, simulate on pending txs, submit bundles
- **History mode**: analyze past blocks, replay known MEV, backtest detection

### 3. Flashbots Integration
- `mev-boost` relay connection for block proposal data
- `mev-share` for hinting and bundle backruns
- Ethical MEV by default (no sandwich/liquidation extraction that harms users)

### 4. Price Oracle
For profitability analysis, the framework uses:
- **Binance / Coinbase** public REST APIs (free, no auth)
- **Chainlink** on-chain feeds as fallback
- Cached every 5s for mempool analysis

### 5. LLM-Driven Analysis (pi)
pi acts as the **researcher layer**:
- Natural language queries: "find sandwich attacks in block 19,234,567"
- Code generation: write a Solidity contract for a new strategy
- Report generation: summarize MEV activity over a time window
- Tool orchestration: chain together mempool watching → simulation → bundle submission

### 6. Data Storage
- **SQLite** for local persistence (zero-setup, fast)
- Block/tx data cached locally to avoid re-fetching
- Export to CSV/JSON for external analysis (Dune,ibi)

---

## Research Workflows (pi Skills)

### Skill: `mev-research` (`.pi/skills/mev/SKILL.md`)

Invoked via `/skill:mev` or auto-loaded when in a research session. Steps:

1. **Connect** — verify Ethereum RPC / Flashbots auth
2. **Scope** — define block range, target contracts, opportunity types
3. **Collect** — pull mempool, historical blocks, or both
4. **Analyze** — run pattern detectors, profitability calc, simulation
5. **Report** — generate findings, code snippets, visualizations
6. **Iterate** — refine based on findings

### Prompt Templates (`.pi/prompts/`)

| Template | Use |
|---|---|
| `analyze-block.md` | Analyze a specific block for MEV activity |
| `find-arbitrage.md` | Find cross DEX arbitrage opportunities |
| `explain-mev.md` | Explain a specific MEV extraction in plain English |
| `sandwich-report.md` | Generate a sandwich attack report |
| `mev-timeline.md` | Build a timeline of MEV events in a time range |

---

## Next Steps (Priority Order)

1. **Ethereum client** (`src/eth/client.ts`) — connect to RPC, fetch blocks, txs
2. **Price oracle** (`src/eth/oracle.ts`) — real-time token prices for profit calc
3. **Profitability engine** (`src/analysis/profitability.ts`) — gas + price aware PnL
4. **Mempool watcher** (`src/eth/mempool.ts`) — stream pending transactions
5. **Arbitrage detector** (`src/research/arb.ts`) — cross-DEX opportunity finder
6. **Sandwich detector** (`src/research/sandwich.ts`) — FR + FR victim pattern
7. **Flashbots integration** (`src/analysis/flashbots.ts`) — bundle submission
8. **pi skill** (`.pi/skills/mev/SKILL.md`) — bring it all together for the LLM
9. **CLI** — `src/cli/index.ts` — interactive and batch modes
10. **Simulation** (`src/simulation/`) — Tenderly + replay

---

## Notes & Caveats

- **No financial advice**: Framework is for research only
- **Node diversity**: support mainnet + testnets (Holesky, Sepolia)
- **Rate limits**: respect RPC provider limits; add retry/backoff
- **Privacy**: mempool data is public; no PII concerns
- **Flashbots auth**: requires Flashbots account + RPC endpoint for bundle submission