# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_BAASE_RELEASE=local
ARG GLITCHTIP_SOURCEMAPS_UPLOAD=false
ARG GLITCHTIP_CLI_VERSION=1.0.0
ARG GLITCHTIP_CLI_SHA256=de1c035aa61931a6265d7b29b1614781dfee925466142a907508cb097082dfef
ENV VITE_BAASE_RELEASE=$VITE_BAASE_RELEASE

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/web apps/web

RUN pnpm --filter @prymeira/baase-web build

RUN --mount=type=secret,id=glitchtip_auth_token \
  set -eu; \
  if [ "$GLITCHTIP_SOURCEMAPS_UPLOAD" = "true" ]; then \
    test -s /run/secrets/glitchtip_auth_token; \
    wget -q -O /usr/local/bin/glitchtip-cli \
      "https://gitlab.com/glitchtip/glitchtip-cli/-/jobs/artifacts/v${GLITCHTIP_CLI_VERSION}/raw/artifacts/glitchtip-cli-linux-x86_64?job=build-linux-x86_64"; \
    echo "${GLITCHTIP_CLI_SHA256}  /usr/local/bin/glitchtip-cli" | sha256sum -c -; \
    chmod 0755 /usr/local/bin/glitchtip-cli; \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/glitchtip_auth_token)" \
      SENTRY_URL=https://glitchtip.prymeiradigital.com.br \
      glitchtip-cli sourcemaps inject /app/apps/web/dist; \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/glitchtip_auth_token)" \
      SENTRY_URL=https://glitchtip.prymeiradigital.com.br \
      glitchtip-cli sourcemaps upload /app/apps/web/dist \
        --release "$VITE_BAASE_RELEASE" \
        --org prymeira \
        --project baase-web; \
  elif [ "$GLITCHTIP_SOURCEMAPS_UPLOAD" != "false" ]; then \
    echo "GLITCHTIP_SOURCEMAPS_UPLOAD must be true or false" >&2; \
    exit 1; \
  fi; \
  find /app/apps/web/dist -type f -name '*.map' -delete

FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY apps/web/docker-entrypoint.d/10-baase-runtime-config.sh /docker-entrypoint.d/10-baase-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/10-baase-runtime-config.sh

COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
