FROM registry.uniffy.io/uniffy/python-base:3.14.0-slim-trixie AS deps

WORKDIR /app

# Copy workspace root config (which is also the backend project)
COPY pyproject.toml uv.lock README.md .python-version ./

# Copy workspace member config
COPY src/gen/python/pyproject.toml src/gen/python/pyproject.toml

# Copy gen source (needed for workspace dependency)
COPY src/gen/python/src/ src/gen/python/src/

RUN uv sync --compile-bytecode --frozen --no-dev --no-install-project \
    && rm -rf /root/.cache/uv

FROM registry.uniffy.io/uniffy/python-base:3.14.0-slim-trixie AS production

WORKDIR /app

# Copy virtual environment from deps stage
COPY --from=deps /app/.venv /app/.venv

# Copy source code
COPY src/uniffy /app/src/uniffy
COPY src/gen/python /app/src/gen/python
# Copy docs folder as we need it while seeding
COPY docs /app/docs

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app/src"
ENV PYTHONUNBUFFERED=1

ENTRYPOINT ["/bin/tini", "--"]

# Override with: python -m uniffy --worker-core or python -m uniffy --worker-egress
CMD ["python", "-m", "uniffy", "--backend"]
