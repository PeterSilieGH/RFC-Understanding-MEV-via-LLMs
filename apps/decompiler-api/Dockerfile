# Build context is the repository root.
FROM python:3.10-slim-bookworm AS panoramix-build

ARG PANORAMIX_REVISION=23edd11058abafcba9340afc768d2aa9274c0b62
ARG PANORAMIX_TREE=4114b03f04e681b4173a976320c88e111f4a2f03
ARG PANORAMIX_ARCHIVE_SHA256=425e2bd5b2752de7962e07aa471bae20dce08a4b92c77dab898e0b5dcbc1aad0
ARG PANORAMIX_LOCK_SHA256=de50917ecdea7b6ce1d3c8ccb966e3f43e7a91ead0d8b38243b1f7c07b688cd5
ARG PANORAMIX_LICENSE_SHA256=834c9cb58795628ef95aff8f1959077ae8f5c54d3bad91a1d7de421701e8b55e

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --filter=blob:none https://github.com/palkeo/panoramix.git /src/panoramix \
    && git -C /src/panoramix checkout --detach "${PANORAMIX_REVISION}" \
    && test "$(git -C /src/panoramix rev-parse HEAD)" = "${PANORAMIX_REVISION}" \
    && test "$(git -C /src/panoramix rev-parse 'HEAD^{tree}')" = "${PANORAMIX_TREE}" \
    && git -C /src/panoramix archive --format=tar HEAD > /tmp/panoramix.tar \
    && echo "${PANORAMIX_ARCHIVE_SHA256}  /tmp/panoramix.tar" | sha256sum --check \
    && echo "${PANORAMIX_LOCK_SHA256}  /src/panoramix/poetry.lock" | sha256sum --check \
    && echo "${PANORAMIX_LICENSE_SHA256}  /src/panoramix/LICENSE" | sha256sum --check

# Export the upstream lock rather than resolving its broad pyproject ranges.
RUN python -m venv /opt/poetry \
    && /opt/poetry/bin/pip install --no-cache-dir 'poetry==1.8.5' \
    && /opt/poetry/bin/poetry -C /src/panoramix export \
      --only main --format requirements.txt --output /tmp/requirements.txt \
    && python -m venv /opt/panoramix \
    && /opt/panoramix/bin/pip install --no-cache-dir -r /tmp/requirements.txt \
    && /opt/panoramix/bin/pip install --no-cache-dir --no-deps /src/panoramix

FROM node:22-bookworm-slim AS node-build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/decompiler-api ./apps/decompiler-api
RUN pnpm install --frozen-lockfile --filter @mev/decompiler-api... \
    && pnpm --filter @mev/decompiler-api build

FROM python:3.10-slim-bookworm

LABEL org.opencontainers.image.title="MEV Panoramix decompiler API" \
      org.opencontainers.image.source="https://github.com/palkeo/panoramix" \
      org.opencontainers.image.licenses="MIT" \
      mev.panoramix.revision="23edd11058abafcba9340afc768d2aa9274c0b62" \
      mev.panoramix.version="0.6.1"

RUN apt-get update \
    && apt-get install -y --no-install-recommends libatomic1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 decompiler \
    && useradd --uid 10001 --gid decompiler --no-create-home --home-dir /nonexistent decompiler \
    && mkdir -p /run/decompiler-api /tmp/panoramix-cache \
    && chown -R decompiler:decompiler /run/decompiler-api /tmp/panoramix-cache

COPY --from=panoramix-build /opt/panoramix /opt/panoramix
COPY --from=node-build /usr/local/bin/node /usr/local/bin/node
COPY --from=node-build /repo /repo
COPY --from=panoramix-build /src/panoramix/poetry.lock /repo/apps/decompiler-api/third_party/panoramix/UPSTREAM.poetry.lock
COPY --from=panoramix-build /src/panoramix/pyproject.toml /repo/apps/decompiler-api/third_party/panoramix/UPSTREAM.pyproject.toml
RUN node --version \
    && /opt/panoramix/bin/python -c 'from panoramix.decompiler import decompile_bytecode; assert callable(decompile_bytecode)'

ENV NODE_ENV=production \
    DECOMPILER_API_SOCKET=/run/decompiler-api/decompiler.sock \
    DECOMPILER_PYTHON=/opt/panoramix/bin/python \
    DECOMPILER_PANORAMIX_ADAPTER=/repo/apps/decompiler-api/python/panoramix_adapter.py \
    DECOMPILER_CACHE_HOME=/tmp/panoramix-cache \
    PYTHONDONTWRITEBYTECODE=1

VOLUME ["/run/decompiler-api", "/tmp/panoramix-cache"]
USER 10001:10001
WORKDIR /repo/apps/decompiler-api
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "dist/healthcheck.js"]
CMD ["node", "dist/server.js"]
