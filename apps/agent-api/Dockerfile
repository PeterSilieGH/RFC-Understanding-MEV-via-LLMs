# Build context is the repo root (see docker-compose.yml) so workspace
# packages are available.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/config ./packages/config
COPY packages/db ./packages/db
COPY packages/rpc ./packages/rpc
COPY apps/agent-api ./apps/agent-api
RUN pnpm install --frozen-lockfile --filter @mev/agent-api... \
    && pnpm --filter @mev/agent-api... build

FROM node:22-slim
# Foundry `cast` for the Discovery agent's read-only on-chain lookups (ADR-013
# §8). Installed to /usr/local/bin (on PATH for any uid); the runner resolves
# `cast` via PATH and degrades gracefully if it is ever absent.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates git \
    && curl -L https://foundry.paradigm.xyz | bash \
    && /root/.foundry/bin/foundryup \
    && cp /root/.foundry/bin/cast /usr/local/bin/cast \
    && rm -rf /root/.foundry /var/lib/apt/lists/* \
    && cast --version
WORKDIR /repo
COPY --from=build /repo ./
# Project pi resources: .pi/SYSTEM.md (system prompt override), .pi/AGENTS.md,
# .pi/skills/, .pi/settings.json (project model default) — discovered at cwd
# (/repo). Base config (auth.json/models.json/settings.json defaults) is NOT
# baked in; it comes from the agent dir mounted at $PI_CODING_AGENT_DIR in
# compose (ADR-009).
COPY .pi ./.pi
# pi takes a proper-lockfile lock even to READ .pi/settings.json, creating a
# .lock dir inside .pi. The container runs as a non-root uid (DISCO_UID), but
# this tree is root-owned from the build — make .pi writable by any uid so the
# lock succeeds and the project settings actually load (else they're silently
# dropped and the global default model wins).
RUN chmod -R a+rwX ./.pi
EXPOSE 3100
CMD ["node", "apps/agent-api/dist/server.js"]
