import { PriceOracle } from "../eth/oracle.js";
import { logger } from "../utils/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProfitabilityInput {
  /** Gas used by the attack transaction(s) */
  gasUsed: bigint;
  /** Gas price paid (wei per gas) */
  gasPrice: bigint;
  /** Revenue earned from the MEV extraction (wei, native token) */
  revenue: bigint;
  /** Optional: base fees to include in cost calculation */
  baseFeePerGas?: bigint;
  /** Optional: priority fees paid */
  priorityFeePerGas?: bigint;
}

export interface ProfitabilityResult {
  /** Net profit in wei */
  profitWei: bigint;
  /** Net profit in USD (requires PriceOracle) */
  profitUsd?: number;
  /** Gas cost in wei */
  gasCostWei: bigint;
  /** Gas cost in USD (requires PriceOracle) */
  gasCostUsd?: number;
  /** Cost breakdown */
  breakdown: {
    revenue: bigint;
    priorityFeeCost: bigint;
    baseFeeCost: bigint;
    totalCost: bigint;
    netProfit: bigint;
  };
}

// ─── Profitability Engine ─────────────────────────────────────────────────────

export class ProfitabilityEngine {
  private oracle: PriceOracle;

  constructor(oracle?: PriceOracle) {
    this.oracle = oracle ?? new PriceOracle();
  }

  /**
   * Calculate net profitability of an MEV extraction.
   */
  calculate(input: ProfitabilityInput): ProfitabilityResult {
    const {
      gasUsed,
      gasPrice,
      revenue,
      baseFeePerGas = 0n,
      priorityFeePerGas = 0n,
    } = input;

    // Total gas cost = gasUsed * gasPrice
    // If gasPrice is the effective price (base + priority), no need to double-count
    const priorityFeeCost = gasUsed * priorityFeePerGas;
    const baseFeeCost = gasUsed * baseFeePerGas;
    const gasCostWei = gasUsed * gasPrice;
    const totalCost = gasCostWei;
    const profitWei = revenue > totalCost ? revenue - totalCost : 0n;

    return {
      profitWei,
      gasCostWei,
      breakdown: {
        revenue,
        priorityFeeCost,
        baseFeeCost,
        totalCost,
        netProfit: profitWei,
      },
    };
  }

  /**
   * Calculate profitability and annotate with USD values using the oracle.
   */
  async calculateAnnotated(input: ProfitabilityInput): Promise<ProfitabilityResult> {
    const result = this.calculate(input);

    // Annotate with USD values — gracefully handle oracle failures
    const ethPrice = await this.oracle.getPrice("ETH");
    if (ethPrice) {
      const eth = (n: bigint) => Number(n) / 1e18;
      result.profitUsd = eth(result.profitWei) * ethPrice.usdPrice;
      result.gasCostUsd = eth(result.gasCostWei) * ethPrice.usdPrice;
    }

    return result;
  }

  /**
   * Convert wei values to USD using the oracle.
   */
  async weiToUsd(wei: bigint): Promise<number | null> {
    const eth = Number(wei) / 1e18;
    const price = await this.oracle.getPrice("ETH");
    return price ? eth * price.usdPrice : null;
  }

  /**
   * Estimate gas cost for a given gas limit and gas price.
   */
  static estimateGasCost(gasLimit: bigint, gasPrice: bigint): bigint {
    return gasLimit * gasPrice;
  }

  /**
   * Is the MEV opportunity profitable after gas costs?
   * Uses a conservative estimate with a safety margin.
   */
  isProfitable(input: ProfitabilityInput, minProfitUsd = 1): boolean {
    const result = this.calculate(input);
    if (result.profitWei <= 0n) return false;

    // Quick heuristic: ~1 ETH profit for a meaningful opportunity
    const minProfitWei = BigInt(Math.ceil(minProfitUsd * 1e18));
    return result.profitWei >= minProfitWei;
  }

  /**
   * Profitability ratio (revenue / cost). > 1 means profitable.
   */
  static ratio(input: ProfitabilityInput): number {
    const { revenue, gasUsed, gasPrice } = input;
    const cost = gasUsed * gasPrice;
    if (cost === 0n) return Infinity;
    return Number(revenue) / Number(cost);
  }
}