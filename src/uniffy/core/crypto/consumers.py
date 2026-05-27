"""Registries for domains that own encrypted columns.

Two parallel registries: :data:`CRYPTO_CONSUMERS` for per-org rotation and
:data:`DEPLOYMENT_CRYPTO_CONSUMERS` for the deployment-singleton DEK. Owners
register at import time so rotation code stays table-agnostic.
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
    """Append a per-org consumer; duplicate ``name`` is a no-op (test-fixture safe)."""
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
    """Append a deployment-scope consumer; same idempotency as :func:`register_consumer`."""
    for existing in DEPLOYMENT_CRYPTO_CONSUMERS:
        if existing.name == consumer.name:
            return
    DEPLOYMENT_CRYPTO_CONSUMERS.append(consumer)
