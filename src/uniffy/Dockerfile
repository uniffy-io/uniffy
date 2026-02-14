FROM registry.uniffy.io/uniffy/python-base:3.14.0-slim-trixie AS deps

WORKDIR /app
COPY pyproject.toml uv.lock README.md .python-version ./
RUN uv sync --compile-bytecode --frozen --no-dev --no-install-project \
    && rm -rf /root/.cache/uv

FROM registry.uniffy.io/uniffy/python-base:3.14.0-slim-trixie AS production

WORKDIR /app

# Copy virtual environment from deps stage
COPY --from=deps /app/.venv /app/.venv

# Copy source code
COPY src/uniffy /app/src/uniffy
# Copy docs folder as we need it while seeding
COPY docs /app/docs

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app/src"
ENV PYTHONUNBUFFERED=1

ENTRYPOINT ["/bin/tini", "--"]

# Override with: python -m uniffy.worker to start the worker
CMD ["python", "-m", "uniffy.main"]
