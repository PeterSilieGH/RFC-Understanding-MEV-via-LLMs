import { describe, it, expect } from "vitest";
import {
  MEV_TYPE_LABELS,
} from "../src/analysis/types.js";
import { CHAINS } from "../src/eth/client.js";
import { logger } from "../src/utils/logger.js";

// ─── MEV_TYPE_LABELS ─────────────────────────────────────────────────────────

describe("MEV_TYPE_LABELS", () => {
  it("maps every MEVType to a human-readable label", () => {
    const types = [
      "arbitrage",
      "sandwich",
      "liquidation",
      "jit",
      "frontrun",
      "backrun",
      "multihop",
      "unknown",
    ] as const;

    for (const type of types) {
      expect(MEV_TYPE_LABELS[type]).toBeTruthy();
      expect(typeof MEV_TYPE_LABELS[type]).toBe("string");
      expect(MEV_TYPE_LABELS[type].length).toBeGreaterThan(0);
    }
  });

  it("labels are descriptive (not the enum key itself)", () => {
    expect(MEV_TYPE_LABELS["sandwich"]).not.toBe("sandwich");
    expect(MEV_TYPE_LABELS["sandwich"]).toBe("Sandwich Attack");

    expect(MEV_TYPE_LABELS["arbitrage"]).toBe("DEX Arbitrage");
    expect(MEV_TYPE_LABELS["liquidation"]).toBe("Liquidation");
    expect(MEV_TYPE_LABELS["jit"]).toBe("Just-in-Time Liquidity");
  });
});

// ─── CHAINS ───────────────────────────────────────────────────────────────────

describe("CHAINS", () => {
  it("includes mainnet, optimism, arbitrum, base", () => {
    expect(CHAINS).toHaveProperty("mainnet");
    expect(CHAINS).toHaveProperty("optimism");
    expect(CHAINS).toHaveProperty("arbitrum");
    expect(CHAINS).toHaveProperty("base");
  });

  it("each chain has required fields", () => {
    for (const [name, chain] of Object.entries(CHAINS)) {
      expect(chain.name).toBeTruthy();
      expect(chain.chainId).toBeGreaterThan(0);
      expect(chain.rpcUrl).toBeDefined(); // may be empty string — that's fine
      expect(chain.explorerUrl).toBeTruthy();
    }
  });

  it("has correct chain IDs", () => {
    expect(CHAINS.mainnet.chainId).toBe(1);
    expect(CHAINS.optimism.chainId).toBe(10);
    expect(CHAINS.arbitrum.chainId).toBe(42161);
    expect(CHAINS.base.chainId).toBe(8453);
  });

  it("mainnet explorer URL is etherscan.io", () => {
    expect(CHAINS.mainnet.explorerUrl).toBe("https://etherscan.io");
    expect(CHAINS.optimism.explorerUrl).toContain("optimistic.etherscan.io");
    expect(CHAINS.arbitrum.explorerUrl).toContain("arbiscan.io");
  });
});

// ─── Logger ───────────────────────────────────────────────────────────────────

describe("logger", () => {
  it("is a pino logger instance", () => {
    expect(logger).toBeTruthy();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("can log without throwing", () => {
    expect(() => logger.info("test log")).not.toThrow();
    expect(() => logger.warn("test warn")).not.toThrow();
    expect(() => logger.error("test error")).not.toThrow();
    expect(() => logger.debug("test debug")).not.toThrow();
  });
});