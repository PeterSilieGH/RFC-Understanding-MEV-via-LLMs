import { compareTraceAddress } from "./traces.js";
// Ports mev_inspect/sandwiches.py. A sandwich is a frontrun swap, one or more
// victim swaps on the same pool in the same direction by other senders, and a
// backrun swap that reverses the frontrun.
//
// Audit fix B3: mev-inspect-py excluded only three hardcoded router addresses
// as "not a sandwicher". A swap whose `to_address` is an unlisted router (the
// Universal Router, 1inch, 0x, CoW, …) fronting other users' same-pool swaps
// gets misread as a sandwich → false positives. We maintain a broader modern
// router set below. (The heuristic still only sees single-pool sandwiches —
// a documented limitation, left as-is.)
import type { Sandwich, Swap } from "./types.js";

// Known aggregators / routers whose own multi-user swaps must not be mistaken
// for a sandwicher's frontrun. Lowercased.
const ROUTER_ADDRESSES = new Set<string>([
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", // Uniswap V2 Router 02
  "0xe592427a0aece92de3edee1f18e0157c05861564", // Uniswap V3 SwapRouter
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", // Uniswap V3 SwapRouter02
  "0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b", // Uniswap Universal Router (old)
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad", // Uniswap Universal Router
  "0x66a9893cc07d91d95644aedd05d03f95e1dba8af", // Uniswap Universal Router (v1.2)
  "0x1111111254fb6c44bac0bed2854e76f90643097d", // 1inch v4 Router
  "0x1111111254eeb25477b68fb85ed929f73a960582", // 1inch v5 Router
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff", // 0x Exchange Proxy
  "0x9008d19f58aabd9ed0d60971565aa8510560ab41", // CoW Protocol GPv2Settlement
  "0x881d40237659c251811cec9c364ef91dc08d300c", // Metamask Swap Router
  "0xdef171fe48cf0115b1d80b88dc8eab59176fee57", // Paraswap v5
]);

export function getSandwiches(swaps: Swap[]): Sandwich[] {
  const orderedSwaps = [...swaps].sort(
    (a, b) =>
      a.transactionPosition - b.transactionPosition ||
      compareTraceAddress(a.traceAddress, b.traceAddress),
  );

  const sandwiches: Sandwich[] = [];
  for (let index = 0; index < orderedSwaps.length; index++) {
    const sandwich = getSandwichStartingWithSwap(
      orderedSwaps[index],
      orderedSwaps.slice(index + 1),
    );
    if (sandwich !== null) sandwiches.push(sandwich);
  }
  return sandwiches;
}

function getSandwichStartingWithSwap(frontSwap: Swap, restSwaps: Swap[]): Sandwich | null {
  const sandwicherAddress = frontSwap.toAddress;
  const sandwichedSwaps: Swap[] = [];

  if (ROUTER_ADDRESSES.has(sandwicherAddress)) return null;

  for (const otherSwap of restSwaps) {
    if (otherSwap.transactionHash === frontSwap.transactionHash) continue;
    if (otherSwap.contractAddress !== frontSwap.contractAddress) continue;

    if (
      otherSwap.tokenInAddress === frontSwap.tokenInAddress &&
      otherSwap.tokenOutAddress === frontSwap.tokenOutAddress &&
      otherSwap.fromAddress !== sandwicherAddress
    ) {
      sandwichedSwaps.push(otherSwap);
    } else if (
      otherSwap.tokenOutAddress === frontSwap.tokenInAddress &&
      otherSwap.tokenInAddress === frontSwap.tokenOutAddress &&
      otherSwap.fromAddress === sandwicherAddress
    ) {
      if (sandwichedSwaps.length > 0) {
        return {
          blockNumber: frontSwap.blockNumber,
          sandwicherAddress,
          frontrunSwap: frontSwap,
          backrunSwap: otherSwap,
          sandwichedSwaps,
          profitTokenAddress: frontSwap.tokenInAddress,
          profitAmount: otherSwap.tokenOutAmount - frontSwap.tokenInAmount,
        };
      }
    }
  }

  return null;
}
