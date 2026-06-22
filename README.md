# RFC-Understanding-MEV-via-LLMs

An open research framework and proposal for analyzing Maximal Extractable Value (MEV) on Ethereum using Large Language Models.

## Framework Structure

```
RFC-Understanding-MEV-via-LLMs/
├── framework/                 # MEV research framework (TypeScript)
│   ├── src/
│   │   ├── eth/               # Ethereum data layer
│   │   │   ├── client.ts      # EthClient — JSON-RPC, blocks, txs, traces
│   │   │   └── oracle.ts      # PriceOracle — real-time token prices (CoinGecko)
│   │   ├── analysis/
│   │   │   ├── types.ts       # MEVType, MEVEvent, PendingTx, AnalysisResult
│   │   │   └── profitability.ts # ProfitabilityEngine — gas cost & profit calc
│   │   └── utils/logger.ts    # Pino logger
│   ├── package.json
│   └── tsconfig.json
├── .pi/                       # pi harness config
│   ├── AGENTS.md              # Framework instructions for pi
│   └── skills/mev/
│       └── SKILL.md           # /skill:mev — research workflow
├── docs/
│   └── ARCHITECTURE.md        # Full architecture doc
└── README.md                  # This file
```

## Quick Start

### 1. Install framework dependencies

```bash
cd framework && npm install
```

### 2. Configure environment

```bash
cp framework/.env.example framework/.env
# Edit .env: set ETHEREUM_RPC_URL (and optionally Tenderly, Flashbots keys)
```

### 3. Build

```bash
cd framework && npm run build
```

### 4. Use from the CLI

```bash
# Check the latest block
curl -s -X POST $ETHEREUM_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Or with the framework (TypeScript):
cd framework && npx tsx -e "
import { EthClient } from './src/eth/client.js';
import * as dotenv from 'dotenv';
dotenv.config();
const eth = EthClient.fromChain('mainnet');
const block = await eth.getBlock(20_000_000);
console.log('Block:', JSON.stringify(block, null, 2));
"
```

### 5. Use with pi

```bash
# Start the MEV research pi session
npx pi
```

Once in pi, type `/skill:mev` to load the MEV research skill and start asking questions like:

```
Find sandwich attacks in block 19,500,000
What MEV events happened between blocks 19,500,000 and 19,500,100?
Explain the arbitrage loop in transaction 0xabc...
```

## Core APIs

### EthClient

```typescript
import { EthClient } from 'mev-research-framework';

// Connect to a chain
const eth = EthClient.fromChain('mainnet');
// or: new EthClient({ name, rpcUrl, chainId })

const block = await eth.getBlock(20_000_000);
const tx = await eth.getTransaction('0xabc...');
const trace = await eth.traceCall({ to: '0x...', data: '0x...' }, blockNumber);
const storage = await eth.getStorageAt('0xUniPool', '0x0');
const gas = await eth.getGasPrice();
const latest = await eth.getLatestBlockNumber();
```

### PriceOracle

```typescript
import { PriceOracle } from 'mev-research-framework';
const oracle = new PriceOracle();
const price = await oracle.getPrice('ETH');     // { symbol: 'ETH', usdPrice: 3500 }
const prices = await oracle.getPrices(['ETH', 'WETH', 'USDC']);
```

### ProfitabilityEngine

```typescript
import { ProfitabilityEngine } from 'mev-research-framework';
const engine = new ProfitabilityEngine();
const result = engine.calculate({
  gasUsed: 150_000n,
  gasPrice: 30_000_000_000n,   // 30 gwei
  revenue: 100_000_000_000_000_000n,  // 0.1 ETH
});
// result.profitWei — net profit in wei
// result.netProfit — net profit in wei
// result.breakdown — revenue, gasCostWei, totalCost
```

## MEV Types in Scope

| Type | Description | Status |
|------|-------------|--------|
| `arbitrage` | Cross-DEX price arbitrage | planned |
| `sandwich` | FR + victim + BR pattern | planned |
| `liquidation` | DeFi liquidation calls | planned |
| `jit` | Just-in-time LP provision | planned |
| `frontrun` | Generic frontrunning | planned |
| `backrun` | Backrun after large tx | planned |
| `multihop` | Multi-route arbitrage | planned |

## Environment Variables

```env
ETHEREUM_RPC_URL=https://eth.llamarpc.com
OPTIMISM_RPC_URL=
ARBITRUM_RPC_URL=
BASE_RPC_URL=
TENDERLY_ACCESS_KEY=
TENDERLY_ACCOUNT_ID=
TENDERLY_PROJECT_SLUG=
FLASHBOTS_AUTH_KEY=
FLASHBOTS_SIGNING_KEY=
LOG_LEVEL=info
```

## Status

- [x] Framework scaffold & build system
- [x] `EthClient` — blocks, txs, storage, traces, raw RPC
- [x] `PriceOracle` — CoinGecko price feed
- [x] `ProfitabilityEngine` — gas & profit calc
- [x] `ProfitabilityEngine.calculateAnnotated` — USD annotation
- [x] pi skill + AGENTS.md
- [x] Unit tests (Vitest) — 48 passing
  - `profitability.test.ts` — 22 tests for `ProfitabilityEngine`
  - `oracle.test.ts` — 16 tests for `PriceOracle`
  - `types.test.ts` — 10 tests for types, chain registry, logger
- [ ] Arbitrage detector
- [ ] Sandwich detector
- [ ] Liquidation detector
- [ ] Mempool watcher
- [ ] Flashbots integration
- [ ] Tenderly simulation
- [ ] CLI
- [ ] Historical analysis / replay
- [ ] Reports

## License

MIT
