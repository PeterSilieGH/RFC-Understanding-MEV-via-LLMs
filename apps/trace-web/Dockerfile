# Build context is the repo root (see docker-compose.yml).
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/trace-graph ./packages/trace-graph
COPY apps/trace-web ./apps/trace-web
RUN pnpm install --frozen-lockfile --filter @mev/trace-web... \
    && pnpm --filter @mev/trace-graph build \
    && pnpm --filter @mev/trace-web build

FROM nginx:alpine
COPY apps/trace-web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/trace-web/dist /usr/share/nginx/html

