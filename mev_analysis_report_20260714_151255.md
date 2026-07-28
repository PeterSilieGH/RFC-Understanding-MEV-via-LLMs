
# MEV Transaction Analysis Report

## Phase 1: MEV Identification & Classification

### **MEV Determination: LIKELY MEV - Sandwich Attack Pattern**

Based on the transaction structure and execution patterns, this appears to represent a **Sandwich Attack** MEV strategy.

### **Classification: Sandwich Attack**

**What is a Sandwich Attack?**
A sandwich attack is an MEV strategy where a searcher places two transactions around a victim's transaction:
1. **Front-run**: Buy the target token BEFORE the victim (driving price up)
2. **Victim**: The victim's transaction executes at the inflated price
3. **Back-run**: Sell the token AFTER the victim (capturing the price difference as profit)

The attacker "sandwiches" the victim's transaction, extracting value from the price impact the victim creates.

---

## Phase 2: The Actors & Environment

### **Key Players Identified**

| Role | Address | Description |
|------|---------|-------------|
| **Searcher/Attacker** | `0xd36e324e495848e91f28c4a4013641ce8b5da932` | Initiates Transactions 1 & 3 (front-run + back-run) |
| **Victim** | `0x61ef688afe21b0d57c7f366888a9409a3f63a00b` | Initiates Transaction 2 (sandwiched in the middle) |
| **Router Contract** | `0xe592427a0aece92de3edee1f18e0157c05861564` | Uniswap V3 SwapRouter |
| **Pool Contract** | `0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640` | Uniswap V3 USDC/WETH Pool |

### **Protocols Involved**

| Protocol | Contract Address | Purpose |
|----------|-----------------|---------|
| **Uniswap V3** | `0xe592427a...` | Decentralized Exchange Router |
| **USDC** | `0xa0b86991...` | USD Coin Stablecoin |
| **WETH** | `0xc02aaa39...` | Wrapped Ether |
| **ERC20 Proxy** | `0x43506849...` | Token implementation proxy |

---

## Phase 3: Step-by-Step Transaction Explanation

### **Transaction Flow Overview**

```
┌─────────────────────────────────────────────────────────────────┐
│                    BLOCK TRANSACTION ORDER                      │
├─────────────────────────────────────────────────────────────────┤
│  TX1: Searcher Front-Run  → 0xd36e324e... (ATTACKER)            │
│  TX2: Victim Transaction  → 0x61ef688a... (VICTIM)              │
│  TX3: Searcher Back-Run   → 0xd36e324e... (ATTACKER)            │
└─────────────────────────────────────────────────────────────────┘
```

### **Detailed Execution Breakdown**

#### **Transaction 1: Front-Run Setup**
```
EOA (0xd36e324e...) 
    └── CALL → Uniswap V3 Router (0xe592427a...) [exactInputSingle: 0x414bf389]
            └── CALL → USDC/WETH Pool (0x88e6a0c2...) [swap: 0x128acb08]
                    ├── CALL → WETH [transfer: 0xa9059cbb] ← Moving WETH
                    ├── STATICCALL → USDC [balanceOf: 0x70a08231] ← Check balance
                    ├── CALL → Router [uniswapV3SwapCallback: 0xfa461e33]
                    │       └── CALL → USDC [transferFrom: 0x23b872dd] ← Pay USDC
                    └── STATICCALL → USDC [balanceOf: 0x70a08231] ← Verify balance
```

**What Happened**: The searcher buys WETH with USDC, pushing the WETH price UP in the pool.

---

#### **Transaction 2: Victim Transaction**
```
EOA (0x61ef688a...) 
    └── CALL → Uniswap V3 Router (0xe5592427a...) [exactInputSingle: 0x414bf389]
            └── CALL → USDC/WETH Pool (0x88e6a0c2...) [swap: 0x128acb08]
                    ├── CALL → WETH [transfer: 0xa9059cbb] ← Moving WETH
                    ├── STATICCALL → USDC [balanceOf: 0x70a08231] ← Check balance
                    ├── CALL → Router [uniswapV3SwapCallback: 0xfa461e33]
                    │       └── CALL → USDC [transferFrom: 0x23b872dd] ← Pay USDC
                    └── STATICCALL → USDC [balanceOf: 0x70a08231] ← Verify balance
```

**What Happened**: The victim executes their swap at the INFLATED price created by TX1. They receive LESS WETH for their USDC than they would have normally.

---

