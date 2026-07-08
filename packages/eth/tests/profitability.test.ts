import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfitabilityEngine } from "../src/analysis/profitability.js";
import type { ProfitabilityInput } from "../src/analysis/profitability.js";
import type { PriceOracle } from "../src/eth/oracle.js";

// ─── Test fixtures ───────────────────────────────────────────────────────────

const ONE_ETH = 1_000_000_000_000_000_000n; // 1 ETH in wei
const ONE_GWEI = 1_000_000_000n;
const TX_GAS = 200_000n;

// ─── calculate() ─────────────────────────────────────────────────────────────

describe("ProfitabilityEngine.calculate()", () => {
  it("returns positive profit when revenue exceeds gas cost", () => {
    const result = new ProfitabilityEngine().calculate({
      gasUsed: TX_GAS,
      gasPrice: 30n * ONE_GWEI, // 30 gwei
      revenue: 10n * ONE_ETH, // 10 ETH revenue
    });

    // gasCost = 200_000 * 30_000_000_000 = 6_000_000_000_000_000 = 0.006 ETH
    expect(result.gasCostWei).toBe((6n * ONE_ETH) / 1000n);
    expect(result.profitWei).toBe(10n * ONE_ETH - (6n * ONE_ETH) / 1000n);
    expect(result.breakdown.revenue).toBe(10n * ONE_ETH);
    expect(result.breakdown.netProfit).toBe(result.profitWei);
  });

  it("returns 0 profit when revenue equals gas cost (break-even)", () => {
    const result = new ProfitabilityEngine().calculate({
      gasUsed: TX_GAS,
      gasPrice: 30n * ONE_GWEI,
      revenue: (6n * ONE_ETH) / 1000n, // exactly 0.006 ETH
    });

    expect(result.profitWei).toBe(0n);
    expect(result.breakdown.netProfit).toBe(0n);
    expect(result.gasCostWei).toBe((6n * ONE_ETH) / 1000n);
  });

  it("returns 0 profit when revenue is less than gas cost (loss)", () => {
    const result = new ProfitabilityEngine().calculate({
      gasUsed: TX_GAS,
      gasPrice: 30n * ONE_GWEI,
      revenue: ONE_ETH / 1000n, // 0.001 ETH — less than 0.006 ETH gas cost
    });

    expect(result.profitWei).toBe(0n);
    expect(result.gasCostWei).toBe((6n * ONE_ETH) / 1000n);
    // netProfit should also be 0 (not negative — the engine does not carry losses)
    expect(result.breakdown.netProfit).toBe(0n);
  });

  it("handles zero gas used (no gas cost)", () => {
    const result = new ProfitabilityEngine().calculate({
      gasUsed: 0n,
      gasPrice: 30n * ONE_GWEI,
      revenue: 1n * ONE_ETH,
    });

    expect(result.gasCostWei).toBe(0n);
    expect(result.profitWei).toBe(1n * ONE_ETH);
  });

  it("handles zero revenue (no extraction)", () => {
    const result = new ProfitabilityEngine().calculate({
      gasUsed: TX_GAS,
      gasPrice: 30n * ONE_GWEI,
      revenue: 0n,
    });

    expect(result.profitWei).toBe(0n);
    expect(result.gasCostWei).toBe((6n * ONE_ETH) / 1000n);
  });

  it("includes baseFeeCost and priorityFeeCost in breakdown (informational only)", () => {
    const result = new ProfitabilityEngine().calculate({
      gasUsed: TX_GAS,
      gasPrice: 30n * ONE_GWEI,
      revenue: 10n * ONE_ETH,
      baseFeePerGas: 10n * ONE_GWEI,
      priorityFeePerGas: 20n * ONE_GWEI,
    });

    // breakdown shows the component costs, but totalCost = gasUsed * gasPrice (effective price)
    expect(result.breakdown.priorityFeeCost).toBe((4n * ONE_ETH) / 1000n);
    expect(result.breakdown.baseFeeCost).toBe((2n * ONE_ETH) / 1000n);
    expect(result.breakdown.totalCost).toBe((6n * ONE_ETH) / 1000n);
    // netProfit = revenue - totalCost (totalCost already includes both components via effective gasPrice)
    expect(result.breakdown.netProfit).toBe(10n * ONE_ETH - (6n * ONE_ETH) / 1000n);
  });

  it("treats missing baseFeePerGas and priorityFeePerGas as 0", () => {
    const result = new ProfitabilityEngine().calculate({
      gasUsed: TX_GAS,
      gasPrice: 30n * ONE_GWEI,
      revenue: 10n * ONE_ETH,
      // baseFeePerGas and priorityFeePerGas omitted
    });

    expect(result.breakdown.priorityFeeCost).toBe(0n);
    expect(result.breakdown.baseFeeCost).toBe(0n);
    expect(result.profitWei).toBeGreaterThan(0n);
  });
});

