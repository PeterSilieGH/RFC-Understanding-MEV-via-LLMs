# Build context is the repo root (see docker-compose.yml) so workspace
# packages are available.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/config ./packages/config
COPY packages/db ./packages/db
# @mev/inspect: the native TypeScript inspector (ADR-010). Its abis/ directory
# ships as source alongside dist/ (abi.ts resolves it relative to the package).
COPY packages/inspect ./packages/inspect
COPY apps/explorer-api ./apps/explorer-api
RUN pnpm install --frozen-lockfile --filter @mev/explorer-api... \
    && pnpm --filter @mev/explorer-api... build

FROM node:22-slim
# In-process inspection (ADR-010): no docker CLI / socket, no per-block
# containers — explorer-api decodes blocks itself via @mev/inspect.
WORKDIR /repo
COPY --from=build /repo ./
EXPOSE 3000
CMD ["node", "apps/explorer-api/dist/server.js"]
