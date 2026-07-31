"""Repo-root .env loading for the integration tier.

The unit tier never calls this: it needs no service, so it must not pick up
whatever happens to be in a developer's .env.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def load_repo_env() -> None:
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
