# Build context is the repo root (see docker-compose.yml).
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/explorer-web ./apps/explorer-web
RUN pnpm install --frozen-lockfile --filter @mev/explorer-web \
    && pnpm --filter @mev/explorer-web build

FROM nginx:alpine
COPY apps/explorer-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/explorer-web/dist /usr/share/nginx/html
EXPOSE 80
