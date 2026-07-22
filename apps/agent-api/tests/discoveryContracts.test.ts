import { describe, expect, it, vi } from "vitest";
import { DiscoveryContractLoader, UnverifiedContractError } from "../src/discoveryContracts.js";

describe("DiscoveryContractLoader", () => {
  it("hydrates one missing contract from disco-api and reuses project metadata", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith("/api/projects/trace-test")) {
        return Response.json({
          entries: [
            {
              blockNumbers: { eth: 21_000_000 },
              initialContracts: [
                {
                  address: "eth:0x0000000000000000000000000000000000000001",
                  name: "Pool",
                  chain: "eth",
                  fields: [{ name: "owner", value: { type: "address", address: "0xabc" } }],
                  abis: [
                    { entries: [{ value: "function swap(uint256)", signature: "0x12345678" }] },
                  ],
                },
              ],
              discoveredContracts: [],
            },
          ],
        });
      }
      return Response.json({
        entryName: "Pool",
        sources: [
          { name: "Pool.sol", code: "contract Pool { function swap(uint256) external {} }" },
        ],
      });
    });
    const loader = new DiscoveryContractLoader(
      "http://disco",
      "trace-test",
      fetchFn as typeof fetch,
    );
    const ref = { address: "eth:0x0000000000000000000000000000000000000001" };

    const [first, second] = await Promise.all([loader.load(ref), loader.load(ref)]);

    expect(first.codeContext).toContain("contract Pool");
    expect(first.valueContext).toContain("owner:");
    expect(first.valueContext).toContain("function swap(uint256)");
    expect(second).toEqual(first);
    expect(fetchFn.mock.calls.filter(([url]) => String(url).endsWith("/trace-test"))).toHaveLength(
      1,
    );
  });

  it("rejects contracts without verified source", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/code/")
        ? Response.json({ sources: [] })
        : Response.json({ entries: [] }),
    );
    const loader = new DiscoveryContractLoader(
      "http://disco",
      "trace-test",
      fetchFn as typeof fetch,
    );

    await expect(
      loader.load({ address: "eth:0x0000000000000000000000000000000000000002" }),
    ).rejects.toThrow("no verified contract source");
  });

  it("classifies explicit unverified contracts without calling the failing code endpoint", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/code/")) {
        return Response.json({ error: "Failed to fetch code" }, { status: 500 });
      }
      return Response.json({
        entries: [
          {
            initialContracts: [
              {
                address: "eth:0x0000000000000000000000000000000000000003",
                name: "",
                type: "Unverified",
                chain: "ethereum",
                fields: [],
                abis: [{ entries: [] }],
              },
            ],
            discoveredContracts: [],
          },
        ],
      });
    });
    const loader = new DiscoveryContractLoader(
      "http://disco",
      "trace-test",
      fetchFn as typeof fetch,
    );

    await expect(
      loader.load({ address: "eth:0x0000000000000000000000000000000000000003" }),
    ).rejects.toBeInstanceOf(UnverifiedContractError);
    expect(fetchFn.mock.calls.some(([url]) => String(url).includes("/code/"))).toBe(false);
  });
});
