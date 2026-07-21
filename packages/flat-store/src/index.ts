// Prototype: a content-addressed store for DiscoUI `.flat` sources.
//
// Background (see docs / l2beat discovery): each discovery project writes a
// `.flat/` folder of flattened Solidity, one `*.sol` per contract. The same
// contracts recur across projects — WETH, USDC, UniswapV3Pool, … — so the
// synthetic per-incident `trace-*` projects end up storing byte-identical
// copies of the same source over and over.
//
// l2beat already content-addresses *config* (templates keyed by a flattening
// hash, so N instances share one template.jsonc). This prototype applies the
// same idea to the *source bodies*: hash each flattened file, store every
// distinct blob once under its hash, and reduce each project to a manifest of
// `path -> hash`. `discovered.json` already records `sourceHashes` per entry,
// so referencing by hash is a natural fit.
//
// The store keys blobs by the raw content hash, so rehydration is byte-exact
// (lossless round-trip). A second, normalized hash (SPDX+pragma header
// stripped, trimmed — mirroring l2beat's `formatIntoHashable`) is computed only
// to *report* how much additional dedup a pragma/whitespace-insensitive key
// would unlock, without sacrificing exactness.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface FlatFile {
  project: string; // project directory name
  path: string; // path within the project's .flat dir (posix separators)
  content: string;
}

export interface ManifestEntry {
  path: string;
  hash: string; // content-address key (raw sha256, "0x…")
  bytes: number;
}

export interface ProjectManifest {
  project: string;
  entries: ManifestEntry[];
}

export interface SharedBlob {
  hash: string;
  refs: number; // how many project files map to this blob
  bytes: number;
  samplePath: string; // one "project/path" that uses it, for orientation
}

export interface StoreStats {
  projects: number;
  files: number; // total .flat files across all projects (status quo)
  totalBytes: number; // sum of every file's size on disk today
  uniqueBlobs: number; // distinct raw-content blobs
  storeBytes: number; // sum of unique blob sizes (the content-addressed store)
  bytesSaved: number;
  savedPct: number;
  // what a normalized (pragma/whitespace-insensitive) key would additionally buy
  normalizedUniqueBlobs: number;
  topShared: SharedBlob[]; // most-duplicated blobs, descending
}

export interface BuildResult {
  blobs: Map<string, string>; // hash -> content
  manifests: ProjectManifest[];
  stats: StoreStats;
}

export function sha256(input: string): string {
  return `0x${createHash("sha256").update(input).digest("hex")}`;
}

// Strip the `// SPDX-License-Identifier: …` + `pragma solidity …;` header that
// flattenDiscoveredSource prepends, then trim — the same normalization intent
// as l2beat's `formatIntoHashable`, so two solc-version variants of the same
// source collapse. Used only for the "potential" metric, never for storage.
export function normalizeFlat(content: string): string {
  const lines = content.split("\n");
  let i = 0;
  if (lines[i]?.startsWith("// SPDX-License-Identifier:")) i++;
  if (lines[i]?.startsWith("pragma solidity")) i++;
  return lines.slice(i).join("\n").trim();
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

/**
 * Read every `*.sol` under `<projectsDir>/<project>/.flat/**`. Projects without
 * a `.flat` folder are skipped. Paths are recorded relative to the `.flat` dir.
 */
export function collectFlatFiles(projectsDir: string): FlatFile[] {
  const files: FlatFile[] = [];
  for (const project of readdirSync(projectsDir)) {
    const flatDir = join(projectsDir, project, ".flat");
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(flatDir);
    } catch {
      continue; // no .flat here
    }
    if (!stat.isDirectory()) continue;

    for (const abs of walk(flatDir)) {
      if (!abs.endsWith(".sol")) continue;
      const rel = relative(flatDir, abs).split(sep).join("/");
      files.push({ project, path: rel, content: readFileSync(abs, "utf8") });
    }
  }
  return files;
}