#### **Transaction 3: Back-Run Profit**
```
EOA (0xd36e324e...) 
    └── CALL → Uniswap V3 Router (0xe592427a...) [exactInputSingle: 0x414bf389]
            └── CALL → USDC/WETH Pool (0x88e6a0c2...) [swap: 0x128acb08]
                    ├── CALL → USDC [transfer: 0xa9059cbb] ← Moving USDC (RECEIVING)
                    ├── STATICCALL → WETH [balanceOf: 0x70a08231] ← Check balance
                    ├── CALL → Router [uniswapV3SwapCallback: 0xfa461e33]
                    │       └── CALL → WETH [transferFrom: 0x23b872dd] ← Pay WETH
                    └── STATICCALL → WETH [balanceOf: 0x70a08231] ← Verify balance
```

**What Happened**: The searcher sells their WETH back for USDC at the HIGHER price (inflated by the victim's transaction), capturing the spread as profit.

---

### **Contract Logic Explanation**

Based on the decompiled contract code:

1. **Uniswap V3 Router (`0xe592427a...`)**: 
   - Handles `exactInputSingle` swaps (specify input amount, get variable output)
   - Implements `uniswapV3SwapCallback` to receive tokens from the pool
   - Uses `transferFrom` to pull tokens from the user

2. **Uniswap V3 Pool (`0x88e6a0c2...`)**:
   - Executes the actual swap logic
   - Calls `transfer` to send output tokens
   - Calls `balanceOf` to verify balances before/after
   - Triggers callback to router for payment

3. **Token Contracts (WETH/USDC)**:
   - Standard ERC20 `transfer`, `transferFrom`, `balanceOf`
   - USDC uses delegatecall proxy pattern (`0x43506849...`)

---

## Phase 4: The Profit Mechanism & Builder Bribe

### **How the Searcher Profits**

```
┌────────────────────────────────────────────────────────────────────┐
│                      PROFIT FLOW DIAGRAM                           │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  TX1: Searcher buys WETH @ LOW price                               │
│       USDC → WETH (accumulates WETH position)                      │
│                                                                    │
│  TX2: Victim buys WETH @ HIGH price (due to TX1 impact)            │
│       Victim gets LESS WETH per USDC                               │
│       Pool price increases further                                 │
│                                                                    │
│  TX3: Searcher sells WETH @ HIGHER price                           │
│       WETH → USDC (receives MORE USDC than spent in TX1)           │
│                                                                    │
│  NET RESULT: Searcher ends with MORE USDC than started             │
│              (Profit = USDC_out - USDC_in)                         │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### **Token Accumulation Summary**

| Transaction | Searcher USDC | Searcher WETH | Net Position Change |
|-------------|---------------|---------------|---------------------|
| **Start** | X | 0 | Baseline |
| **After TX1** | X - A | +B | Bought WETH |
| **After TX3** | X + C | 0 | Sold WETH |
| **PROFIT** | **C - A** | **0** | **Net USDC Gain** |

Where C > A due to the price impact from the victim's transaction.

### **Builder Bribe / Priority Fees**

**Note**: The provided transaction data does not include explicit builder bribe information (such as direct transfers to `block.coinbase`). However, typical sandwich attack operators use:

1. **High Gas Prices**: Outbidding other transactions to ensure ordering
2. **Flashbots/MEV-Boost**: Direct bundles to validators
3. **Priority Fees**: Elevated `maxPriorityFeePerGas` to incentivize inclusion

To confirm builder compensation, you would need to examine:
- Transaction gas price vs. block base fee
- Direct ETH transfers to coinbase address
- Flashbots bundle metadata

---

## Summary & Key Takeaways

### **MEV Strategy Confirmed**: ✅ **Sandwich Attack**

| Aspect | Finding |
|--------|---------|
| **MEV Type** | Sandwich Attack |
| **Attacker** | `0xd36e324e495848e91f28c4a4013641ce8b5da932` |
| **Victim** | `0x61ef688afe21b0d57c7f366888a9409a3f63a00b` |
| **Protocol** | Uniswap V3 (USDC/WETH Pool) |
| **Mechanism** | Front-run buy → Victim trades → Back-run sell |
| **Profit Token** | USDC (stablecoin) |

### **Educational Notes**

1. **Why This Works**: Uniswap V3 uses concentrated liquidity with price impact. Large trades move the price, which attackers exploit.

2. **Victim Impact**: The victim receives worse execution (slippage) than expected due to the artificial price movement.

3. **Detection Signs**:
   - Same address appearing before AND after another transaction
   - Identical pool/router contracts in sequence
   - Opposite swap directions (buy then sell same pair)

4. **Mitigation**: Users can protect themselves by:
   - Setting tight slippage tolerance
   - Using private RPC endpoints
   - Trading during low-volume periods

---

*This analysis is based on the transaction call trees and contract interactions provided. Actual profit amounts would require examining the specific token transfer values in the transaction receipts.*