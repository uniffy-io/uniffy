ARG UV_VERSION=0.11.12

FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

FROM python:3.14.4-slim-trixie AS builder

ENV DEBIAN_FRONTEND=noninteractive
ENV TINI_VERSION=v0.19.0

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
WORKDIR /builder

ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini tini
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini.asc tini.asc

COPY --from=uv /uv /uvx /bin/

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    # gpg to verify tini
    gpg gpg-agent dirmngr build-essential \
    # Pillow dependencies
    libjpeg62-turbo libpng16-16t64 libtiff6 libwebp7 \
    # ffmpeg for thumnails generation
    ffmpeg \
  # install tini
  && gpg --batch --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 595E85A6B1B4779EA4DAAEC70B588DFF0527A9B7 \
  && gpg --batch --verify tini.asc tini \
  && mv tini /bin/tini \
  && chmod +x /bin/tini \
  # clean
  && apt-get autoremove -y \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* /builder
