FROM node:22-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages

ENV NODE_ENV=production

RUN pnpm --filter @dsc/shared build && pnpm --filter @dsc/web build

EXPOSE 3000

CMD ["pnpm", "--filter", "@dsc/web", "exec", "next", "start", "-p", "3000"]