// ─── isProfitable() ───────────────────────────────────────────────────────────

describe("ProfitabilityEngine.isProfitable()", () => {
  it("returns true when net profit exceeds the $1 USD threshold (~1 ETH)", () => {
    const engine = new ProfitabilityEngine();
    // 9.994 ETH net profit — well above the default 1 ETH minimum
    const input: ProfitabilityInput = {
      gasUsed: TX_GAS,
      gasPrice: 30n * ONE_GWEI,
      revenue: 10n * ONE_ETH,
    };
    expect(engine.isProfitable(input)).toBe(true);
  });

  it("returns false when net profit is exactly 0", () => {
    const engine = new ProfitabilityEngine();
    const input: ProfitabilityInput = {
      gasUsed: TX_GAS,
      gasPrice: 30n * ONE_GWEI,
      revenue: (6n * ONE_ETH) / 1000n, // break-even
    };
    expect(engine.isProfitable(input)).toBe(false);
  });

  it("returns false when revenue is insufficient (loss)", () => {
    const engine = new ProfitabilityEngine();
    const input: ProfitabilityInput = {
      gasUsed: TX_GAS,
      gasPrice: 30n * ONE_GWEI,
      revenue: ONE_ETH / 1000n, // 0.001 ETH (less than 0.006 ETH gas cost)
    };
    expect(engine.isProfitable(input)).toBe(false);
  });

  it("returns false when profit is positive but below the $1 USD minimum", () => {
    const engine = new ProfitabilityEngine();
    // net profit ≈ 0.006 ETH — below the 1 ETH minimum threshold
    const input: ProfitabilityInput = {
      gasUsed: TX_GAS,
      gasPrice: 30n * ONE_GWEI,
      revenue: (6n * ONE_ETH) / 1000n + ONE_ETH / 100n, // 0.006 + 0.01 = 0.016 ETH
    };
    expect(engine.isProfitable(input)).toBe(false);
  });

  it("respects a custom minProfitUsd threshold", () => {
    const engine = new ProfitabilityEngine();
    const input: ProfitabilityInput = {
      gasUsed: TX_GAS,
      gasPrice: 30n * ONE_GWEI,
      revenue: 2n * ONE_ETH, // ~1.994 ETH net — above 1 ETH default, below 2 ETH
    };
    expect(engine.isProfitable(input, 1)).toBe(true); // above 1 ETH threshold
    expect(engine.isProfitable(input, 2)).toBe(false); // below 2 ETH threshold
  });
});

// ─── weiToUsd() ───────────────────────────────────────────────────────────────

describe("ProfitabilityEngine.weiToUsd()", () => {
  it("converts wei to USD using the oracle", async () => {
    const mockOracle = {
      async getPrice(_symbol: string) {
        return { symbol: "ETH", usdPrice: 3000, updatedAt: Date.now() };
      },
    };
    const engine = new ProfitabilityEngine(mockOracle as unknown as PriceOracle);

    const usd = await engine.weiToUsd(ONE_ETH); // 1 ETH @ $3000
    expect(usd).toBeCloseTo(3000, 2);
  });

  it("returns null when oracle price is unavailable", async () => {
    const mockOracle = {
      async getPrice(_symbol: string) {
        return null;
      },
    };
    const engine = new ProfitabilityEngine(mockOracle as unknown as PriceOracle);

    const usd = await engine.weiToUsd(ONE_ETH);
    expect(usd).toBeNull();
  });
});

