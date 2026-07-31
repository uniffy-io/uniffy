"""DeploymentReEncryptingConsumer registration idempotency."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.crypto import consumers as consumer_module
from uniffy.core.crypto.consumers import (
    DEPLOYMENT_CRYPTO_CONSUMERS,
    DeploymentReEncryptingConsumer,
    register_deployment_consumer,
)


async def _empty(session: AsyncSession) -> AsyncIterator[Any]:
    if False:  # pragma: no cover - generator stub
        yield None


def _build(name: str) -> DeploymentReEncryptingConsumer:
    return DeploymentReEncryptingConsumer(
        name=name,
        table_name=f"{name}_table",
        list_rows=_empty,
        get_ciphertext=lambda row: "",
        set_ciphertext=lambda row, value: None,
    )


@pytest.fixture(autouse=True)
def restore_registry() -> None:
    """Snapshot + restore the registry to keep tests isolated."""
    saved = list(consumer_module.DEPLOYMENT_CRYPTO_CONSUMERS)
    yield
    consumer_module.DEPLOYMENT_CRYPTO_CONSUMERS.clear()
    consumer_module.DEPLOYMENT_CRYPTO_CONSUMERS.extend(saved)


def test_register_appends_new_consumer() -> None:
    before = len(DEPLOYMENT_CRYPTO_CONSUMERS)
    register_deployment_consumer(_build("test_one"))
    assert len(DEPLOYMENT_CRYPTO_CONSUMERS) == before + 1


def test_register_is_idempotent_on_name() -> None:
    register_deployment_consumer(_build("test_dup"))
    before = len(DEPLOYMENT_CRYPTO_CONSUMERS)
    register_deployment_consumer(_build("test_dup"))
    assert len(DEPLOYMENT_CRYPTO_CONSUMERS) == before
