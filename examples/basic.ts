#!/usr/bin/env tsx
/**
 * Basic smoke-test and example usage for the MEV Research Framework.
 * Run:  cd framework && npx tsx examples/basic.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import { EthClient, PriceOracle, ProfitabilityEngine } from "../src/index.js";

async function main() {
  console.log("=".repeat(60));
  console.log("MEV Research Framework — smoke test");
  console.log("=".repeat(60));

  // ── 1. Connect to Ethereum ──────────────────────────────────────────────
  const rpcUrl = process.env.ETHEREUM_RPC_URL;
  if (!rpcUrl) {
    console.warn("⚠  ETHEREUM_RPC_URL not set — skipping RPC calls (basic types only)");
  }

  if (rpcUrl) {
    const eth = new EthClient({ name: "Ethereum Mainnet", rpcUrl, chainId: 1 });

    // Latest block
    const latest = await eth.getLatestBlockNumber();
    console.log(`\n📦  Latest block: #${latest}`);

    // Fetch a known block (arbitrary — swap for any block you care about)
    const sampleBlock = Math.max(latest - 10, 0);
    const block = await eth.getBlock(sampleBlock);
    if (block) {
      console.log(`\n🔍  Sample block #${sampleBlock}:`);
      console.log(`   Hash:       ${block.hash}`);
      console.log(`   Timestamp:  ${new Date(block.timestamp * 1000).toISOString()}`);
      console.log(`   Miner:      ${block.miner}`);
      console.log(`   Txs:        ${block.transactions.length}`);
      console.log(`   Gas used:   ${block.gasUsed.toLocaleString()}`);
    }

    // Raw RPC call — fetch gas price directly
    const gasPrice = await eth.getGasPrice();
    console.log(`\n⛽  Gas price: ${(Number(gasPrice) / 1e9).toFixed(2)} gwei`);

    // Storage read — verify the WETH contract is deployed
    const wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    try {
      const code = await eth.getCode(wethAddress);
      console.log(`\n📜  WETH contract code size: ${(code.length - 2) / 2} bytes`);
    } catch {
      console.log(`   (Storage read requires a tracing node — skipped)`);
    }
  }

  // ── 2. Price oracle ──────────────────────────────────────────────────────
  const oracle = new PriceOracle();
  console.log("\n💰  Price oracle (CoinGecko):");

  const tokens = ["ETH", "WETH", "USDC", "USDT", "WBTC"];
  for (const token of tokens) {
    const price = await oracle.getPrice(token);
    if (price) {
      console.log(`   ${token.padEnd(6)} $${price.usdPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    } else {
      console.log(`   ${token.padEnd(6)} (not found)`);
    }
  }

  // ── 3. Profitability engine ───────────────────────────────────────────────
  const engine = new ProfitabilityEngine();

  // Simulate a sandwich attack: bought ETH at a low price, sold high
  const sandwichResult = engine.calculate({
    gasUsed: 350_000n,
    gasPrice: 45_000_000_000n,       // 45 gwei
    revenue: 200_000_000_000_000_000n, // 0.2 ETH
  });

  console.log("\n📊  Sandwich attack simulation:");
  console.log(`   Revenue:   ${Number(sandwichResult.breakdown.revenue) / 1e18} ETH`);
  console.log(`   Gas cost:  ${Number(sandwichResult.gasCostWei) / 1e18} ETH`);
  console.log(`   Net profit: ${Number(sandwichResult.profitWei) / 1e18} ETH`);

  // Arbitrage simulation
  const arbResult = engine.calculate({
    gasUsed: 200_000n,
    gasPrice: 25_000_000_000n,       // 25 gwei
    revenue: 30_000_000_000_000_000n, // 0.03 ETH
  });

  console.log("\n📊  Arbitrage simulation:");
  console.log(`   Revenue:   ${Number(arbResult.breakdown.revenue) / 1e18} ETH`);
  console.log(`   Gas cost:  ${Number(arbResult.gasCostWei) / 1e18} ETH`);
  console.log(`   Net profit: ${Number(arbResult.profitWei) / 1e18} ETH`);
  console.log(`   Profitable: ${engine.isProfitable({
    gasUsed: 200_000n, gasPrice: 25_000_000_000n, revenue: 30_000_000_000_000_000n
  })}`);

  console.log("\n✅  Smoke test complete.");
}

main().catch((err) => {
  console.error("❌  Error:", err);
  process.exit(1);
});