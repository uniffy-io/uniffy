# Generic Node dev image - used by every pnpm workspace dev container
# (currently ui and landing). Same Node version + pnpm install method as
# the prod Dockerfile.
# Source code is bind-mounted at runtime; pnpm install runs in entrypoint and
# node_modules trees are kept in anonymous volumes (per-container, isolated
# from the host's arch-specific binaries).
# Each service sets PNPM_FILTER in compose to limit install to its workspace.
FROM node:24.0-slim

RUN npm install -g pnpm

WORKDIR /app

ENV NODE_ENV=development \
    CHOKIDAR_USEPOLLING=true

COPY .docker/dev/node-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
