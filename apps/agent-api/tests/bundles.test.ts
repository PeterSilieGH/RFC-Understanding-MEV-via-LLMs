import { describe, expect, it } from "vitest";
import {
  BUNDLE_ANALYZER_VERSION,
  BUNDLE_PROMPT_VERSION,
  BUNDLE_SCHEMA_VERSION,
  buildChildBundlePrompt,
  contractCodehash,
  estimateTokens,
  opaqueUnverifiedBundle,
  parseChildBundle,
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

  it("strictly accepts the versioned vulnerability bug/exploit schema", () => {
    const artifactRef = "source:verified:abc";
    const payload = parseChildBundle(
      JSON.stringify({
        bundle: {
          kind: "vuln",
          role: "vault",
          sourceQuality: "verified",
          artifactProvenance: artifactRef,
          assetsAtRisk: ["deposits"],
          trustBoundaries: ["external strategy"],
          attackSurface: [
            {
              entryPoint: "withdraw(uint256)",
              access: "depositor",
              effects: "reduces shares and transfers assets",
              evidence: ["withdraw selector"],
            },
          ],
          invariants: ["assets cover shares"],
          hypotheses: [
            {
              class: "reentrancy",
              locus: "withdraw external transfer",
              prerequisites: ["attacker-controlled receiver"],
              exploitPath: "reenter before accounting completes",
              impact: "excess withdrawal",
              evidence: ["external call precedes state write"],
              confidence: "likely",
              counterEvidence: ["guard may exist in inherited modifier"],
            },
          ],
          unknowns: ["deployment role configuration"],
        },
      }),
      "vuln",
      "verified",
      artifactRef,
    );
    expect(payload.kind).toBe("vuln");
    expect(BUNDLE_SCHEMA_VERSION).toBe(2);
    expect(BUNDLE_PROMPT_VERSION.vuln).toContain("vulnerability");
    expect(BUNDLE_ANALYZER_VERSION).toContain("adr016");
  });

  it("rejects extra fields and model-authored provenance", () => {
    const base = {
      kind: "vuln",
      role: "vault",
      sourceQuality: "decompiled",
      artifactProvenance: "wrong",
      assetsAtRisk: [],
      trustBoundaries: [],
      attackSurface: [],
      invariants: [],
      hypotheses: [],
      unknowns: [],
    };
    expect(() =>
      parseChildBundle(JSON.stringify({ bundle: base }), "vuln", "verified", "source:abc"),
    ).toThrow("provenance");
    expect(() =>
      parseChildBundle(
        JSON.stringify({ bundle: { ...base, extra: "not allowed" } }),
        "vuln",
        "decompiled",
        "wrong",
      ),
    ).toThrow("strict schema");
  });

  it("gives a code-only child no cast or recursive tool instructions", () => {
    const prompt = buildChildBundlePrompt({
      kind: "mev",
      candidateId: "a".repeat(24),
      artifactRef: "decompilation:abc",
      sourceQuality: "decompiled",
      entries: [
        {
          contract: "Recovered",
          name: "unknown12345678",
          signature: "def unknown12345678(?)",
          body: "def unknown12345678(_param1): pass",
        },
      ],
    });
    expect(prompt).toContain("Panoramix");
    expect(prompt).toContain("no cast, RPC");
    expect(prompt).toContain("get_function_code");
  });
});
