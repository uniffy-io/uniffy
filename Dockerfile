FROM node:24.0-slim AS ui-builder

RUN npm install -g pnpm

WORKDIR /app
COPY src/ui/package.json src/ui/pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile
COPY src/ui/ .
RUN pnpm build

## RUN Stage
FROM registry.uniffy.io/stellartrading/python:3.13.7-trixie

WORKDIR /app

# Copy workspace configuration and lock file
COPY pyproject.toml uv.lock README.md .python-version ./

# Copy source code (only python backend)
COPY src/uwos /app/src/uwos

# Copy built UI
COPY --from=ui-builder /app/dist /app/src/ui/dist

RUN uv sync --compile-bytecode --frozen \
  --no-dev && \
  rm -rf /root/.cache/uv

WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH"
ENTRYPOINT ["/bin/tini", "--"]
CMD ["python", "-m", "uwos.main"]

