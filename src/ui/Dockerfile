# UI Dockerfile for UNIFFY Frontend
# NOTE: Docker context must be the repo root (not src/ui) for workspace access
# Build stage
FROM node:24.0-slim AS builder

# Build arguments for Vite environment variables
ARG VITE_API_URL=https://localhost
ARG VITE_ENV=production

RUN npm install -g pnpm

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy package.json files for all workspace members needed by the UI build
COPY src/gen/typescript/package.json src/gen/typescript/package.json
COPY src/ui/package.json src/ui/package.json

# Install deps (pnpm workspace)
RUN pnpm install --frozen-lockfile

# Copy gen package (needed at build time for imports)
COPY src/gen/typescript/ src/gen/typescript/

# Copy UI source
COPY src/ui/ src/ui/

# Set env vars for Vite build
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_ENV=$VITE_ENV

RUN pnpm --filter uniffy-ui build

# Build service worker (minified IIFE bundle for production)
RUN pnpm --filter uniffy-ui build:worker

# Production stage - serve with nginx
FROM nginx:alpine

# Copy built assets
COPY --from=builder /app/src/ui/dist /usr/share/nginx/html

# Copy nginx configuration for SPA routing
RUN echo 'map $http_user_agent $loggable { \
    ~^kube-probe 0; \
    default 1; \
} \
\
server { \
    listen 80; \
    server_name localhost; \
    root /usr/share/nginx/html; \
    index index.html; \
    \
    # Disable logging for health checks \
    access_log /var/log/nginx/access.log combined if=$loggable; \
    \
    # Gzip compression \
    gzip on; \
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript; \
    \
    # Cache static assets in /assets/ \
    location /assets/ { \
        expires 1y; \
        add_header Cache-Control "public, immutable"; \
    } \
    \
    # Serve static files at root (service worker, etc.) - must be before SPA fallback \
    location ~* ^/[^/]+\\.(js|css|map|ico|png|svg|jpg|jpeg|gif|woff|woff2|ttf|eot)$ { \
        try_files $uri =404; \
        expires 1d; \
        add_header Cache-Control "public"; \
    } \
    \
    # SPA fallback - serve index.html for all routes \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
