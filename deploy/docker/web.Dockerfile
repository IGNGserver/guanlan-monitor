# syntax=docker/dockerfile:1
#
# Web (Hub UI) runtime image.
#
# Next.js runs only at build time. The runtime contains the public export and
# nginx: no Node, Next server, pnpm, workspace sources or application secrets.

ARG NODE_IMAGE=node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
# Official library/nginx multi-platform index, verified via Docker Hub 2026-10-24.
ARG NGINX_IMAGE=nginx:1.30.6-alpine3.24@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951

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
ARG DSC_STATIC_EXPORT=true
ENV DSC_RELEASE_CHANNEL=${DSC_RELEASE_CHANNEL}
ENV DSC_STATIC_EXPORT=${DSC_STATIC_EXPORT}
ENV NEXT_TELEMETRY_DISABLED=1
RUN test "$DSC_STATIC_EXPORT" = true && pnpm --filter @dsc/shared build && pnpm --filter @dsc/web build

# --- runtime ----------------------------------------------------------------
FROM ${NGINX_IMAGE} AS runner
LABEL io.guanlan.web-runtime="static-nginx"
COPY deploy/docker/web.nginx.conf /etc/nginx/nginx.conf
COPY deploy/docker/web-security-headers.conf /etc/nginx/web-security-headers.conf
COPY deploy/docker/web-proxy.conf /etc/nginx/web-proxy.conf
RUN touch /etc/nginx/web-trusted-tls-proxies.conf
COPY --chmod=755 deploy/docker/40-render-trusted-tls-proxies.sh /docker-entrypoint.d/40-render-trusted-tls-proxies.sh
COPY --from=build /app/apps/web/out/ /srv/guanlan/
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
