// EUR price lookups for the "show in EUR" toggle. Uses CoinGecko's free
// public API - no key required, but rate-limited, so every price is cached
// for a few minutes and tokens are fetched one at a time rather than in
// parallel bursts.
export const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const CACHE_TTL_MS = 5 * 60 * 1000;
// A failed/unknown lookup (rate limit, transient network error, no price
// for this token) is cached much more briefly than a real price - 5
// minutes of confidently showing "no price available" because of one
// hiccup is worse than a few extra retries.
const FAILURE_CACHE_TTL_MS = 20 * 1000;

const cache = new Map<string, { eur: number | null; fetchedAt: number }>();

async function fetchEthEurPrice(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur",
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { ethereum?: { eur?: number } };
    return data?.ethereum?.eur ?? null;
  } catch {
    return null;
  }
}

async function fetchTokenEurPrice(address: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${address}&vs_currencies=eur`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { eur?: number }>;
    return data?.[address]?.eur ?? null;
  } catch {
    return null;
  }
}

async function getEurPrice(tokenAddress: string): Promise<number | null> {
  const key = tokenAddress.toLowerCase();
  const cached = cache.get(key);
  if (cached) {
    const ttl = cached.eur == null ? FAILURE_CACHE_TTL_MS : CACHE_TTL_MS;
    if (Date.now() - cached.fetchedAt < ttl) return cached.eur;
  }

  const price = key === WETH_ADDRESS ? await fetchEthEurPrice() : await fetchTokenEurPrice(key);
  cache.set(key, { eur: price, fetchedAt: Date.now() });
  return price;
}

export async function getEurPrices(
  tokenAddresses: string[],
): Promise<Record<string, number | null>> {
  const unique = [...new Set(tokenAddresses.map((a) => a.toLowerCase()))];
  const result: Record<string, number | null> = {};
  for (const addr of unique) {
    result[addr] = await getEurPrice(addr);
  }
  return result;
}
