import { describe, expect, it } from "vitest";
import { equalWithinPercent, getArbitrages } from "../src/arbitrages.js";
import { getSandwiches } from "../src/sandwiches.js";
import type { Swap } from "../src/types.js";

function swap(over: Partial<Swap>): Swap {
  return {
    abiName: "UniswapV2Pair",
    transactionHash: "0xtx",
    transactionPosition: 0,
    blockNumber: 1,
    traceAddress: [0],
    contractAddress: "0xpool",
    fromAddress: "0xbot",
    toAddress: "0xbot",
    tokenInAddress: "0xa",
    tokenInAmount: 100n,
    tokenOutAddress: "0xb",
    tokenOutAmount: 100n,
    protocol: "uniswap_v2",
    error: null,
    ...over,
  };
}

describe("equalWithinPercent (audit B1: zero-amount guard)", () => {
  it("treats two zero legs as equal instead of dividing by zero", () => {
    expect(equalWithinPercent(0n, 0n, 0.01)).toBe(true);
  });
  it("is false when only one leg is zero", () => {
    expect(equalWithinPercent(0n, 100n, 0.01)).toBe(false);
  });
  it("matches within threshold and rejects outside it", () => {
    expect(equalWithinPercent(1000n, 1005n, 0.01)).toBe(true);
    expect(equalWithinPercent(1000n, 1200n, 0.01)).toBe(false);
  });
});

describe("getArbitrages", () => {
  it("detects a two-swap round trip returning the initial token at a profit", () => {
    const swap1 = swap({
      contractAddress: "0xpoolab",
      tokenInAddress: "0xa",
      tokenInAmount: 100n,
      tokenOutAddress: "0xb",
      tokenOutAmount: 100n,
      traceAddress: [0],
    });
    const swap2 = swap({
      contractAddress: "0xpoolba",
      tokenInAddress: "0xb",
      tokenInAmount: 100n,
      tokenOutAddress: "0xa",
      tokenOutAmount: 110n,
      traceAddress: [1],
    });
    const arbs = getArbitrages([swap1, swap2]);
    expect(arbs).toHaveLength(1);
    expect(arbs[0].profitTokenAddress).toBe("0xa");
    expect(arbs[0].profitAmount).toBe(10n);
    expect(arbs[0].swaps).toHaveLength(2);
  });
});

describe("getSandwiches", () => {
  const attacker = "0xattacker";
  const front = swap({
    transactionHash: "0xf",
    transactionPosition: 0,
    contractAddress: "0xp",
    tokenInAddress: "0xa",
    tokenOutAddress: "0xb",
    tokenInAmount: 50n,
    fromAddress: attacker,
    toAddress: attacker,
  });
  const victim = swap({
    transactionHash: "0xv",
    transactionPosition: 1,
    contractAddress: "0xp",
    tokenInAddress: "0xa",
    tokenOutAddress: "0xb",
    fromAddress: "0xvictim",
    toAddress: "0xvictim",
  });
  const back = swap({
    transactionHash: "0xb",
    transactionPosition: 2,
    contractAddress: "0xp",
    tokenInAddress: "0xb",
    tokenOutAddress: "0xa",
    tokenOutAmount: 60n,
    fromAddress: attacker,
    toAddress: attacker,
  });

  it("detects a frontrun/victim/backrun sandwich and its profit", () => {
    const sandwiches = getSandwiches([front, victim, back]);
    expect(sandwiches).toHaveLength(1);
    expect(sandwiches[0].sandwicherAddress).toBe(attacker);
    expect(sandwiches[0].profitAmount).toBe(10n); // back out 60 - front in 50
    expect(sandwiches[0].sandwichedSwaps).toHaveLength(1);
  });

  it("audit B3: does not treat a known router's swap as the sandwicher", () => {
    const routerFront = { ...front, toAddress: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af" }; // Universal Router
    const routerBack = { ...back, fromAddress: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af" };
    expect(getSandwiches([routerFront, victim, routerBack])).toHaveLength(0);
  });
});
