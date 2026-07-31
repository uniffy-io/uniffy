"""Shared setup for all integration suites: environment loading only.

Integration tests talk to real external services and cost real money. They
are never collected by the unit suite: the unit runner targets
``src/uniffy/tests/unit/`` explicitly, and this tree is only reached via
``./manage.py test -s integration`` or a direct pytest path. Suite-specific
fixtures live in each subfolder's own ``conftest.py``.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]


def _load_env_file() -> None:
    """Read repo-root .env so host runs need no exported variables.

    Existing environment values win; the parser is deliberately tiny
    (KEY=VALUE lines, quotes stripped, comments ignored).
    """
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file()
