"""Registries for domains that own encrypted columns.

Two parallel registries:

* :data:`CRYPTO_CONSUMERS` -- per-org rotation. Each entry's
  ``list_rows`` yields ORM rows for one organization id.
* :data:`DEPLOYMENT_CRYPTO_CONSUMERS` -- deployment-singleton
  rotation. Each entry's ``list_rows`` yields every encrypted row
  across the deployment (no org dimension).

Owners register at module import time so the rotation code never has
to know about specific tables. ``get_ciphertext`` / ``set_ciphertext``
mutate the encrypted column on a single row.
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
    """Append a per-org consumer to the global registry.

    Called at import time from each owning domain's ``operations.py``.
    Duplicate registration (same ``name``) is a no-op so re-imports
    under test fixtures don't multiply rotation work.
    """
    for existing in CRYPTO_CONSUMERS:
        if existing.name == consumer.name:
            return
    CRYPTO_CONSUMERS.append(consumer)


@dataclass(frozen=True)
class DeploymentReEncryptingConsumer:
    """One domain's contribution to a deployment-DEK rotation sweep."""

    name: str
    table_name: str
    list_rows: Callable[[AsyncSession], AsyncIterator[Any]]
    get_ciphertext: Callable[[Any], str]
    set_ciphertext: Callable[[Any, str], None]


DEPLOYMENT_CRYPTO_CONSUMERS: list[DeploymentReEncryptingConsumer] = []


def register_deployment_consumer(consumer: DeploymentReEncryptingConsumer) -> None:
    """Append a deployment-scope consumer to the registry.

    Same idempotency contract as :func:`register_consumer`. Currently
    used by ``deployment_settings`` (``namespace='mail'`` SMTP password,
    future deployment-scope secrets land here automatically).
    """
    for existing in DEPLOYMENT_CRYPTO_CONSUMERS:
        if existing.name == consumer.name:
            return
    DEPLOYMENT_CRYPTO_CONSUMERS.append(consumer)
