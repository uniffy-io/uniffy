"""Bootstrap helper for prometheus_client multiprocess mode.

Granian forks N worker processes that each own a private prometheus_client
registry. A scrape against any one process therefore returns only its slice
of the counters, which makes hit-rate dashboards lie under load.
"""

import contextlib
import os
import shutil
from pathlib import Path

_DEFAULT_BASE = "/tmp/uniffy_prom_metrics"


def bootstrap_multiproc_metrics(component: str) -> str:
    """Configure PROMETHEUS_MULTIPROC_DIR for a fork-share group and return it.

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
