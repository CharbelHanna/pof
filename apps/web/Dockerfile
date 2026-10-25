# syntax=docker/dockerfile:1.7
#
# The portability contract: this image runs unchanged on Railway, Render, Fly,
# Hetzner, Azure Container Apps, ECS, Kubernetes or a laptop. No platform
# build packs, no vendor primitives, no Edge runtime.
#
# Build from the REPOSITORY ROOT, not this directory:
#   docker build -f apps/web/Dockerfile -t pof-web .

ARG NODE_VERSION=26-alpine

# ---------------------------------------------------------------------------
# deps — install once, cached on lockfile changes only
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /repo

# Node 25+ no longer bundles corepack, so install pnpm directly. Pinned to the
# version in package.json#packageManager so the lockfile is read identically.
RUN npm install -g pnpm@12.15.0

# Copy only what affects dependency resolution, so editing source code does
# not invalidate the install layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json           apps/web/
COPY apps/worker/package.json        apps/worker/
COPY packages/api/package.json       packages/api/
COPY packages/api-client/package.json packages/api-client/
COPY packages/auth/package.json      packages/auth/
COPY packages/config/package.json    packages/config/
COPY packages/core/package.json      packages/core/
COPY packages/db/package.json        packages/db/
COPY packages/schemas/package.json   packages/schemas/
COPY packages/tsconfig/package.json  packages/tsconfig/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /repo
# Node 25+ no longer bundles corepack, so install pnpm directly. Pinned to the
# version in package.json#packageManager so the lockfile is read identically.
RUN npm install -g pnpm@12.15.0

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages ./packages
COPY . .

# Next validates nothing from the environment at build time — the env schema is
# read lazily at request time — so no secrets are needed to produce an image.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @pof/web build

# ---------------------------------------------------------------------------
# runtime — thin image, non-root
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# `output: 'standalone'` traces exactly the files the server needs, so the
# runtime image carries no pnpm store and no dev dependencies.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

# node:alpine ships an unprivileged `node` user; use it rather than root.
USER node

EXPOSE 3000

# No shell form: this way the process is PID 1 and receives SIGTERM directly,
# so the platform's graceful-shutdown signal is not swallowed by /bin/sh.
CMD ["node", "apps/web/server.js"]