// ─── calculateAnnotated() ─────────────────────────────────────────────────────

describe("ProfitabilityEngine.calculateAnnotated()", () => {
  it("annotates profit and gas cost in USD when oracle succeeds", async () => {
    const mockOracle = {
      async getPrice(_symbol: string) {
        return { symbol: "ETH", usdPrice: 3000, updatedAt: Date.now() };
      },
    };
    const engine = new ProfitabilityEngine(mockOracle as unknown as PriceOracle);

    const result = await engine.calculateAnnotated({
      gasUsed: TX_GAS,
      gasPrice: 30n * ONE_GWEI,
      revenue: 10n * ONE_ETH,
    });

    // profitWei = 10 ETH - 0.006 ETH = 9.994 ETH → 9.994 * 3000 ≈ 2982 USD
    // profitWei = 10 ETH - 0.006 ETH = 9.994 ETH → 9.994 * 3000 ≈ 29 982 USD
    expect(result.profitUsd).toBeCloseTo(29982, 0);
    // gasCost = 0.006 ETH → 0.006 * 3000 = 18 USD
    expect(result.gasCostUsd).toBeCloseTo(18, 0);
    expect(result.profitWei).toBeGreaterThan(0n);
  });

  it("does not throw when oracle returns null for ETH price", async () => {
    const mockOracle = {
      async getPrice(_symbol: string) {
        return null; // price unavailable
      },
    };
    const engine = new ProfitabilityEngine(mockOracle as unknown as PriceOracle);

    const result = await engine.calculateAnnotated({
      gasUsed: TX_GAS,
      gasPrice: 30n * ONE_GWEI,
      revenue: 10n * ONE_ETH,
    });

    // Should succeed without throwing and leave USD fields undefined
    expect(result.profitUsd).toBeUndefined();
    expect(result.gasCostUsd).toBeUndefined();
    expect(result.profitWei).toBeGreaterThan(0n);
  });
});

// ─── estimateGasCost() ────────────────────────────────────────────────────────

describe("ProfitabilityEngine.estimateGasCost()", () => {
  it("calculates gas limit * gas price", () => {
    const cost = ProfitabilityEngine.estimateGasCost(21000n, 20n * ONE_GWEI);
    expect(cost).toBe(21000n * 20n * ONE_GWEI);
  });

  it("handles large gas limits", () => {
    const cost = ProfitabilityEngine.estimateGasCost(1_000_000n, 50n * ONE_GWEI);
    expect(cost).toBe((50n * ONE_ETH) / 1000n); // 0.05 ETH
  });
});

// ─── ratio() ─────────────────────────────────────────────────────────────────

describe("ProfitabilityEngine.ratio()", () => {
  it("returns revenue / cost when profitable", () => {
    const r = ProfitabilityEngine.ratio({
      gasUsed: TX_GAS,
      gasPrice: 30n * ONE_GWEI,
      revenue: 10n * ONE_ETH,
    });
    // revenue (10 ETH) / cost (0.006 ETH) = ~1666
    expect(r).toBeGreaterThan(1600);
    expect(r).toBeLessThan(1700);
  });

  it("returns revenue / cost (less than 1) when loss-making", () => {
    const r = ProfitabilityEngine.ratio({
      gasUsed: TX_GAS,
      gasPrice: 30n * ONE_GWEI,
      revenue: ONE_ETH / 1000n, // 0.001 ETH vs 0.006 ETH cost → ratio ~0.166
    });
    expect(r).toBeLessThan(1);
    expect(r).toBeGreaterThan(0);
  });

  it("returns Infinity when gas cost is 0", () => {
    const r = ProfitabilityEngine.ratio({
      gasUsed: 0n,
      gasPrice: 30n * ONE_GWEI,
      revenue: ONE_ETH,
    });
    expect(r).toBe(Number.POSITIVE_INFINITY);
  });

  it("returns 0 when revenue is 0", () => {
    const r = ProfitabilityEngine.ratio({
      gasUsed: TX_GAS,
      gasPrice: 30n * ONE_GWEI,
      revenue: 0n,
    });
    expect(r).toBe(0);
  });
});
