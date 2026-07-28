

# MEV Transaction Analysis Report

## Phase 1: MEV Identification & Classification

### ✅ **MEV CONFIRMED**

**Classification: Backrunning Arbitrage (DEX Arbitrage)**

**Definition:** Backrunning is when a searcher observes a pending transaction that will move market prices (typically a large trade), then submits their own transaction to execute **immediately after** the victim's transaction. The searcher profits from the price impact created by the victim's trade by trading in the opposite direction once prices have been moved.

**Why This Is Backrunning:**
- Three sequential transactions from **two different EOAs** working in coordination
- TX1 and TX3 are from the same address (`0xd36e...`)
- TX2 is sandwiched between them from a different address (`0xebed...`)
- All transactions interact with the **same Uniswap V3 USDC/WETH pool** (`0x88e6a0c2...`)
- Pattern shows: Large trade → Arbitrage execution → Large trade continuation

---

## Phase 2: The Actors & Environment

### Key Players

| Role | Address | Description |
|------|---------|-------------|
| **Primary Searcher (EOA)** | `0xd36e324e495848e91f28c4a4013641ce8b5da932` | Initiates TX1 and TX3 - coordinates the overall strategy |
| **Secondary Searcher (EOA)** | `0xebedc8e9ff409b23dd251f87ccbffa8075f87255` | Executes TX2 - the actual arbitrage capture |
| **Bot/Router Contract** | `0x51c72848c68a965f66fa7a88855f9f7784502a7f` | Custom contract used by secondary searcher for TX2 execution |
| **Victim** | *Not clearly identifiable* | May be one of the EOAs themselves (self-arbitrage) or the transactions are all searcher-controlled |

### Protocols Involved

