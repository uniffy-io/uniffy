"""Deployment bootstrap dependency composition tests."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.search import SearchIndexer
from uniffy.domains.organizations import operations as organization_operations
from uniffy.domains.platform import bootstrap
from uniffy.infrastructure.database import session as database_session


async def test_empty_deployment_passes_runtime_dependencies_to_organization_owner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    session.flush = AsyncMock()
    session.refresh = AsyncMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    @asynccontextmanager
    async def open_session() -> AsyncIterator[MagicMock]:
        yield session

    monkeypatch.setattr(database_session, "open_session", open_session)
    monkeypatch.setattr(
        "uniffy.core.auth.passwords.crypto.hash_password",
        MagicMock(return_value="hashed"),
    )
    monkeypatch.setenv("INITIAL_ADMIN_PASSWORD", "password")
    monkeypatch.setenv("INITIAL_ADMIN_EMAIL", "admin@example.com")
    monkeypatch.setenv("INITIAL_PLATFORM_ADMIN_EMAIL", "admin@example.com")
    monkeypatch.setenv("DEFAULT_ORG_NAME", "Default")
    monkeypatch.setenv("DEFAULT_ORG_SLUG", "default")

    created_org = MagicMock(name="Default", slug="default")
    operations = MagicMock()
    operations.create = AsyncMock(return_value=created_org)
    constructor = MagicMock(return_value=operations)
    monkeypatch.setattr(organization_operations, "OrganizationOperations", constructor)
    monkeypatch.setattr(bootstrap, "_seed_vapid_keys", AsyncMock())

    search_indexer = MagicMock(spec=SearchIndexer)
    await bootstrap._bootstrap_deployment_locked(search_indexer)

    constructor.assert_called_once_with(session)
    operations.create.assert_awaited_once_with(
        name="Default",
        slug="default",
        owner_user_id=session.add.call_args_list[0].args[0].id,
        plan="enterprise",
        search_indexer=search_indexer,
    )
    operations.create.assert_awaited_once()
