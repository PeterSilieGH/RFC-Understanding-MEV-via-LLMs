#!/usr/bin/env node
// CLI for the content-addressed .flat store prototype.
//
//   flat-store build  <projectsDir> [--out <dir>]   dedup + report (+ optionally write the store)
//   flat-store verify <projectsDir>                  build in memory, prove byte-exact round-trip
//
// <projectsDir> is a DiscoUI discovery projects folder, e.g.
//   l2beat/packages/config/src/projects
// It is only read; the store is written to --out (default: none, report only).

import { buildStore, collectFlatFiles, verifyRoundTrip, writeStore } from "./index.js";

function fmtBytes(n: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}

function parseOut(args: string[]): string | undefined {
  const i = args.indexOf("--out");
  return i >= 0 ? args[i + 1] : undefined;
}

function report(projectsDir: string, out: string | undefined): void {
  const files = collectFlatFiles(projectsDir);
  if (files.length === 0) {
    console.error(`no .flat files found under ${projectsDir}`);
    process.exit(1);
  }
  const result = buildStore(files);
  const s = result.stats;

  console.log(`\ncontent-addressed .flat store — ${projectsDir}\n`);
  console.log(`  projects with .flat : ${s.projects}`);
  console.log(`  flat files (total)  : ${s.files}`);
  console.log(`  on disk today       : ${fmtBytes(s.totalBytes)}`);
  console.log(`  unique blobs        : ${s.uniqueBlobs}`);
  console.log(`  content-addr store  : ${fmtBytes(s.storeBytes)}`);
  console.log(`  saved               : ${fmtBytes(s.bytesSaved)}  (${s.savedPct.toFixed(1)}%)`);
  console.log(
    `  normalized-unique   : ${s.normalizedUniqueBlobs}  (blobs if keyed pragma/whitespace-insensitively)`,
  );
  console.log("\n  most-duplicated sources:");
  for (const b of s.topShared) {
    console.log(
      `    ${String(b.refs).padStart(4)}×  ${fmtBytes(b.bytes).padStart(9)}  ${b.samplePath}`,
    );
  }

  if (out) {
    writeStore(out, result);
    console.log(`\n  store written to ${out}`);
  }

  const v = verifyRoundTrip(files, result);
  console.log(
    `\n  round-trip: ${v.ok ? "OK — every project reconstructs byte-exact" : `FAILED (${v.mismatches.length} mismatches)`}\n`,
  );
  if (!v.ok) process.exit(1);
}

function main(): void {
  const [cmd, projectsDir, ...rest] = process.argv.slice(2);
  if ((cmd !== "build" && cmd !== "verify") || !projectsDir) {
    console.error(
      "usage:\n  flat-store build <projectsDir> [--out <dir>]\n  flat-store verify <projectsDir>",
    );
    process.exit(1);
  }
  report(projectsDir, cmd === "build" ? parseOut(rest) : undefined);
}

main();
