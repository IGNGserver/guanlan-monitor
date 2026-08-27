ARG NODE_IMAGE=node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
FROM ${NODE_IMAGE}

ARG DSC_RELEASE_CHANNEL=test

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json VERSION ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/console-ui/package.json packages/console-ui/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages

ENV NODE_ENV=production
ENV DSC_RELEASE_CHANNEL=${DSC_RELEASE_CHANNEL}

RUN pnpm --filter @dsc/shared build && pnpm --filter @dsc/web build

EXPOSE 3000

CMD ["pnpm", "--filter", "@dsc/web", "exec", "next", "start", "-p", "3000"]
