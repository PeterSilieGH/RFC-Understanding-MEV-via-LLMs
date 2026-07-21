import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildStore,
  collectFlatFiles,
  deduplicateProjectInPlace,
  normalizeFlat,
  sha256,
  verifyRoundTrip,
} from "../src/index.js";

// Two projects that both flatten the same WETH source (byte-identical) plus one
// project-unique file — the exact shape that makes trace-* output balloon.
const WETH =
  "// SPDX-License-Identifier: MIT\npragma solidity 0.8.19;\n\ncontract WETH { function deposit() external payable {} }\n";
const POOL = "// SPDX-License-Identifier: MIT\npragma solidity 0.8.19;\n\ncontract Pool { }\n";
// Same WETH logic, different pragma line — dedups only under normalization.
const WETH_OTHER_PRAGMA = WETH.replace("0.8.19", "0.8.20");

describe("content-addressed .flat store", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "flat-store-"));
    const write = (project: string, path: string, content: string) => {
      const abs = join(root, project, ".flat", path);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content);
    };
    write("trace-a", "WETH.sol", WETH);
    write("trace-a", "Pool-eth:0xaaa.sol", POOL);
    write("trace-b", "WETH.sol", WETH); // identical duplicate across projects
    write("trace-b", "WETH2.sol", WETH_OTHER_PRAGMA); // same logic, other pragma
    mkdirSync(join(root, "not-a-project"), { recursive: true }); // no .flat -> skipped
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("collects only .sol files under */.flat", () => {
    const files = collectFlatFiles(root);
    expect(files).toHaveLength(4);
    expect(new Set(files.map((f) => f.project))).toEqual(new Set(["trace-a", "trace-b"]));
  });

  it("deduplicates byte-identical sources across projects", () => {
    const result = buildStore(collectFlatFiles(root));
    // WETH (shared) + Pool + WETH_OTHER_PRAGMA = 3 distinct raw blobs from 4 files
    expect(result.stats.files).toBe(4);
    expect(result.stats.uniqueBlobs).toBe(3);
    expect(result.stats.bytesSaved).toBe(Buffer.byteLength(WETH, "utf8"));

    const wethBlob = result.stats.topShared.find((b) => b.hash === sha256(WETH));
    expect(wethBlob?.refs).toBe(2);
  });

  it("reports extra dedup a normalized key would unlock", () => {
    const result = buildStore(collectFlatFiles(root));
    // WETH and WETH_OTHER_PRAGMA collapse once the pragma line is stripped
    expect(result.stats.normalizedUniqueBlobs).toBe(2);
    expect(normalizeFlat(WETH)).toBe(normalizeFlat(WETH_OTHER_PRAGMA));
  });

  it("reconstructs every project byte-exact from the store", () => {
    const files = collectFlatFiles(root);
    const v = verifyRoundTrip(files, buildStore(files));
    expect(v.ok).toBe(true);
    expect(v.mismatches).toEqual([]);
  });

  it("deduplicates generated projects in place while preserving their paths", () => {
    const store = join(root, ".flat-store");
    const first = deduplicateProjectInPlace(join(root, "trace-a"), store);
    const second = deduplicateProjectInPlace(join(root, "trace-b"), store);
    expect(first?.entries).toHaveLength(2);
    expect(second?.entries).toHaveLength(2);
    const a = join(root, "trace-a", ".flat", "WETH.sol");
    const b = join(root, "trace-b", ".flat", "WETH.sol");
    expect(readFileSync(a, "utf8")).toBe(WETH);
    expect(readFileSync(b, "utf8")).toBe(WETH);
    expect(statSync(a).ino).toBe(statSync(b).ino);
  });
});
