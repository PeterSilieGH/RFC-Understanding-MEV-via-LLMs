# @mev/disco — DiscoUI

Clone of l2beat's `packages/protocolbeat` at `18532eacfff59dfa2ff9ea37d128b65c569fef40`
(ADR-004: port, don't import), extended with a **trace** panel that renders MEV
execution traces from `trace-api` using the same node-graph machinery as the
`nodes` panel.

- `src/vendor/` replaces the `@l2beat/*` workspace dependencies (see its README).
- Everything else under `src/` tracks upstream — keep edits minimal and marked,
  so re-porting against a newer submodule pin stays reviewable.
- The discovery backend is l2beat's `l2b ui` (built via `Dockerfile.disco-ui`
  from the submodule), proxied under `/api`; trace endpoints go to our
  `trace-api` under `/api/traces`.
- Excluded from the root Biome config: the clone keeps upstream's formatting.

Dev: `pnpm --filter @mev/disco dev` (expects disco-api on 2021 and trace-api
on 2022, see vite.config.mts).
