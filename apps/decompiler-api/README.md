# `@mev/decompiler-api`

Internal, bytecode-only Panoramix worker. It listens on a Unix socket and never
accepts an address, RPC URL, or explorer credential.

## API

- `GET /health`
- `POST /api/decompile` with `{ "bytecode": "0x..." }`

The response schema is exported from `src/types.ts`. A successful engine run is
classified as `complete`, `partial`, or `unsupported`; bounded failures are
classified as `timeout` or `error`. Decompiled text is approximate evidence,
not verified source.

## Runtime configuration

| Variable | Default | Bound |
| --- | --- | --- |
| `DECOMPILER_API_SOCKET` | `/run/decompiler-api/decompiler.sock` | absolute `.sock` path |
| `DECOMPILER_TIMEOUT_MS` | `30000` | 100–180000 ms |
| `DECOMPILER_MAX_BYTECODE_BYTES` | `24576` | 1–24576 bytes |
| `DECOMPILER_MAX_OUTPUT_BYTES` | `4194304` | 1024–8388608 bytes |
| `DECOMPILER_MAX_CONCURRENCY` | `1` | 1–4 processes |
| `DECOMPILER_CACHE_HOME` | `/tmp/panoramix-cache` | writable tmpfs path |

The production container is non-root and compatible with a read-only root
filesystem. Its socket and cache paths must be writable mounts. Compose must
also disable outbound networking and apply CPU, memory, and PID limits; an
image cannot enforce those deployment controls by itself. The Python adapter
blocks socket connects as defense in depth and receives an allowlisted child
environment with no provider or API-key variables.

The upstream source, dependency lock, and MIT license pin are recorded under
`third_party/panoramix/`. The image build checks the commit, tree, source
archive, dependency lock, and license hashes before installing it.
