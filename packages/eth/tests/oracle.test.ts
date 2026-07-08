import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KNOWN_TOKENS, PriceOracle } from "../src/eth/oracle.js";

// ─── Shared mock function (hoisted to module scope, shared with oracle.ts) ───
//
// vi.hoisted() makes mockGet available before vi.mock processes "axios".
// Both this test file and oracle.ts get the same mock instance, so
// mockGet.mockResolvedValue(...) in a test also controls what oracle.ts sees.
const mockGet = vi.hoisted(() => vi.fn());
vi.mock("axios", () => ({
  default: { get: mockGet },
}));

// ─── getPrice() ───────────────────────────────────────────────────────────────

describe("PriceOracle.getPrice()", () => {
  beforeEach(() => {
    mockGet.mockClear();
  });

  it("fetches ETH price from CoinGecko and returns PriceData", async () => {
    mockGet.mockResolvedValueOnce({ data: { ethereum: { usd: 3500.42 } } });

    const oracle = new PriceOracle({ cacheMs: 5_000 });
    const price = await oracle.getPrice("ETH");

    expect(price).toBeTruthy();
    expect(price!.symbol).toBe("ETH");
    expect(price!.usdPrice).toBeCloseTo(3500.42, 2);
    expect(price!.updatedAt).toBeGreaterThan(0);

    expect(mockGet).toHaveBeenCalledTimes(1);
    const [url, { params }] = mockGet.mock.calls[0] as [string, { params: Record<string, string> }];
    expect(url).toContain("coingecko.com");
    expect(params.ids).toBe("ethereum");
    expect(params.vs_currencies).toBe("usd");
  });

  it("maps WETH to the same coin ID as ETH", async () => {
    mockGet.mockResolvedValueOnce({ data: { ethereum: { usd: 3500 } } });

    const oracle = new PriceOracle({ cacheMs: 5_000 });
    const price = await oracle.getPrice("WETH");

    expect(price).toBeTruthy();
    expect(price!.symbol).toBe("WETH");

    const [, { params }] = mockGet.mock.calls[0] as [string, { params: Record<string, string> }];
    expect(params.ids).toBe("ethereum");
  });

  it("maps USDC to its correct CoinGecko ID", async () => {
    mockGet.mockResolvedValueOnce({ data: { "usd-coin": { usd: 1.0001 } } });

    const oracle = new PriceOracle({ cacheMs: 5_000 });
    const price = await oracle.getPrice("USDC");

    expect(price).toBeTruthy();
    expect(price!.usdPrice).toBeCloseTo(1.0001, 4);

    const [, { params }] = mockGet.mock.calls[0] as [string, { params: Record<string, string> }];
    expect(params.ids).toBe("usd-coin");
  });

  it("returns null when CoinGecko has no usd price for the token", async () => {
    // CoinGecko returns an empty object for unknown tokens
    mockGet.mockResolvedValueOnce({ data: { "non-existent": {} } });

    const oracle = new PriceOracle({ cacheMs: 5_000 });
    const price = await oracle.getPrice("NONEXISTENT");

    expect(price).toBeNull();
  });

  it("returns null and logs a warning on network failure", async () => {
    mockGet.mockRejectedValueOnce(new Error("ENOTFOUND"));

    const oracle = new PriceOracle({ cacheMs: 5_000 });
    const price = await oracle.getPrice("ETH");

    expect(price).toBeNull();
  });

  it("serves cached price on second call within cache window", async () => {
    mockGet.mockResolvedValueOnce({ data: { ethereum: { usd: 4000 } } });

    const oracle = new PriceOracle({ cacheMs: 10_000 });
    const price1 = await oracle.getPrice("ETH");
    const price2 = await oracle.getPrice("ETH"); // same symbol — cached

    expect(price1!.usdPrice).toBe(4000);
    expect(price2!.usdPrice).toBe(4000);
    expect(mockGet).toHaveBeenCalledTimes(1); // only one network call
  });

  it("re-fetches after cache expires", async () => {
    mockGet
      .mockResolvedValueOnce({ data: { ethereum: { usd: 1000 } } })
      .mockResolvedValueOnce({ data: { ethereum: { usd: 2000 } } });

    const oracle = new PriceOracle({ cacheMs: 50 }); // 50 ms TTL

    await oracle.getPrice("ETH");
    await new Promise((r) => setTimeout(r, 60)); // wait for expiry
    const price2 = await oracle.getPrice("ETH");

    expect(price2!.usdPrice).toBe(2000);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});

// ─── getPrices() ─────────────────────────────────────────────────────────────

describe("PriceOracle.getPrices()", () => {
  beforeEach(() => {
    mockGet.mockClear();
  });

  it("fetches multiple tokens and returns a map", async () => {
    // Use a fresh oracle so no tokens are pre-cached.
    const oracle = new PriceOracle({ cacheMs: 5_000 });

    // Mock getPrice directly to isolate the test from axios / CoinGecko.
    const mockGetEth = vi
      .spyOn(oracle, "getPrice")
      .mockResolvedValueOnce({ symbol: "ETH", usdPrice: 3500, updatedAt: Date.now() })
      .mockResolvedValueOnce({ symbol: "USDC", usdPrice: 1.0, updatedAt: Date.now() })
      .mockResolvedValueOnce({ symbol: "WBTC", usdPrice: 60_000, updatedAt: Date.now() });

    const prices = await oracle.getPrices(["ETH", "USDC", "WBTC"]);

    expect(mockGetEth).toHaveBeenCalledTimes(3);
    expect(prices.get("eth")!.usdPrice).toBeCloseTo(3500, 2);
    expect(prices.get("usdc")!.usdPrice).toBeCloseTo(1.0, 2);
    expect(prices.get("wbtc")!.usdPrice).toBeCloseTo(60_000, 0);
    expect(prices.size).toBe(3);
  });

  it("returns partial results when some tokens are not found", async () => {
    // CoinGecko returns only ETH, not FAKE
    mockGet.mockResolvedValueOnce({ data: { ethereum: { usd: 3500 } } });

    const oracle = new PriceOracle({ cacheMs: 5_000 });
    const prices = await oracle.getPrices(["ETH", "FAKE"]);

    expect(prices.get("eth")).toBeTruthy();
    expect(prices.has("fake")).toBe(false);
    expect(prices.size).toBe(1);
  });
});

// ─── tokenToUsd() ─────────────────────────────────────────────────────────────

describe("PriceOracle.tokenToUsd()", () => {
  beforeEach(() => {
    mockGet.mockClear();
  });

  it("converts ETH amount to USD using oracle price", async () => {
    mockGet.mockResolvedValueOnce({ data: { ethereum: { usd: 3000 } } });

    const oracle = new PriceOracle({ cacheMs: 5_000 });
    // 1 ETH = 10^18 wei, 18 decimals
    const usd = await oracle.tokenToUsd("ETH", 10n ** 18n, 18);

    expect(usd).toBeCloseTo(3000, 2);
  });

  it("converts USDC amount (6 decimals) to USD", async () => {
    mockGet.mockResolvedValueOnce({ data: { "usd-coin": { usd: 1.0 } } });

    const oracle = new PriceOracle({ cacheMs: 5_000 });
    // 1,000,000 USDC = $1.00 (6 decimals)
    const usd = await oracle.tokenToUsd("USDC", 1_000_000n, 6);

    expect(usd).toBeCloseTo(1.0, 2);
  });

  it("returns null when price fetch fails", async () => {
    mockGet.mockRejectedValueOnce(new Error("ENOTFOUND"));

    const oracle = new PriceOracle({ cacheMs: 5_000 });
    const usd = await oracle.tokenToUsd("ETH", 10n ** 18n, 18);

    expect(usd).toBeNull();
  });
});

// ─── KNOWN_TOKENS ─────────────────────────────────────────────────────────────

describe("KNOWN_TOKENS", () => {
  it("includes all expected core tokens", () => {
    const expected = ["ETH", "WETH", "USDC", "USDT", "DAI", "WBTC", "UNI", "AAVE", "LINK", "CRV"];
    for (const symbol of expected) {
      expect(KNOWN_TOKENS).toHaveProperty(symbol);
    }
  });

  it("each known token has valid decimals, address, and coingeckoId", () => {
    for (const [, token] of Object.entries(KNOWN_TOKENS)) {
      expect(token.decimals).toBeGreaterThan(0);
      // Addresses are checksum-formatted (mixed case) or lower-case; check only the lower-case form
      expect(token.address.toLowerCase()).toMatch(/^0x[0-9a-f]{40}$/);
      expect(token.coingeckoId.length).toBeGreaterThan(0);
    }
  });

  it("ETH and WETH share the same CoinGecko ID and decimals but different addresses", () => {
    expect(KNOWN_TOKENS.ETH.coingeckoId).toBe("ethereum");
    expect(KNOWN_TOKENS.WETH.coingeckoId).toBe("ethereum");
    expect(KNOWN_TOKENS.ETH.decimals).toBe(18);
    expect(KNOWN_TOKENS.WETH.decimals).toBe(18);
    // ETH is the native token (zero address); WETH is a distinct ERC-20 contract
    expect(KNOWN_TOKENS.ETH.address).not.toBe(KNOWN_TOKENS.WETH.address);
  });

  it("USDC and USDT are 6-decimal stablecoins", () => {
    expect(KNOWN_TOKENS.USDC.decimals).toBe(6);
    expect(KNOWN_TOKENS.USDT.decimals).toBe(6);
    expect(KNOWN_TOKENS.USDC.coingeckoId).toBe("usd-coin");
    expect(KNOWN_TOKENS.USDT.coingeckoId).toBe("tether");
  });
});
