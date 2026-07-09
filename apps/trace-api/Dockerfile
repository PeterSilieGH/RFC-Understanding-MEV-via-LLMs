# Build context is the repo root (see docker-compose.yml).
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/config ./packages/config
COPY packages/trace-graph ./packages/trace-graph
COPY apps/trace-api ./apps/trace-api
RUN pnpm install --frozen-lockfile --filter @mev/trace-api... \
    && pnpm --filter @mev/trace-api... build

FROM node:22-slim
WORKDIR /repo
COPY --from=build /repo ./
EXPOSE 2022
CMD ["node", "apps/trace-api/dist/server.js"]
