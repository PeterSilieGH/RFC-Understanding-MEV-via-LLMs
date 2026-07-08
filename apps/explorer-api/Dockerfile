# Build context is the repo root (see docker-compose.yml) so workspace
# packages are available.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/config ./packages/config
COPY packages/db ./packages/db
COPY apps/explorer-api ./apps/explorer-api
RUN pnpm install --frozen-lockfile --filter @mev/explorer-api... \
    && pnpm --filter @mev/explorer-api... build

FROM node:22-slim
# docker CLI only (no daemon): explorer-api spawns mev-inspect-py containers
# on the host daemon via the mounted /var/run/docker.sock (ADR-002).
RUN apt-get update && apt-get install -y --no-install-recommends docker.io \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY --from=build /repo ./
EXPOSE 3000
CMD ["node", "apps/explorer-api/dist/server.js"]
