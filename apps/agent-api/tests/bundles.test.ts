import { describe, expect, it } from "vitest";
import {
  contractCodehash,
  estimateTokens,
  opaqueUnverifiedBundle,
  parseGeneratedBundles,
} from "../src/bundles.js";

describe("ADR-012 typed bundles", () => {
  it("uses a deterministic code identity when runtime codehash is unavailable", () => {
    const contract = {
      address: "eth:0x0000000000000000000000000000000000000001",
      codeContext: "contract A {}",
    };
    expect(contractCodehash(contract)).toBe(contractCodehash(contract));
    expect(contractCodehash(contract)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("does not include a deployment address in the source fingerprint", () => {
    const code = "```\ncontract A {}\n```";
    const first = contractCodehash({
      address: "eth:0x0000000000000000000000000000000000000001",
      codeContext: `Flattened source code of A (eth:0x0000000000000000000000000000000000000001) on chain eth:\n${code}`,
    });
    const second = contractCodehash({
      address: "eth:0x0000000000000000000000000000000000000002",
      codeContext: `Flattened source code of A (eth:0x0000000000000000000000000000000000000002) on chain eth:\n${code}`,
    });
    expect(first).toBe(second);
  });

  it("parses joint MEV and vulnerability output", () => {
    const bundles = parseGeneratedBundles(
      JSON.stringify({
        bundles: [
          {
            kind: "mev",
            role: "pool",
            entryPoints: ["swap"],
            flowSummary: "tokens cross",
            notes: "ordering matters",
          },
          {
            kind: "vuln",
            role: "pool",
            entryPoints: ["swap"],
            flowSummary: "callback",
            notes: "reentrancy boundary",
          },
        ],
      }),
      ["mev", "vuln"],
    );
    expect(bundles.map((bundle) => bundle.kind)).toEqual(["mev", "vuln"]);
  });

  it("rejects a response that omits a requested kind", () => {
    expect(() =>
      parseGeneratedBundles(
        JSON.stringify({
          bundles: [{ kind: "mev", role: "x", entryPoints: [], flowSummary: "x", notes: "x" }],
        }),
        ["mev", "vuln"],
      ),
    ).toThrow("vuln");
  });

  it("estimates nonzero context cost", () => {
    expect(estimateTokens("grounded evidence")).toBeGreaterThan(0);
  });

  it("represents unverified runtime code without inventing entry points", () => {
    const bundle = opaqueUnverifiedBundle("mev");
    expect(bundle.role).toBe("Unverified runtime contract");
    expect(bundle.entryPoints).toEqual([]);
    expect(bundle.notes).toContain("evidence");
  });
});
