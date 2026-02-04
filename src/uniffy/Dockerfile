FROM registry.uniffy.io/stellartrading/python:3.13.7-trixie AS deps

WORKDIR /app
COPY pyproject.toml uv.lock README.md .python-version ./
RUN uv sync --compile-bytecode --frozen --no-dev --no-install-project \
    && rm -rf /root/.cache/uv

FROM registry.uniffy.io/stellartrading/python:3.13.7-trixie AS production

# Install Pillow runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libjpeg62-turbo \
    libpng16-16t64 \
    libtiff6 \
    libwebp7 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy virtual environment from deps stage
COPY --from=deps /app/.venv /app/.venv

# Copy source code
COPY src/uniffy /app/src/uniffy
COPY docs /app/docs

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app/src"
ENV PYTHONUNBUFFERED=1

ENTRYPOINT ["/bin/tini", "--"]

# Override with: python -m uniffy.worker
CMD ["python", "-m", "uniffy.main"]
