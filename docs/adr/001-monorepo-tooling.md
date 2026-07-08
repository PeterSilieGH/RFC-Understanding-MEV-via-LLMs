# ADR-001: Monorepo with pnpm workspaces, Turborepo, Biome, Vite, Express, TypeScript

## Status

Accepted — 2026-07-08

## Context

The platform merges three codebases with different tooling: the legacy framework at the repo root (npm-ish, eslint, tsc), `mev-monitor/` (plain CommonJS, no build, vendored node_modules), and l2beat (pnpm + turbo monorepo). We need one consistent stack for multiple apps (two APIs, two frontends, an agent service) and shared packages, and the project requirements fix the toolchain: pnpm, TypeScript, Vite, Express, Turborepo, Biome.

## Decision

- Single pnpm workspace at the repo root: `apps/*` (deployables) and `packages/*` (shared libraries), declared in `pnpm-workspace.yaml`. `mev-monitor/` and `l2beat/` are explicitly **not** workspace members — they are references.
- Turborepo orchestrates `build`, `test`, `lint`, `dev` across the workspace with caching; each package keeps plain `tsc`/`vitest`/`vite` scripts so tasks also run standalone.
- Biome replaces eslint/prettier repo-wide (one root `biome.json`). The legacy eslint devDependencies are removed as the root `src/` is absorbed into `packages/eth`.
- All code is ESM, TypeScript strict mode. Frontends build with Vite; APIs are Express apps compiled with `tsc` and run under node (dev: `tsx watch`).
- l2beat's monorepo mirrors this same stack (pnpm + turbo + Express + Vite), which keeps ported DiscoUI code structurally close to its source.

## Consequences

- The legacy root `package.json` becomes the workspace root manifest; `src/` + `tests/` migrate into `packages/eth` (tracked as part of M1 groundwork).
- Vendored `mev-monitor/node_modules` stays out of the workspace and out of the lockfile.
- Biome's rule set differs from the previous eslint config; formatting churn is accepted once, at adoption.
