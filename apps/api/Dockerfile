FROM node:22-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/api apps/api

RUN pnpm --filter @prymeira/baase-shared typecheck \
  && pnpm --filter @prymeira/baase-api typecheck

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3090

EXPOSE 3090

CMD ["pnpm", "--filter", "@prymeira/baase-api", "exec", "tsx", "src/server.ts"]
