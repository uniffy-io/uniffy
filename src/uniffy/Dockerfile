# Backend image for the API, both worker fleets, and the break-glass CLI.
# The command selects the process: --backend (default), --worker-core,
# --worker-egress, --mfa-reset.
#
# Two targets share one toolchain stage, so dev and production run the same
# interpreter, uv, and ffmpeg: `runtime` (last, the default) is the
# production image; `dev` is what the compose stack builds. The runtime stage
# carries no compiler, no pip, and no package manager use, runs as uid 10001,
# and needs /tmp as its only writable path (Prometheus multiprocess files and
# transcode scratch space).

ARG PYTHON_IMAGE=python:3.14.7-slim-trixie@sha256:cad9a2c871761c413caa6fdd6441c783451e740a48aaeba60ae62a8b53525ef6
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.11.12@sha256:3a59a3cdd5f7c217faa36e32dbc7fddbb0412889c2a0a5229f6d790e5a019dd7
ARG FFMPEG_IMAGE=mwader/static-ffmpeg:9.0.1@sha256:54e55b0cb8f672870fc38ceb2e6c411855cb3b39c505f5f3b2505ee01ed5f2b7

FROM ${UV_IMAGE} AS uv
FROM ${FFMPEG_IMAGE} AS ffmpeg


FROM ${PYTHON_IMAGE} AS toolchain

# libvalkey ships no Python 3.14 wheel and compiles from source; every other
# native dependency arrives as a manylinux wheel. The compiler lives here and
# never reaches the runtime stage.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY --from=uv /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app


FROM toolchain AS builder

# Dependency layer: the workspace manifests plus the generated proto package,
# a workspace member that installs next to the third-party packages.
COPY pyproject.toml uv.lock README.md .python-version ./
COPY src/gen/python src/gen/python
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project --no-editable

# Application source stays outside the venv on PYTHONPATH: alembic.ini,
# migrations, and shipped data resolve relative to the package directory.
COPY src/uniffy src/uniffy
RUN python -m compileall -q -j 0 src/uniffy


# Compose stack target. The checkout is bind-mounted at /app and the venv is
# a volume the entrypoint syncs from the lockfile, so no source is baked in.
# The compiler stays because that sync compiles libvalkey too. Starts as root
# so the entrypoint can own the volumes, then drops to the host uid.
FROM toolchain AS dev

COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app/src" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY --chmod=755 .docker/dev/backend-entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]


FROM ${PYTHON_IMAGE} AS runtime

ARG VERSION=0.0.0-dev
ARG REVISION=unknown

LABEL org.opencontainers.image.title="Uniffy backend" \
      org.opencontainers.image.description="Uniffy backend, worker fleets, and operator CLI" \
      org.opencontainers.image.source="https://github.com/uniffy-io/uniffy" \
      org.opencontainers.image.licenses="FSL-1.1-Apache-2.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

# The pinned base predates Debian's latest security updates; apply them at
# build time. pip, ensurepip, idle, and tkinter never run in production and
# only add scanner findings; the venv is uv-managed and carries no pip.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
           /usr/local/lib/python3.14/site-packages/pip* \
           /usr/local/lib/python3.14/ensurepip \
           /usr/local/lib/python3.14/idlelib \
           /usr/local/lib/python3.14/tkinter \
           /usr/local/bin/pip* \
           /usr/local/bin/idle* \
    && groupadd --gid 10001 uniffy \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin uniffy

# transcode.py shells out to ffmpeg for H.264 output; the static build keeps
# Debian's ffmpeg dependency tree out of the runtime.
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src/uniffy /app/src/uniffy
# Starter workspace content, read when an organization is created.
COPY docs/LICENSES.md docs/TRANSPARENCY.md docs/TRADEMARKS.md /app/docs/
COPY docs/documentation /app/docs/documentation

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app/src" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/tmp \
    PROMETHEUS_MULTIPROC_BASE_DIR=/tmp/uniffy_prom_metrics \
    UNIFFY_VERSION="${VERSION}" \
    UNIFFY_COMMIT="${REVISION}"

USER 10001:10001

EXPOSE 8000 9091 9092

STOPSIGNAL SIGTERM

# No ENTRYPOINT: Kubernetes manifests pass the whole `python -m uniffy ...`
# command as args, and Granian and the worker runner handle SIGTERM themselves.
CMD ["python", "-m", "uniffy", "--backend"]
