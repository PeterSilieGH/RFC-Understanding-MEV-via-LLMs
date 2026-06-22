---
name: mev
description: >
  Use when the user asks about MEV (Maximal Extractable Value) analysis,
  on-chain research, DeFi patterns, or anything related to Ethereum transaction
  ordering and value extraction. Covers arbitrage, sandwich attacks, liquidations,
  JIT liquidity, frontrunning, and backrunning patterns.
---

# MEV Research Skill

Use this skill when the user asks about MEV (Maximal Extractable Value) analysis,
on-chain research, DeFi patterns, or anything related to Ethereum transaction
ordering and value extraction.

## Prerequisites

Check that the framework is set up:
1. `cd framework && npm install` if not already done
2. Copy `.env.example` to `.env` and fill in RPC URLs
3. `ETHEREUM_RPC_URL` must be set (e.g. from Infura, Cloudflare, Ankr, etc.)

## Steps

### 1. Connect
```typescript
import { EthClient } from "../framework/src/eth/client.js";
const eth = new EthClient({ name: "mainnet", rpcUrl: process.env.ETHEREUM_RPC_URL!, chainId: 1 });
const latest = await eth.getLatestBlockNumber();
console.log(`Connected: latest block = ${latest}`);
```

### 2. Define the scope
Ask the user to clarify:
- **Block range**: specific block number, or start–end?
- **Chain**: Ethereum mainnet (1), Optimism (10), Arbitrum (42161), Base (8453)?
- **MEV types of interest**: arbitrage, sandwich, liquidation, jit, frontrun, backrun?
- **Specific protocols**: Uniswap, Aave, Compound, Curve, specific addresses?

### 3. Collect data
```typescript
// Single block
const block = await eth.getBlock(19_500_000);

// Block range (for batch analysis)
const blocks = await eth.getBlocksInRange(19_500_000, 19_500_100);

// Specific transaction
const tx = await eth.getTransaction("0xabc123...");

// Storage at a block (e.g. check a pool's reserves)
const reserves = await eth.getStorageAt("0x8ad599c3A0ff1de082011EFDDc58f1908eb6e6D8", "0", blockNumber);
```

### 4. Analyze
Use the analysis modules:
- **Arbitrage**: Look for same-token swaps across different DEXes in one block
- **Sandwich**: Look for FR + victim + BR pattern (3 txs, same token pair, same block)
- **Liquidation**: Search for `liquidate` selectors in tx data
- **JIT**: Look for addLiquidity calls right before large swaps in the same block

```typescript
import { ProfitabilityEngine } from "../framework/src/analysis/profitability.js";
import { PriceOracle } from "../framework/src/eth/oracle.js";

const engine = new ProfitabilityEngine();
const oracle = new PriceOracle();

// Example: check if a transaction was profitable
const result = engine.calculate({
  gasUsed: 150_000n,
  gasPrice: 30_000_000_000n,  // 30 gwei
  revenue: 100_000_000_000_000_000n,  // 0.1 ETH
});
```

### 5. Simulate (if Tenderly is configured)
```typescript
import { simulateWithTenderly } from "../framework/src/simulation/tenderly.js";
const sim = await simulateWithTenderly(tx, blockNumber);
if (sim) console.log(`Sim success: gasUsed=${sim.gasUsed}`);
```

### 6. Report
Generate a structured Markdown report for the user:
```
## MEV Analysis Report

**Block**: #19,500,000
**Timestamp**: 2024-01-15 14:23:11 UTC
**Chain**: Ethereum Mainnet

### Findings

| Type | TX Hash | Attacker | Profit (ETH) | Gas Cost (ETH) | Net |
|------|---------|----------|-------------|----------------|-----|
| arbitrage | 0xabc | 0xDEF | 0.05 | 0.004 | 0.046 |
| sandwich | 0x123 | 0x456 | 0.12 | 0.006 | 0.114 |

### Notes
- ...
```

## Toolset

You have these tools available:
- `read` — read TypeScript source files in `framework/src/`
- `write` / `edit` — modify framework files
- `bash` — run TypeScript with `tsx`, query RPC, use `curl`

## Common Commands

```bash
# Install deps
cd framework && npm install

# Type-check
cd framework && npx tsc --noEmit

# Run analysis on a specific block
cd framework && npx tsx -e "
import { EthClient } from './src/eth/client.js';
const eth = new EthClient({ name: 'mainnet', rpcUrl: process.env.ETHEREUM_RPC_URL!, chainId: 1 });
const block = await eth.getBlock(19500000);
console.log(JSON.stringify(block, null, 2));
"

# Get gas price
curl -X POST \$ETHEREUM_RPC_URL -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_gasPrice","params":[],"id":1}'
```

## Tips

- Use `debug_traceCall` for simulating txs against state without broadcasting
- Use `eth_getLogs` with topics for historical event searching (no trace needed)
- For mempool watching, use `newPendingTransactions` subscription via WebSocket
- Rate limit RPC calls to ~50 req/s on public endpoints; use `Bottleneck` in `src/eth/client.ts`
- For Flashbots simulation, set `FLASHBOTS_AUTH_KEY` and use the Flashbots SDK