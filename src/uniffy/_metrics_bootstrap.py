"""Bootstrap helper for prometheus_client multiprocess mode.

Granian forks N worker processes that each own a private prometheus_client
registry. A scrape against any one process therefore returns only its slice
of the counters, which makes hit-rate dashboards lie under load.

The fix is `prometheus_client`'s multiprocess collector: set
PROMETHEUS_MULTIPROC_DIR before any prometheus_client import, point each
process at the same directory, and let MultiProcessCollector union the
per-pid mmap files at scrape time. See
https://prometheus.github.io/client_python/multiprocess/.

This module sits at the top of the `uniffy` package (not under
`uniffy.observability`) on purpose. The observability subpackage's
`__init__.py` transitively loads `prometheus_client.values`, which pins its
storage backend (MutexValue vs MmapedValue) at first import based on
PROMETHEUS_MULTIPROC_DIR. Importing through `uniffy.observability.*` would
therefore lock in the single-process backend before bootstrap ever runs.
This module's only dependencies are stdlib; importing it triggers no
prometheus load.
"""

import contextlib
import os
import shutil
from pathlib import Path

_DEFAULT_BASE = "/tmp/uniffy_prom_metrics"


def bootstrap_multiproc_metrics(component: str) -> str:
    """Configure PROMETHEUS_MULTIPROC_DIR for a fork-share group and return it.

    Component names process families that should NOT share metric files
    (typically "backend" and "worker"). Each call clears the component's
    own subdirectory so stale per-pid files from a previous run don't
    pollute the next aggregate.

    Honors a pre-set PROMETHEUS_MULTIPROC_DIR if the operator wants to pin
    a specific path; in that case we still clear it on entry. Otherwise we
    derive a path under a base directory configurable via
    PROMETHEUS_MULTIPROC_BASE_DIR (default /tmp/uniffy_prom_metrics).

    MUST be called before any `prometheus_client` import in the process,
    otherwise the library has already loaded its registry against the
    process-local default and multiprocess collection won't kick in.
    """
    explicit = os.environ.get("PROMETHEUS_MULTIPROC_DIR")
    if explicit:
        target = explicit
    else:
        base = os.environ.get("PROMETHEUS_MULTIPROC_BASE_DIR", _DEFAULT_BASE)
        target = str(Path(base) / component)
        os.environ["PROMETHEUS_MULTIPROC_DIR"] = target

    path = Path(target)
    if path.exists():
        for entry in path.iterdir():
            if entry.is_file():
                with contextlib.suppress(OSError):
                    entry.unlink()
            elif entry.is_dir():
                with contextlib.suppress(OSError):
                    shutil.rmtree(entry)
    else:
        path.mkdir(parents=True, exist_ok=True)
    return target
