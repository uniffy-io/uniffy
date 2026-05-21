"""Registry of domains that own per-org encrypted columns.

Per-org DEK rotation needs to know every column whose ciphertext is
keyed on the rotating organization's previous DEK so it can re-encrypt
each row under the new DEK. Each owning domain registers a
``ReEncryptingConsumer`` at import time; the rotation sweep walks the
list.

The consumer interface stays narrow on purpose -- the rotation code
shouldn't know about specific tables. ``list_rows`` yields ORM rows for
one org, ``get_ciphertext`` / ``set_ciphertext`` mutate the encrypted
column.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class ReEncryptingConsumer:
    """One domain's contribution to a per-org DEK rotation sweep."""

    name: str
    table_name: str
    list_rows: Callable[[AsyncSession, UUID], AsyncIterator[Any]]
    get_ciphertext: Callable[[Any], str]
    set_ciphertext: Callable[[Any, str], None]


CRYPTO_CONSUMERS: list[ReEncryptingConsumer] = []


def register_consumer(consumer: ReEncryptingConsumer) -> None:
    """Append a consumer to the global registry.

    Called at import time from each owning domain's ``operations.py``.
    Duplicate registration (same ``name``) is a no-op so re-imports
    under test fixtures don't multiply rotation work.
    """
    for existing in CRYPTO_CONSUMERS:
        if existing.name == consumer.name:
            return
    CRYPTO_CONSUMERS.append(consumer)
