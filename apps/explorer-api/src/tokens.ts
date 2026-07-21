import { getProvider } from "@mev/rpc";
import { ethers } from "ethers";

const provider = getProvider();

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

export interface TokenInfo {
  symbol: string;
  decimals: number;
}

export interface FormattedAmount {
  value: number;
  symbol: string;
  tokenAddress: string | null | undefined;
}

// Known ERC-20s, so the common tokens never cost an RPC round-trip for their
// symbol/decimals (X3: extend the known-token registry). Majors, stablecoins,
// and liquid-staking tokens that dominate DEX volume — the more of a block's
// swaps resolve from here, the fewer eth_calls the capped node sees.
const KNOWN_TOKENS: Record<string, TokenInfo> = {
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { symbol: "WETH", decimals: 18 },
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6 },
  "0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", decimals: 6 },
  "0x6b175474e89094c44da98b954eedeac495271d0f": { symbol: "DAI", decimals: 18 },
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": { symbol: "WBTC", decimals: 8 },
  // stablecoins
  "0x4fabb145d64652a948d72533023f6e7a623c7c53": { symbol: "BUSD", decimals: 18 },
  "0x853d955acef822db058eb8505911ed77f175b99e": { symbol: "FRAX", decimals: 18 },
  "0x0000000000085d4780b73119b644ae5ecd22b376": { symbol: "TUSD", decimals: 18 },
  "0x5f98805a4e8be255a32880fdec7f6728c6568ba0": { symbol: "LUSD", decimals: 18 },
  "0x8e870d67f660d95d5be530380d0ec0bd388289e1": { symbol: "USDP", decimals: 18 },
  // liquid staking / wrapped ETH derivatives
  "0xae7ab96520de3a18e5e111b5eaab095312d7fe84": { symbol: "stETH", decimals: 18 },
  "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0": { symbol: "wstETH", decimals: 18 },
  "0xae78736cd615f374d3085123a210448e74fc6393": { symbol: "rETH", decimals: 18 },
  "0xac3e018457b222d93114458476f3e3416abbe38f": { symbol: "sfrxETH", decimals: 18 },
  // majors / governance
  "0x514910771af9ca656af840dff83e8264ecf986ca": { symbol: "LINK", decimals: 18 },
  "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": { symbol: "UNI", decimals: 18 },
  "0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0": { symbol: "MATIC", decimals: 18 },
  "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2": { symbol: "MKR", decimals: 18 },
  "0xd533a949740bb3306d119cc777fa900ba034cd52": { symbol: "CRV", decimals: 18 },
  "0x6982508145454ce325ddbe47a25d4ec3d2311933": { symbol: "PEPE", decimals: 18 },
  "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce": { symbol: "SHIB", decimals: 18 },
};

const cache = new Map<string, TokenInfo>(Object.entries(KNOWN_TOKENS));
// A block's swaps reference the same tokens over and over; getBlockMev fans
// out in parallel, so without in-flight dedup one busy block fires hundreds
// of duplicate symbol()/decimals() calls against the connection-capped node.
// This is the request-coalescing ADR-011 §3 keeps on top of the shared
// provider: batching bundles calls, but only coalescing avoids issuing the
// redundant eth_calls at all.
const pending = new Map<string, Promise<TokenInfo>>();

export async function getTokenInfo(address: string | null | undefined): Promise<TokenInfo> {
  if (!address) return { symbol: "?", decimals: 18 };
  const key = address.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const lookup = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const contract = new ethers.Contract(key, ERC20_ABI, provider);
      const info = await Promise.race([
        (async (): Promise<TokenInfo> => {
          const [symbol, decimals] = await Promise.all([contract.symbol(), contract.decimals()]);
          return { symbol, decimals: Number(decimals) };
        })(),
        // a degraded node can leave eth_call hanging indefinitely; block
        // rendering must not hang with it
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new TokenLookupTimeout()), RPC_LOOKUP_TIMEOUT_MS);
        }),
      ]);
      cache.set(key, info);
      return info;
    } catch (err) {
      const info: TokenInfo = { symbol: `${key.slice(0, 6)}…${key.slice(-4)}`, decimals: 18 };
      // don't poison the cache on node hiccups - the real symbol should
      // come back once the node recovers; real contract errors (no symbol()
      // on the token) are permanent and worth caching
      if (!(err instanceof TokenLookupTimeout)) cache.set(key, info);
      return info;
    } finally {
      clearTimeout(timer);
      pending.delete(key);
    }
  })();
  pending.set(key, lookup);
  return lookup;
}

const RPC_LOOKUP_TIMEOUT_MS = 5_000;
class TokenLookupTimeout extends Error {
  constructor() {
    super("token metadata lookup timed out");
  }
}

export async function formatAmount(
  rawAmount: string | null | undefined,
  tokenAddress: string | null | undefined,
): Promise<FormattedAmount | null> {
  if (rawAmount === null || rawAmount === undefined) return null;
  const { symbol, decimals } = await getTokenInfo(tokenAddress);
  const value = Number(rawAmount) / 10 ** decimals;
  return { value, symbol, tokenAddress };
}
