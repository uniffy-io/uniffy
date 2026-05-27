"""Per-process replica identifier used to deduplicate Valkey pubsub fanout."""

import uuid

_replica_id: str = uuid.uuid4().hex


def replica_id() -> str:
    return _replica_id
