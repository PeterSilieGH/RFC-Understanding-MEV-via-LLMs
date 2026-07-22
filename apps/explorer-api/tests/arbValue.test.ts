import { describe, expect, it } from "vitest";
import type { ArbDelta } from "../src/arbValue.js";
import { valueArb } from "../src/arbValue.js";
import { WETH_ADDRESS } from "../src/eurPrices.js";
import { type SwapRateInput, buildEthPriceGraph } from "../src/onchainPrices.js";

const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const DAI = "0x6b175474e89094c44da98b954eedeac495271d0f";
const FOO = "0x00000000000000000000000000000000000000f0";

const DECIMALS: Record<string, number> = {
  [WETH_ADDRESS]: 18,
  [USDC]: 6,
  [DAI]: 18,
  [FOO]: 18,
};
const dec = (t: string) => DECIMALS[t.toLowerCase()] ?? 18;

const pow = (n: number) => 10n ** BigInt(n);

describe("buildEthPriceGraph", () => {
  it("prices WETH at 1 and a direct pair from the observed rate", () => {
    // 1 WETH -> 3000 USDC
    const swaps: SwapRateInput[] = [
      {
        tokenInAddress: WETH_ADDRESS,
        tokenInAmountRaw: (1n * pow(18)).toString(),
        tokenOutAddress: USDC,
        tokenOutAmountRaw: (3000n * pow(6)).toString(),
      },
    ];
    const prices = buildEthPriceGraph(swaps, dec);
    expect(prices.get(WETH_ADDRESS)).toBe(1);
    expect(prices.get(USDC)).toBeCloseTo(1 / 3000, 12);
  });

  it("chains a rate through an intermediate token to reach WETH", () => {
    const swaps: SwapRateInput[] = [
      {
        tokenInAddress: WETH_ADDRESS,
        tokenInAmountRaw: (1n * pow(18)).toString(),
        tokenOutAddress: USDC,
        tokenOutAmountRaw: (3000n * pow(6)).toString(),
      },
      // 3000 USDC -> 3000 DAI (1:1)
      {
        tokenInAddress: USDC,
        tokenInAmountRaw: (3000n * pow(6)).toString(),
        tokenOutAddress: DAI,
        tokenOutAmountRaw: (3000n * pow(18)).toString(),
      },
    ];
    const prices = buildEthPriceGraph(swaps, dec);
    expect(prices.get(DAI)).toBeCloseTo(1 / 3000, 12);
  });

  it("omits tokens with no path to WETH", () => {
    const swaps: SwapRateInput[] = [
      {
        tokenInAddress: USDC,
        tokenInAmountRaw: (100n * pow(6)).toString(),
        tokenOutAddress: FOO,
        tokenOutAmountRaw: (5n * pow(18)).toString(),
      },
    ];
    const prices = buildEthPriceGraph(swaps, dec);
    expect(prices.has(FOO)).toBe(false);
    expect(prices.has(USDC)).toBe(false);
  });
});

function arb(deltas: Record<string, bigint>): ArbDelta {
  return {
    arbitrageId: "a1",
    transactionHash: "0xabc",
    blockNumber: 1,
    deltas: new Map(Object.entries(deltas).map(([k, v]) => [k.toLowerCase(), v])),
  };
}

const decimalsMap = new Map(Object.entries(DECIMALS));
const onchain = new Map([
  [WETH_ADDRESS, { ethPrice: 1, method: "onchain" as const }],
  [USDC, { ethPrice: 1 / 3000, method: "onchain" as const }],
]);

describe("valueArb", () => {
  it("values a single-token (classic cyclic) profit", () => {
    const v = valueArb(arb({ [USDC]: 1200n * pow(6) }), onchain, decimalsMap);
    expect(v.ethValue).toBeCloseTo(0.4, 9); // 1200 / 3000
    expect(v.unpricedTokens).toHaveLength(0);
  });

  it("aggregates a multi-token delta (the ADR-014 fix)", () => {
    const v = valueArb(
      arb({ [USDC]: 1200n * pow(6), [WETH_ADDRESS]: -(5n * pow(16)) }), // -0.05 WETH
      onchain,
      decimalsMap,
    );
    expect(v.ethValue).toBeCloseTo(0.4 - 0.05, 9);
    expect(v.breakdown).toHaveLength(2);
  });

  it("excludes and flags an unpriced token, keeping priced ones", () => {
    const prices = new Map(onchain);
    prices.set(FOO, { ethPrice: null, method: "unpriced" });
    const v = valueArb(arb({ [USDC]: 1200n * pow(6), [FOO]: 100n * pow(18) }), prices, decimalsMap);
    expect(v.ethValue).toBeCloseTo(0.4, 9); // FOO excluded
    expect(v.unpricedTokens).toEqual([FOO]);
  });

  it("drops dust residuals from intermediate hops", () => {
    const v = valueArb(arb({ [USDC]: 1200n * pow(6), [DAI]: 1n }), onchain, decimalsMap);
    // DAI delta of 1 wei is below the relative dust floor and never valued
    expect(v.breakdown.some((b) => b.token === DAI)).toBe(false);
  });
});
