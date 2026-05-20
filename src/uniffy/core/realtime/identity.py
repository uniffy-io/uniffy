"""Per-process replica identifier used to deduplicate Valkey pubsub fanout."""

import uuid

_replica_id: str = uuid.uuid4().hex


def replica_id() -> str:
    """Return this process's stable replica id (set once at import time)."""
    return _replica_id
