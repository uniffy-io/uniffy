"""Provider-key transaction proofs against PostgreSQL."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import delete, func, select

from uniffy.core.models.agents.provider_key import ProviderKey
from uniffy.core.types import generate_id
from uniffy.infrastructure.database import open_session
from uniffy.domains.agents.providers.operations import ProviderOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_provider_key_rolls_back_when_required_audit_fails(session, env) -> None:
    label = f"audit-rollback-{generate_id().hex[:10]}"
    provider = MagicMock()
    provider.validate = AsyncMock(return_value=(True, None))
    registry = MagicMock()
    registry.create_provider.return_value = provider

    try:
        with (
            patch(
                "uniffy.domains.agents.providers.operations.get_provider_registry",
                return_value=registry,
            ),
            patch(
                "uniffy.domains.agents.providers.operations.write_audit_event",
                new=AsyncMock(side_effect=RuntimeError("provider audit unavailable")),
            ),
            pytest.raises(RuntimeError, match="provider audit unavailable"),
        ):
            await ProviderOperations(session).add_key(
                user_id=env.admin_id,
                organization_id=env.org_id,
                provider="test-provider",
                label=label,
                credential="test-secret",
            )

        async with open_session() as isolated:
            count = await isolated.scalar(
                select(func.count())
                .select_from(ProviderKey)
                .where(
                    ProviderKey.organization_id == env.org_id,
                    ProviderKey.label == label,
                )
            )

        assert count == 0
    finally:
        await session.rollback()
        await session.execute(
            delete(ProviderKey).where(
                ProviderKey.organization_id == env.org_id,
                ProviderKey.label == label,
            )
        )
        await session.commit()