/** Deduplicate a set of flat files into a content-addressed store + manifests. */
export function buildStore(files: FlatFile[], topN = 10): BuildResult {
  const blobs = new Map<string, string>();
  const refs = new Map<string, number>();
  const sample = new Map<string, string>();
  const byProject = new Map<string, ManifestEntry[]>();
  const normalized = new Set<string>();
  let totalBytes = 0;

  for (const file of files) {
    const bytes = Buffer.byteLength(file.content, "utf8");
    totalBytes += bytes;

    const hash = sha256(file.content);
    if (!blobs.has(hash)) {
      blobs.set(hash, file.content);
      sample.set(hash, `${file.project}/${file.path}`);
    }
    refs.set(hash, (refs.get(hash) ?? 0) + 1);
    normalized.add(sha256(normalizeFlat(file.content)));

    let entries = byProject.get(file.project);
    if (!entries) {
      entries = [];
      byProject.set(file.project, entries);
    }
    entries.push({ path: file.path, hash, bytes });
  }

  let storeBytes = 0;
  for (const content of blobs.values()) storeBytes += Buffer.byteLength(content, "utf8");

  const manifests: ProjectManifest[] = [...byProject.entries()]
    .map(([project, entries]) => ({
      project,
      entries: entries.sort((a, b) => a.path.localeCompare(b.path)),
    }))
    .sort((a, b) => a.project.localeCompare(b.project));

  const topShared: SharedBlob[] = [...refs.entries()]
    .map(([hash, count]) => ({
      hash,
      refs: count,
      bytes: Buffer.byteLength(blobs.get(hash) ?? "", "utf8"),
      samplePath: sample.get(hash) ?? "",
    }))
    .sort((a, b) => b.refs - a.refs || b.bytes - a.bytes)
    .slice(0, topN);

  const bytesSaved = totalBytes - storeBytes;
  const stats: StoreStats = {
    projects: byProject.size,
    files: files.length,
    totalBytes,
    uniqueBlobs: blobs.size,
    storeBytes,
    bytesSaved,
    savedPct: totalBytes > 0 ? (bytesSaved / totalBytes) * 100 : 0,
    normalizedUniqueBlobs: normalized.size,
    topShared,
  };

  return { blobs, manifests, stats };
}

/**
 * Reconstruct a project's `.flat` (path -> content) from its manifest and the
 * in-memory blob store. Byte-exact, since blobs are keyed by raw content hash.
 */
export function rehydrateProject(
  manifest: ProjectManifest,
  blobs: Map<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of manifest.entries) {
    const content = blobs.get(entry.hash);
    if (content === undefined) throw new Error(`missing blob ${entry.hash} for ${entry.path}`);
    out.set(entry.path, content);
  }
  return out;
}

/**
 * Materialize the store to disk:
 *   <outDir>/blobs/<hash>.sol         one file per distinct source
 *   <outDir>/manifests/<project>.json path -> hash per project
 *   <outDir>/store-report.json        the dedup stats
 */
export function writeStore(outDir: string, result: BuildResult): void {
  const blobsDir = join(outDir, "blobs");
  const manifestsDir = join(outDir, "manifests");
  mkdirSync(blobsDir, { recursive: true });
  mkdirSync(manifestsDir, { recursive: true });

  for (const [hash, content] of result.blobs) {
    writeFileSync(join(blobsDir, `${hash.slice(2)}.sol`), content);
  }
  for (const manifest of result.manifests) {
    writeFileSync(
      join(manifestsDir, `${manifest.project}.json`),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }
  writeFileSync(join(outDir, "store-report.json"), `${JSON.stringify(result.stats, null, 2)}\n`);
}

/** Prove the manifests + store reproduce every original file exactly. */
export function verifyRoundTrip(
  files: FlatFile[],
  result: BuildResult,
): { ok: boolean; mismatches: string[] } {
  const original = new Map<string, string>();
  for (const f of files) original.set(`${f.project}/${f.path}`, f.content);

  const mismatches: string[] = [];
  for (const manifest of result.manifests) {
    const restored = rehydrateProject(manifest, result.blobs);
    for (const [path, content] of restored) {
      if (original.get(`${manifest.project}/${path}`) !== content) {
        mismatches.push(`${manifest.project}/${path}`);
      }
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}
