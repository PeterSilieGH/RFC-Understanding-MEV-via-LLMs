import { beforeEach, describe, expect, it, vi } from "vitest";

const getBundleVersion = vi.fn();
const saveBundleVersion = vi.fn();
const addBundleAddresses = vi.fn();
const resolveAnalysisEvidence = vi.fn();

vi.mock("../src/store.js", () => ({
  getBundleVersion,
  saveBundleVersion,
  addBundleAddresses,
}));
vi.mock("../src/analysisEvidence.js", () => ({ resolveAnalysisEvidence }));

const { buildContractAnalysisConfig } = await import("../src/contractAnalysis.js");
type Candidate = Parameters<typeof buildContractAnalysisConfig>[0]["candidates"][number];

function candidate(id: string, address: string): Candidate {
  return {
    id,
    artifactRef: `artifact:${id}`,
    address,
    name: `C-${id}`,
    runtimeCodehash: `0x${"a".repeat(63)}${id.length}`,
    sourceStatus: "verified",
    proxyType: null,
    implementationAddresses: [],
    snapshot: { blockNumber: 1, blockHash: `0x${"b".repeat(64)}`, timestamp: 1 },
  };
}

const MEV_REPORT = JSON.stringify({
  bundle: {
    kind: "mev",
    role: "Router",
    entryPoints: ["swap()"],
    mechanism: "routes swaps",
    orderingConstraints: [],
    valueFlows: [],
    risks: [],
    evidence: ["selector 0x1"],
    unknowns: [],
  },
});

function evidenceFor(c: Candidate) {
  return {
    candidateId: c.id,
    artifactRef: c.artifactRef,
    address: c.address,
    name: c.name,
    runtimeCodehash: c.runtimeCodehash,
    sourceQuality: "verified" as const,
    entries: [],
    provenance: {
      kind: "source",
      provider: "etherscan",
      revision: "1",
      contentHash: null,
      status: "verified",
      warnings: [],
    },
    limitations: [],
  };
}

describe("ADR-016 lazy contract analysis", () => {
  beforeEach(() => {
    getBundleVersion.mockReset();
    saveBundleVersion.mockReset();
    addBundleAddresses.mockReset();
    resolveAnalysisEvidence.mockReset();
  });

  it("only authorizes the supplied candidate ids", () => {
    const config = buildContractAnalysisConfig({
      project: "p",
      kind: "mev",
      candidates: [candidate("1", "0x1111111111111111111111111111111111111111")],
      consulted: [],
      compact: [],
    });
    expect([...config.candidateIds]).toEqual(["1"]);
  });

  it("rejects a candidate that is not in the authorized selection", async () => {
    const config = buildContractAnalysisConfig({
      project: "p",
      kind: "mev",
      candidates: [candidate("1", "0x1111111111111111111111111111111111111111")],
      consulted: [],
      compact: [],
    });
    const child = { run: vi.fn() };
    const result = await config.analyze("nope", child);
    expect(result.status).toBe("error");
    expect(child.run).not.toHaveBeenCalled();
    expect(resolveAnalysisEvidence).not.toHaveBeenCalled();
  });

  it("serves a current cached bundle without launching a child", async () => {
    const c = candidate("1", "0x1111111111111111111111111111111111111111");
    resolveAnalysisEvidence.mockResolvedValue(evidenceFor(c));
    getBundleVersion.mockResolvedValue({
      codehash: c.runtimeCodehash,
      kind: "mev",
      addresses: [c.address],
      role: "Cached router",
      status: "current",
      updatedAt: "2026-07-23T00:00:00Z",
    });
    const consulted: Parameters<typeof buildContractAnalysisConfig>[0]["consulted"] = [];
    const compact: Parameters<typeof buildContractAnalysisConfig>[0]["compact"] = [];
    const config = buildContractAnalysisConfig({
      project: "p",
      kind: "mev",
      candidates: [c],
      consulted,
      compact,
    });
    const child = { run: vi.fn() };
    const result = await config.analyze("1", child);
    expect(result.status).toBe("cached");
    expect(child.run).not.toHaveBeenCalled();
    expect(saveBundleVersion).not.toHaveBeenCalled();
    expect(compact[0]).toMatchObject({ candidateId: "1", status: "cached" });
    expect(consulted).toHaveLength(1);
  });

  it("coalesces two concurrent identical requests into one child + one save", async () => {
    const c = candidate("2", "0x2222222222222222222222222222222222222222");
    resolveAnalysisEvidence.mockResolvedValue(evidenceFor(c));
    getBundleVersion.mockResolvedValue(null);
    saveBundleVersion.mockResolvedValue({
      codehash: c.runtimeCodehash,
      kind: "mev",
      addresses: [c.address],
      role: "Router",
      status: "current",
      updatedAt: "2026-07-23T00:00:00Z",
    });
    let resolveChild: (v: { report: string; transcript: string }) => void = () => {};
    const child = {
      run: vi.fn(
        () =>
          new Promise<{ report: string; transcript: string }>((resolve) => {
            resolveChild = resolve;
          }),
      ),
    };
    const config = buildContractAnalysisConfig({
      project: "p",
      kind: "mev",
      candidates: [c],
      consulted: [],
      compact: [],
    });
    const first = config.analyze("2", child);
    const second = config.analyze("2", child);
    await new Promise((r) => setTimeout(r, 10));
    resolveChild({ report: MEV_REPORT, transcript: "" });
    const [a, b] = await Promise.all([first, second]);
    expect(child.run).toHaveBeenCalledTimes(1);
    expect(saveBundleVersion).toHaveBeenCalledTimes(1);
    expect(a.status).toBe("bundle");
    expect(b.status).toBe("bundle");
  });
});
