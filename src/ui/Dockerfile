# Production image for the browser app: static assets behind nginx on 8080,
# running as the unprivileged nginx user with pid and temp files under /tmp.
# The API is reached at /api on the same origin, so the build takes no API
# URL; the edge in front routes /api, /livekit, and /healthz elsewhere.

ARG NODE_IMAGE=node:24.21.0-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.29.8-alpine-slim@sha256:59678856b05324b7f6371f26eb1520be7fcd8bdc8ab380fc4913db8503e5a842

# The bundle is platform independent: a multi-arch build compiles it once on
# the build host and only the nginx stage is produced per target platform.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS builder

RUN npm install -g pnpm@11.20.0

ENV CI=true \
    npm_config_store_dir=/pnpm-store

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY src/gen/typescript/package.json src/gen/typescript/package.json
COPY src/ui/package.json src/ui/package.json
RUN --mount=type=cache,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter uniffy-ui...

COPY src/gen/typescript src/gen/typescript
# The nginx config belongs to the runtime stage; keeping it out of this
# layer means a config-only change does not rebuild the bundle.
COPY --exclude=nginx src/ui src/ui

# Precompressed siblings let nginx serve gzip bodies without per-request CPU.
RUN pnpm --filter uniffy-ui build \
    && find src/ui/dist -type f \
        \( -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.json' \
           -o -name '*.wasm' -o -name '*.html' -o -name '*.webmanifest' \) \
        -exec gzip -9 -k {} +


FROM ${NGINX_IMAGE} AS runtime

ARG VERSION=0.0.0-dev
ARG REVISION=unknown

LABEL org.opencontainers.image.title="Uniffy frontend" \
      org.opencontainers.image.description="Uniffy browser app served by nginx" \
      org.opencontainers.image.source="https://github.com/uniffy-io/uniffy" \
      org.opencontainers.image.licenses="FSL-1.1-Apache-2.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

# The pinned base predates Alpine's latest security updates; apply them at
# build time, then drop back to the base image's nginx user.
USER root
RUN apk upgrade --no-cache
USER 101

COPY src/ui/nginx/headers.conf /etc/nginx/uniffy-headers.conf
COPY src/ui/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/src/ui/dist /usr/share/nginx/html

RUN nginx -t

EXPOSE 8080
