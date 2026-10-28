"""Deployment settings upsert on real rows: rewriting a key records when it last changed."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import update

from uniffy.core.config.settings.deployment import DeploymentSettingsOperations
from uniffy.core.models.settings.deployment_setting import DeploymentSetting
from uniffy.core.types import generate_id

pytestmark = pytest.mark.asyncio(loop_scope="session")

_WRITTEN_LONG_AGO = datetime(2020, 1, 1, tzinfo=UTC)


async def test_rewriting_a_key_moves_updated_at_and_keeps_created_at(session) -> None:
    namespace = f"test-{generate_id().hex[:12]}"
    operations = DeploymentSettingsOperations(session)
    try:
        await operations.set(namespace=namespace, key="mode", value="first")
        await session.execute(
            update(DeploymentSetting)
            .where(DeploymentSetting.namespace == namespace)
            .values(created_at=_WRITTEN_LONG_AGO, updated_at=_WRITTEN_LONG_AGO)
        )
        await session.commit()

        await operations.set(namespace=namespace, key="mode", value="second")
        await session.commit()

        session.expire_all()
        row = (await operations.get_namespace(namespace))["mode"]
        assert row.value == "second"
        assert row.created_at == _WRITTEN_LONG_AGO
        assert row.updated_at > _WRITTEN_LONG_AGO
    finally:
        await session.rollback()
        await operations.delete_namespace(namespace)
        await session.commit()
