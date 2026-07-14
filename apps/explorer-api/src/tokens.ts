import { loadConfig } from "@mev/config";
import { ethers } from "ethers";

const config = loadConfig();
const provider = new ethers.JsonRpcProvider(config.RPC_URL);

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

const KNOWN_TOKENS: Record<string, TokenInfo> = {
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { symbol: "WETH", decimals: 18 },
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6 },
  "0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", decimals: 6 },
  "0x6b175474e89094c44da98b954eedeac495271d0f": { symbol: "DAI", decimals: 18 },
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": { symbol: "WBTC", decimals: 8 },
};

const cache = new Map<string, TokenInfo>(Object.entries(KNOWN_TOKENS));
// A block's swaps reference the same tokens over and over; getBlockMev fans
// out in parallel, so without in-flight dedup one busy block fires hundreds
// of duplicate symbol()/decimals() calls - each holding an RPC connection
// (the shared node enforces a server-side connection cap).
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
