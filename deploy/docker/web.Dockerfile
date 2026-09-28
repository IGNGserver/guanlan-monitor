# syntax=docker/dockerfile:1
#
# Web (Hub UI) runtime image.
#
# The build is split into three stages so the published image carries only the
# traced Next.js standalone server instead of the whole workspace node_modules
# (which also contained the desktop/Electron dependency closure). Runtime uses
# plain `node` — no pnpm/corepack needed to start the server.

ARG NODE_IMAGE=node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

# --- base -------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
RUN corepack enable
WORKDIR /app

# --- dependencies -----------------------------------------------------------
# Install only the @dsc/web dependency closure (dev deps included for build),
# with a minimal build context so transitive workspace projects are untouched.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json VERSION ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/console-ui/package.json packages/console-ui/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter @dsc/web...

# --- build ------------------------------------------------------------------
FROM deps AS build
COPY packages/shared packages/shared
COPY packages/console-ui packages/console-ui
COPY apps/web apps/web
ARG DSC_RELEASE_CHANNEL=test
ENV DSC_RELEASE_CHANNEL=${DSC_RELEASE_CHANNEL}
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @dsc/shared build && pnpm --filter @dsc/web build

# --- runtime ----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
