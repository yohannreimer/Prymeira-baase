FROM node:22-alpine AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/web apps/web

RUN pnpm --filter @prymeira/baase-web build

FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY apps/web/docker-entrypoint.d/10-baase-runtime-config.sh /docker-entrypoint.d/10-baase-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/10-baase-runtime-config.sh

COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
