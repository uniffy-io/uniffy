# Dev image for backend + worker-core + worker-egress.
# Same Python base as the prod Dockerfile - already includes uv, tini, ffmpeg,
# Pillow deps, build-essential. No need to reinstall any of that here.
# Source code is bind-mounted at runtime; uv sync runs in entrypoint and is
# cached via the per-container .venv anonymous volume.
FROM registry.uniffy.io/uniffy/python-base:3.14.0-slim-trixie

WORKDIR /app

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    PATH=/app/.venv/bin:$PATH \
    WATCHFILES_FORCE_POLLING=1

COPY .docker/dev/backend-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/bin/tini", "--", "/entrypoint.sh"]
