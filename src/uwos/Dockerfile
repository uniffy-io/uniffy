# Backend Dockerfile for UWOS Python API
FROM registry.uniffy.io/stellartrading/python:3.13.7-trixie

WORKDIR /app

# Copy workspace configuration and lock file from repo root
COPY pyproject.toml uv.lock README.md .python-version ./

# Copy source code (only python backend)
COPY src/uwos /app/src/uwos

RUN uv sync --compile-bytecode --frozen \
  --no-dev && \
  rm -rf /root/.cache/uv

ENV PATH="/app/.venv/bin:$PATH"
ENTRYPOINT ["/bin/tini", "--"]
CMD ["python", "-m", "uwos.main"]
