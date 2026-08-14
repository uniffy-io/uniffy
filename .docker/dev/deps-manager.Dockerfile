# Dependency-management toolbox: every toolchain that manipulates
# dependencies or generates code lives here (pnpm, uv, buf), so those
# operations never need a host install. Invoked as one-off runs via
# `./manage.py toolbox|proto|licenses`; named volumes keep its installed
# trees between runs.
#
# Debian (trixie-slim) base. ca-certificates is REQUIRED: node bundles its
# own CA store but buf is a Go binary that reads the system pool, which is
# empty on slim images - without the package every buf remote-plugin call
# dies with "x509: certificate signed by unknown authority".
# build-essential is REQUIRED so uv can compile native extensions with no
# prebuilt cp3.14 wheel (valkey[libvalkey] builds from sdist); without cc
# on PATH `uv sync` dies with "command 'cc' failed: No such file".
FROM node:24-trixie-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.12 /uv /uvx /usr/local/bin/
COPY --from=bufbuild/buf:1.69.0 /usr/local/bin/buf /usr/local/bin/buf
# Go toolchain for `go mod tidy` in src/gen/go after buf regenerates
COPY --from=golang:1.26-trixie /usr/local/go /usr/local/go

# Managed pythons live outside /root so the entrypoint's privilege drop
# (running as the host uid) can still read the interpreter.
ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates build-essential \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@11.20.0 \
    && uv python install 3.14 \
    && chmod -R a+rX /opt/uv-python

WORKDIR /app

ENV UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONDONTWRITEBYTECODE=1 \
    GOMODCACHE=/go-cache/mod \
    GOCACHE=/go-cache/build \
    PATH=/app/.venv/bin:/usr/local/go/bin:$PATH

COPY .docker/dev/deps-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bash"]
