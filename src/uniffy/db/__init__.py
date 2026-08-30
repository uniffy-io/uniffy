"""Application schema migration and bootstrap package."""

from uniffy.db.bundled_skills import sync_bundled_skills
from uniffy.db.seed import seed_initial_data

__all__ = [
    "seed_initial_data",
    "sync_bundled_skills",
]
