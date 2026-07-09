# Vendored l2beat sources

Ported from l2beat@18532eacfff59dfa2ff9ea37d128b65c569fef40 (ADR-004) so this
app builds without the submodule's workspace packages. `@l2beat/validate`,
`@l2beat/shared-pure`, and `@l2beat/discovery` imports resolve here via
tsconfig paths + vite aliases, keeping the cloned protocolbeat sources
unmodified.

| Path | Upstream source |
|---|---|
| `validate/` | `packages/validate/src` (tests omitted) |
| `shared-pure/` | `packages/shared-pure/src`: `types/ChainSpecificAddress.ts`, `types/EthereumAddress.ts`, `types/api/AnalyzerApiResponse.ts`, `utils/clamp.ts` |
| `discovery/` | `packages/discovery/src`: `schemas/schemas.ts`, `discovery/config/{Structure,Color,Permission}Config.ts`; `stubs.ts` replaces the deep blip/user-handler chain with loose types (only consumed as `import type` here); `RefreshReason` extracted from `discovery/analysis/TemplateService.ts` |

Only `StructureConfig.ts` deviates from upstream: its three deep imports are
redirected to `stubs.ts`.
