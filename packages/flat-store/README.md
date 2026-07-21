# @mev/flat-store

Content-addressed store that **deduplicates DiscoUI `.flat` sources across
projects**. A prototype exploring the dedup idea from the discovery notes: the
`trace-*` per-incident projects (ADR-008) each write a full `.flat/` folder of
flattened Solidity, so the same WETH / USDC / UniswapV3Pool sources are stored
byte-for-byte in dozens of projects.

## Idea

l2beat already content-addresses *config* (templates keyed by a flattening
hash, so N instances share one `template.jsonc`). This applies the same key to
the **source bodies**:

- hash every flattened `*.sol`,
- store each distinct blob once under `blobs/<hash>.sol`,
- reduce each project to a `manifests/<project>.json` of `path -> hash`.

`discovered.json` already records `sourceHashes` per entry, so referencing by
hash is a natural fit. Blobs are keyed by the **raw** content hash, so
rehydration is byte-exact (lossless). A second, normalized hash (SPDX + pragma
header stripped, trimmed — mirroring l2beat's `formatIntoHashable`) is computed
only to *report* how much extra dedup a pragma/whitespace-insensitive key would
unlock.

## Usage

```bash
pnpm --filter @mev/flat-store build

# report only (reads the projects folder, writes nothing)
node packages/flat-store/dist/cli.js verify l2beat/packages/config/src/projects

# build + materialize the store to <out>
node packages/flat-store/dist/cli.js build l2beat/packages/config/src/projects --out /tmp/flat-store-out
```

`trace-api` also calls `deduplicateProjectInPlace()` after each synthetic
discovery. It keeps the existing `.flat` paths as hard links into
`<projects>/.flat-store/blobs`, so disco-api needs no submodule modification and
all reads remain byte-exact.

`<projectsDir>` is only read; the store is written to `--out`.

## Measured (live corpus, 2026-07-21)

Against `l2beat/packages/config/src/projects` (55 projects with `.flat`,
dominated by the synthetic `trace-*` incidents):

```
flat files (total)  : 1013
on disk today       : 71.7 MiB
unique blobs        :  294
content-addr store  : 19.2 MiB
saved               : 52.5 MiB  (73.2%)
round-trip          : OK — every project reconstructs byte-exact
```

Most-duplicated sources: `UniswapV3Pool` ×81, `UniswapV2Pair` ×48,
`Wrapped Ether Token` ×47, `USD Coin Token/FiatTokenV2_2` ×45 — exactly the
recurring pools/tokens.

The corpus CLI remains useful for reports and migration. The runtime path does
not modify l2beat source or commit submodule state; it only transforms generated,
untracked discovery output after `saveFlatSources` completes.
