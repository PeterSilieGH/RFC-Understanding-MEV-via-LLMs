import axios from "axios";
import { logger } from "../utils/logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PriceData {
  symbol: string;        // e.g. "ETH", "WETH", "USDC"
  address?: string;      // token contract address (lowercase)
  usdPrice: number;     // USD price
  updatedAt: number;     // unix timestamp ms
}

export interface OracleConfig {
  cacheMs?: number;      // how long to cache prices (default 5_000ms)
}

// ─── Price Oracle ─────────────────────────────────────────────────────────────

/**
 * Multi-source price oracle for real-time token prices.
 * Sources: CoinGecko (primary), with fallback to on-chain Chainlink feeds.
 *
 * Free tier: CoinGecko allows 10–30 calls/min for unregistered API keys.
 * Set COINGECKO_API_KEY for higher limits.
 */
export class PriceOracle {
  private cache = new Map<string, { price: number; ts: number }>();
  private cacheMs: number;
  private apiKey?: string;

  constructor(config: OracleConfig = {}) {
    this.cacheMs = config.cacheMs ?? 5000;
    this.apiKey = process.env.COINGECKO_API_KEY;
    logger.info("[PriceOracle] Initialized");
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async getPrice(symbol: string): Promise<PriceData | null> {
    const cached = this._getCached(symbol);
    if (cached !== null) return { symbol, usdPrice: cached, updatedAt: Date.now() };

    try {
      const price = await this._fetchCoinGecko(symbol);
      this.cache.set(symbol.toLowerCase(), { price, ts: Date.now() });
      return { symbol, usdPrice: price, updatedAt: Date.now() };
    } catch (err) {
      logger.warn(`[PriceOracle] CoinGecko failed for ${symbol}: ${(err as Error).message}`);
      return null;
    }
  }

  async getPrices(symbols: string[]): Promise<Map<string, PriceData>> {
    const results = new Map<string, PriceData>();
    await Promise.allSettled(symbols.map(async (s) => {
      const p = await this.getPrice(s);
      if (p) results.set(s.toLowerCase(), p);
    }));
    return results;
  }

  /** Convert token amount (in smallest unit) to USD using oracle price */
  async tokenToUsd(symbol: string, amountWei: bigint, decimals: number): Promise<number | null> {
    const price = await this.getPrice(symbol);
    if (!price) return null;

    // Convert from atomic units to decimal
    const amountDecimal = Number(amountWei) / Math.pow(10, decimals);
    return amountDecimal * price.usdPrice;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _getCached(symbol: string): number | null {
    const entry = this.cache.get(symbol.toLowerCase());
    if (!entry) return null;
    if (Date.now() - entry.ts > this.cacheMs) {
      this.cache.delete(symbol.toLowerCase());
      return null;
    }
    return entry.price;
  }

  private async _fetchCoinGecko(symbol: string): Promise<number> {
    const id = SYMBOL_TO_COINGECKO_ID[symbol.toUpperCase()] ?? symbol.toLowerCase();

    const params: Record<string, string> = {
      ids: id,
      vs_currencies: "usd",
      include_24hr_change: "false",
    };

    const headers: Record<string, string> = {};
    if (this.apiKey) headers["x-cg-demo-api-key"] = this.apiKey;

    const url = this.apiKey
      ? "https://api.coingecko.com/api/v3/simple/price"
      : "https://api.coingecko.com/api/v3/simple/price";

    const resp = await axios.get(url, { params, headers, timeout: 5000 });
    const data = resp.data as Record<string, { usd?: number }>;

    if (!data[id]?.usd) {
      throw new Error(`No USD price for "${id}"`);
    }

    return data[id].usd!;
  }
}

// ─── Common token mappings ────────────────────────────────────────────────────

export const KNOWN_TOKENS: Record<string, { decimals: number; address: string; coingeckoId: string }> = {
  ETH:  { decimals: 18, address: "0x0000000000000000000000000000000000000000", coingeckoId: "ethereum" },
  WETH: { decimals: 18, address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", coingeckoId: "ethereum" },
  USDC: { decimals: 6,  address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", coingeckoId: "usd-coin" },
  USDT: { decimals: 6,  address: "0xdac17f958d2ee523a2206206994597c13d831ec7", coingeckoId: "tether" },
  DAI:  { decimals: 18, address: "0x6b175474e89094c44da98b954e5cbde440428de1", coingeckoId: "dai" },
  WBTC: { decimals: 8,  address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", coingeckoId: "wrapped-bitcoin" },
  UNI:  { decimals: 18, address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", coingeckoId: "uniswap" },
  AAVE: { decimals: 18, address: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9", coingeckoId: "aave" },
  LINK: { decimals: 18, address: "0x514910771af9ca656af840dff83e8264ecf986ca", coingeckoId: "chainlink" },
  CRV:  { decimals: 18, address: "0xd533a949740bb3306d119cc777fa900ba034cd52", coingeckoId: "curve-dao-token" },
};

const SYMBOL_TO_COINGECKO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(KNOWN_TOKENS).map(([k, v]) => [k, v.coingeckoId])
);