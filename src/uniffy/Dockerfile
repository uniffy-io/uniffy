# API, worker, and CLI images share a Python runtime. Native video tools
# belong to media-runtime and media-dev only. The default target is runtime.

ARG PYTHON_IMAGE=python:3.14.7-slim-trixie@sha256:cad9a2c871761c413caa6fdd6441c783451e740a48aaeba60ae62a8b53525ef6
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.11.12@sha256:3a59a3cdd5f7c217faa36e32dbc7fddbb0412889c2a0a5229f6d790e5a019dd7
ARG FIXTURE_FFMPEG_IMAGE=mwader/static-ffmpeg:9.0.1@sha256:54e55b0cb8f672870fc38ceb2e6c411855cb3b39c505f5f3b2505ee01ed5f2b7

FROM ${UV_IMAGE} AS uv
FROM ${FIXTURE_FFMPEG_IMAGE} AS fixture-ffmpeg
FROM ${PYTHON_IMAGE} AS ffmpeg
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential nasm pkg-config meson ninja-build xz-utils bzip2 autoconf automake libtool zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
ADD --checksum=sha256:cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635 https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz /sources/ffmpeg.tar
ADD --checksum=sha256:f05c59f2e83d494c36307025dca2d3afc6b4d185f3a3453d06cc4fecd7094057 https://code.videolan.org/videolan/x264/-/archive/0480cb05fa188d37ae87e8f4fd8f1aea3711f7ee/x264-0480cb05fa188d37ae87e8f4fd8f1aea3711f7ee.tar.bz2 /sources/x264.tar
ADD --checksum=sha256:e099f53253f6c247580c554d53a13f1040638f2066edc3c740e4c2f15174ce22 https://code.videolan.org/videolan/dav1d/-/archive/1.5.3/dav1d-1.5.3.tar.bz2 /sources/dav1d.tar
ADD --checksum=sha256:a9a0226bf85e0d83c41a8ebe4e3e690e1348682f6a2a7838f1b8cbff1b799bcf https://github.com/sekrit-twc/zimg/archive/refs/tags/release-3.0.5.tar.gz /sources/zimg.tar
COPY .docker/media/deps.sh /sources/deps.sh
RUN sh /sources/deps.sh
COPY .docker/media/build.sh /sources/build.sh
RUN sh /sources/build.sh


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

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app/src" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY --chmod=755 .docker/dev/backend-entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]


FROM dev AS media-dev

COPY --from=ffmpeg /opt/media/bin/ffmpeg /opt/media/bin/ffprobe /usr/local/bin/
# Tests need encoders for inputs the production tools only decode.
COPY --from=fixture-ffmpeg /ffmpeg /usr/local/bin/ffmpeg-fixtures


FROM ${PYTHON_IMAGE} AS runtime-base

ARG VERSION=0.0.0-dev
ARG REVISION=unknown

LABEL org.opencontainers.image.title="Uniffy backend" \
      org.opencontainers.image.description="Uniffy backend, core and egress workers, and operator CLI" \
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


FROM runtime-base AS media-runtime

LABEL org.opencontainers.image.title="Uniffy media worker" \
      org.opencontainers.image.description="Uniffy video, thumbnail, and document processing worker"

COPY --from=ffmpeg /opt/media/bin/ffmpeg /opt/media/bin/ffprobe /usr/local/bin/
COPY --from=ffmpeg /sources /usr/share/uniffy/media-sources
COPY --from=ffmpeg /opt/media/share /usr/share/uniffy/media

EXPOSE 9093
CMD ["python", "-m", "uniffy", "--worker-media"]


FROM runtime-base AS runtime
