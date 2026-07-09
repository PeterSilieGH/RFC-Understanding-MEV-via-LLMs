# Build context is the repo root (see docker-compose.yml).
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/trace-graph ./packages/trace-graph
COPY apps/disco ./apps/disco
RUN pnpm install --frozen-lockfile --filter @mev/disco... \
    && pnpm --filter @mev/trace-graph build \
    && pnpm --filter @mev/disco build

FROM nginx:alpine
COPY apps/disco/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/disco/build /usr/share/nginx/html
