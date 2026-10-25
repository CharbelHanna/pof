# syntax=docker/dockerfile:1.7
#
# Build from the REPOSITORY ROOT:
#   docker build -f apps/worker/Dockerfile -t pof-worker .

ARG NODE_VERSION=26-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /repo
# Node 25+ no longer bundles corepack, so install pnpm directly. Pinned to the
# version in package.json#packageManager so the lockfile is read identically.
RUN npm install -g pnpm@12.15.0

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
    pnpm install --frozen-lockfile --filter @pof/worker...

FROM node:${NODE_VERSION} AS runtime
WORKDIR /repo

ENV NODE_ENV=production

# Node 25+ no longer bundles corepack, so install pnpm directly. Pinned to the
# version in package.json#packageManager so the lockfile is read identically.
RUN npm install -g pnpm@12.15.0

# Source first, dependencies second — the order is load-bearing.
#
# pnpm's isolated node_modules puts a node_modules directory inside EVERY
# workspace package; that is how `packages/db` resolves `drizzle-orm`. Copying
# the source tree over a directory that already contains those links replaces
# it, silently leaving the shared packages unable to resolve their own
# dependencies at runtime. Copying dependencies last avoids that entirely.
COPY package.json pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps/worker ./apps/worker

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages ./packages
COPY --from=deps /repo/apps/worker/node_modules ./apps/worker/node_modules

# Workspace packages export TypeScript source, so the worker runs under tsx
# rather than being bundled. That keeps one source of truth for the domain
# code shared with the web app, at the cost of a slightly larger image —
# a trade worth revisiting only if cold start ever matters here, which for a
# long-running worker it does not.
#
# sharp arrives in Phase 2 and is a native libvips binding: build this image
# for the target architecture explicitly (--platform=linux/amd64 or arm64)
# and pin the base digest, or a Mac-built image will fail on an x86 host.

USER node
WORKDIR /repo/apps/worker

CMD ["node", "--import", "tsx", "src/index.ts"]
