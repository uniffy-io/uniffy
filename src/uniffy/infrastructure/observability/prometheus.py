"""Prometheus rendering and multiprocess process lifecycle."""

import atexit
import contextlib
import os
from collections.abc import Callable, Iterable
from typing import Any

from loguru import logger
from prometheus_client import CollectorRegistry, generate_latest, multiprocess

logger = logger.bind(component="infrastructure.observability.prometheus")


def _build_multiproc_registry() -> CollectorRegistry:
    registry = CollectorRegistry()
    multiprocess.MultiProcessCollector(registry)
    return registry


def get_metrics(before_collect: Iterable[Callable[[], None]] = ()) -> bytes:
    for collect in before_collect:
        collect()
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        return generate_latest(_build_multiproc_registry())
    return generate_latest()


def start_worker_metrics_server(port: int) -> None:
    """Keep workers running when their optional metrics socket cannot bind."""
    from prometheus_client import start_http_server

    kwargs: dict[str, Any] = {}
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        kwargs["registry"] = _build_multiproc_registry()
    try:
        start_http_server(port, **kwargs)
        logger.info(f"Worker metrics server started on :{port}")
    except OSError as exc:
        logger.warning(f"Could not start worker metrics server on :{port}: {exc}")


def _mark_process_dead_at_exit() -> None:
    if not os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        return
    with contextlib.suppress(Exception):
        multiprocess.mark_process_dead(os.getpid())


if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
    atexit.register(_mark_process_dead_at_exit)
