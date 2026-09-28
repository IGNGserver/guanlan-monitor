# syntax=docker/dockerfile:1
#
# Server (Hub API) runtime image.
#
# Build uses the full @dsc/server closure (dev deps for tsc), then exports a
# self-contained runtime with `pnpm deploy`, so the published layer no longer
# carries the desktop/Electron dependency closure or build-only tooling.

ARG NODE_IMAGE=node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

# --- base -------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
RUN corepack enable
WORKDIR /app

# --- dependencies -----------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json VERSION ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter @dsc/server...

# --- build ------------------------------------------------------------------
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @dsc/shared build \
  && pnpm --filter @dsc/server build \
  && pnpm --filter @dsc/server deploy /app/runtime --legacy --prod

# --- runtime ----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
# The deploy export is already workspace-free: dist + production node_modules.
COPY --from=build /app/runtime ./
RUN mkdir -p /app/data
EXPOSE 4000
CMD ["node", "dist/apps/server/src/index.js"]
