# MEV Research Framework — Agent Instructions

You are working inside the MEV Research Framework. This is an open research project for analyzing
Maximal Extractable Value (MEV) on Ethereum using LLMs.

## Quick Reference

- **Framework**: `framework/` (TypeScript, ESM)
- **Start**: `cd framework && npm install`
- **CLI**: `npm run dev` (tsx dev mode) or `npm run build && mev`
- **Env**: Copy `framework/.env.example` → `framework/.env`

## Core Modules

- `EthClient` — Ethereum JSON-RPC access (blocks, txs, traces, storage)
- `PriceOracle` — Real-time token prices (CoinGecko, USD)
- `ProfitabilityEngine` — MEV profit & gas cost calculations
- `types.ts` — MEVType, MEVEvent, PendingTx, AnalysisResult, etc.

## Common Tasks

### Fetch a block
```typescript
import { EthClient } from "./eth/client.js";
const eth = new EthClient({ name: "mainnet", rpcUrl: process.env.ETHEREUM_RPC_URL!, chainId: 1 });
const block = await eth.getBlock(19_500_000);
```

### Check profitability
```typescript
import { ProfitabilityEngine } from "./analysis/profitability.js";
const engine = new ProfitabilityEngine();
const result = engine.calculate({ gasUsed: 150_000n, gasPrice: 30_000_000_000n, revenue: 100_000_000_000_000_000n });
// result.netProfit in wei
```

### Get a price
```typescript
import { PriceOracle } from "./eth/oracle.js";
const oracle = new PriceOracle();
const price = await oracle.getPrice("ETH"); // { symbol: "ETH", usdPrice: 3500, updatedAt: ... }
```

### Watch the mempool
```typescript
import { mempool } from "./eth/mempool.js";
mempool.subscribe((tx) => {
  if (isInteresting(tx)) console.log(`Interesting tx: ${tx.hash}`);
});
```

## MEV Types to Detect

| Type | Description | Indicators |
|------|-------------|------------|
| `arbitrage` | DEX price difference exploitation | Same token, multiple DEX txs in one block |
| `sandwich` | FR + victim + BR on DEX swap | 3-tx pattern, same token pair, same block |
| `liquidation` | DeFi protocol liquidation call | `liquidate()` / `liquidateBorrow()` selectors |
| `jit` | Just-in-time liquidity provision | Uniswap addLiquidity directly before large swap |
| `frontrun` | Generic frontrunning of large DEX swap | Higher gas, same token pair, same block |
| `backrun` | Catching a large DEX swap with LP provision | Same block, follows large swap |
| `multihop` | Multi-route arbitrage | 3+ exchanges in one bundle |

## Research Workflow

1. **Scope** — define chain, block range, MEV types of interest
2. **Collect** — fetch blocks, transactions, mempool
3. **Analyze** — pattern detection, profit calculation
4. **Report** — summarize findings, generate code examples

## Ethics

This is a research framework. Do not provide executable bot code designed to
extract MEV in ways that harm ordinary users (e.g., sandwich attacks on small swaps,
liquidation sniping of vulnerable positions). Focus on:

- Detection and analysis (what happened, why)
- Ethical extraction patterns (backrun of large swaps, fair arbitrage)
- Simulation and backtesting (what *could* have happened)
- Research reports for protocol security and DeFi research

## Environment Variables

```
ETHEREUM_RPC_URL=...
TENDERLY_ACCESS_KEY=...
TENDERLY_ACCOUNT_ID=...
TENDERLY_PROJECT_SLUG=...
FLASHBOTS_AUTH_KEY=...
LOG_LEVEL=info
```

## Output

Format research findings as structured Markdown. Include:
- Block number(s) and timestamp
- TX hashes
- MEV type classification
- Profit estimate (ETH and USD)
- Gas costs
- Confirmed vs. suspected