| Protocol | Address | Role |
|----------|---------|------|
| **Uniswap V3 Router** | `0xe592427a0aece92de3edee1f18e0157c05861564` | Main swap interface (exactInputSingle method) |
| **Uniswap V3 Pool** | `0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640` | USDC/WETH 0.05% fee tier pool |
| **WETH** | `0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2` | Wrapped Ether token |
| **USDC** | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` | USD Coin (FiatTokenV2 implementation) |

---

## Phase 3: Step-by-Step Transaction Explanation

### Transaction 1: Initial Price Movement Setup
**Hash:** `0x1af138ec5ce7d521a82ef780c54c6e0d05fc587846fe28dd8284d2f1e9a75b01`

```
┌─────────────────────────────────────────────────────────────┐
│  EOA (0xd36e...)                                          │
│       │                                                    │
│       ▼                                                    │
│  Uniswap V3 Router (0xe592427a...)                        │
│  Method: exactInputSingle (0x414bf389)                    │
│       │                                                    │
│       ▼                                                    │
│  USDC/WETH Pool (0x88e6a0c2...)                           │
│  Method: swap (0x128acb08)                                │
│       │                                                    │
│       ├──► WETH Transfer Out                               │
│       │    (0xa9059cbb - moving WETH from pool)           │
│       │                                                    │
│       ├──► USDC Balance Check                              │
│       │    (0x70a08231 - verifying pool reserves)         │
│       │                                                    │
│       └──► Swap Callback (0xfa461e33)                     │
│            │                                               │
│            ▼                                               │
│         USDC TransferFrom                                  │
│         (0x23b872dd - pulling USDC from trader)           │
└─────────────────────────────────────────────────────────────┘
```

**What Happened:** The searcher executed a swap through Uniswap V3 that **moved WETH out of the pool** and **pulled USDC from their account**. This created initial price pressure in the pool.

---

### Transaction 2: Arbitrage Capture (THE PROFIT TX)
**Hash:** `0xb93eca69ca2ac5e595a86c9ad01ba0828fb669cc5fea2ce2df31ba4cd79c7097`

```
┌─────────────────────────────────────────────────────────────┐
│  EOA (0xebed...)                                          │
│       │                                                    │
│       ▼                                                    │
│  Bot Contract (0x51c72848...)                             │
│  Method: 0x771d503f (custom arbitrage function)           │
│       │                                                    │
│       ▼                                                    │
│  USDC/WETH Pool (0x88e6a0c2...)                           │
│  Method: swap (0x128acb08)                                │
│       │                                                    │
│       ├──► USDC Transfer Out                               │
│       │    (0xa9059cbb - pool sends USDC to bot)          │
│       │                                                    │
│       ├──► WETH Balance Check                              │
│       │    (0x70a08231 - verify WETH in pool)             │
│       │                                                    │
│       └──► Swap Callback (0xfa461e33)                     │
│            │                                               │
│            ▼                                               │
│         WETH Transfer                                      │
│         (0xa9059cbb - WETH sent to bot)                   │
│                                                            │
│       ▼                                                    │
│  Final Call: 0x4838b106... (fallback - reverts all)       │
│  *Likely cleanup/profit realization*                       │
└─────────────────────────────────────────────────────────────┘
```

**What Happened:** This is the **profit extraction**. After TX1 moved prices, this bot:
1. Swapped in the **opposite direction** through the same pool
2. Received USDC from the pool (which now had favorable pricing due to TX1)
3. Received WETH via the swap callback
4. The final call to `0x4838b106...` (minimal contract that reverts) suggests this may be a **profit settlement or fund routing** address

---

### Transaction 3: Position Closure/Continuation
**Hash:** `0x912b223668ee16bb2f9312478c1a6c66f7172b4b7c2141551b27c6cd8dcdf586`

```
┌─────────────────────────────────────────────────────────────┐
│  EOA (0xd36e...) - Same as TX1                            │
│       │                                                    │
│       ▼                                                    │
│  Uniswap V3 Router (0xe592427a...)                        │
│  Method: exactInputSingle (0x414bf389)                    │
│       │                                                    │
│       ▼                                                    │
│  USDC/WETH Pool (0x88e6a0c2...)                           │
│  Method: swap (0x128acb08)                                │
│       │                                                    │
│       ├──► USDC Transfer Out                               │
│       │    (pool sends USDC)                              │
│       │                                                    │
│       ├──► WETH Balance Check                              │
│       │    (verify pool WETH reserves)                    │
│       │                                                    │
│       └──► Swap Callback (0xfa461e33)                     │
│            │                                               │
│            ▼                                               │
│         WETH TransferFrom                                  │
│         (pulling WETH from trader to pool)                │
└─────────────────────────────────────────────────────────────┘
```

**What Happened:** This appears to be either:
- **Position closure** - reversing the initial trade to realize profits
- **Continuation** - part of a larger multi-block strategy
- **Price normalization** - helping restore pool balance after arbitrage

---

## Phase 4: The Profit Mechanism & Builder Bribe

### How Profit Was Extracted

```
┌─────────────────────────────────────────────────────────────┐
│                    PROFIT FLOW                              │
│                                                             │
│  TX1: WETH OUT of pool → Price Impact Created              │
│         (WETH becomes relatively cheaper in pool)          │
│                                                             │
│  TX2: Bot BUYS WETH at depressed price                     │
│         Bot SELLS USDC at inflated price                   │
│         ════════════════════════════════════               │
│         ARBITRAGE SPREAD CAPTURED                          │
│         ════════════════════════════════════               │
│                                                             │
│  TX3: Position closed/reversed                             │
│         Remaining profit settled to searcher wallets       │
│                                                             │
│  NET RESULT:                                               │
│  • Searcher accumulated: WETH + USDC (net positive)        │
│  • Pool returned to near-original state                    │
│  • Price impact exploited for profit                       │
└─────────────────────────────────────────────────────────────┘
```

### Token Accumulation

By the end of this transaction bundle, the searchers accumulated:
- **WETH**: Net positive from TX2's swap callback
- **USDC**: Net positive from TX2's pool transfer

The exact profit amount cannot be determined without value data, but the **pattern confirms successful arbitrage execution**.

### Builder Bribe Analysis

⚠️ **No Direct Coinbase Payment Detected**

In the provided call trees, there is **no explicit transfer to `block.coinbase`** visible. However, the searcher likely paid the builder through:

1. **High Priority Fees (tips)** - Elevated `maxPriorityFeePerGas` to win block inclusion
2. **Direct Bundle Submission** - Through Flashbots or similar MEV-Boost infrastructure
3. **Implicit Payments** - The coordination between two EOAs suggests pre-arranged block building

The fact that TX2 (the profit tx) is **sandwiched exactly between TX1 and TX3** from a different EOA indicates this was a **coordinated bundle submission**, not random mempool competition.

---

## Summary

| Aspect | Finding |
|--------|---------|
| **MEV Type** | Backrunning Arbitrage |
| **Strategy** | Multi-transaction coordinated price impact exploitation |
| **Pool Targeted** | Uniswap V3 USDC/WETH 0.05% |
| **Searcher Addresses** | 2 EOAs working in coordination |
| **Profit Tokens** | WETH + USDC |
| **Builder Payment** | Likely via priority fees/bundle (not visible in trace) |
| **Sophistication Level** | High - coordinated multi-tx strategy |

This is a textbook example of **sophisticated backrunning arbitrage** where the searcher controls multiple transactions to create and exploit price movements within a single block.